// Behavioural checks for apps/shuttlepub-web that a screenshot cannot prove.
//
//   bun visual/screens/shuttlepub-verify.ts
//
// Needs the built app (visual/build.sh ../shuttlepub-web) and Playwright Chromium,
// exactly like the screen capture driver, and runs from the same CI job.
//
//  - mock mode: the SSR response (no data, loading states) is hydrated by the client at
//    mobile and desktop widths, the DOM keeps one copy of each region after resume, the
//    fixtures arrive through the BFF and no backend is called. The SNS shell's keyboard
//    and focus rules (ui-spec v6 投稿フォーム / 投稿詳細のタブ / L1 / 実装上の注意 6) hold:
//    compose opens with focus in the text, traps Tab, Esc closes the visibility menu
//    before the form and returns focus to the opener; tabs move with arrow keys; the
//    Profile switcher closes on Esc and switches the acting Profile.
//  - real mode against a stub backend that answers 501 / 500 for GET /api/v1/status:
//    the status failure is displayed with its code, the timeline (no endpoint in the
//    pinned OpenAPI) is displayed as not implemented, the unauthenticated viewer gets
//    the login entry, and the page never shows mock data.
//  - real mode, signed out (FA login UI): login entries return to the current screen,
//    the login button runs the real BFF authorize/callback against a simulated provider
//    denial and lands on /login?error=denied, and a stale session shows as expired once.
import { isAbsolute, resolve } from "node:path";
import { chromium, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { appExists, startApp, type AppServer } from "./servers.ts";
import { SHUTTLEPUB_LOOPBACK_SESSION_COOKIE, startShuttlePubStub } from "./shuttlepub-stub.ts";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

type Backend = { url: string; requests: string[]; stop: () => void };

function startBackend(status: 500 | 501): Backend {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      if (request.method === "GET" && pathname === "/api/v1/status") {
        return Response.json(
          status === 501
            ? { code: "not_implemented", message: "GET /api/v1/status is not implemented yet" }
            : { code: "internal", message: "stub backend failure" },
          { status },
        );
      }
      return Response.json({ code: "not_found", message: "no such route" }, { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

async function openPage(browser: Browser, server: AppServer, viewport: Viewport) {
  const context = await browser.newContext({
    baseURL: server.url, viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark", serviceWorkers: "block",
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`Console: ${message.text()}`);
  });
  return { context, page, errors };
}

async function verifySsrDocument(server: AppServer) {
  const response = await fetch(`${server.url}/`);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("<template-state");
  expect(html).toContain('data-testid="app-shell"');
  expect(html).toContain('data-hydration="ssr"');
  // SSR must not claim to know data the client has not fetched yet.
  expect(html).toContain('data-testid="timeline" data-state="loading"');
  expect(html).not.toContain("Fixture Profile");
  expect(html).not.toContain("<article");
}

async function expectHydrated(page: Page) {
  const shell = page.getByTestId("app-shell");
  await expect(shell).toHaveAttribute("data-hydration", "hydrated");
  // Flame matches SSR nodes to virtual nodes by index only; a mismatch duplicates or loses regions.
  await expect(shell).toHaveCount(1);
  await expect(page.locator("main#app")).toHaveCount(1);
  await expect(page.locator("#content")).toHaveCount(1);
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("#content h1")).toHaveCount(1);
  await expect(page.getByTestId("timeline")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "メインナビゲーション" }).filter({ visible: true })).toHaveCount(1);
}

const visible = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name }).filter({ visible: true });

async function verifyCompose(page: Page) {
  const opener = visible(page, "投稿する");
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "投稿" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const text = dialog.getByRole("textbox", { name: "投稿内容" });
  await expect(text).toBeFocused();
  // L2: nothing to post yet, so 投稿 is disabled; typing enables it.
  await expect(page.getByTestId("compose-submit")).toBeDisabled();
  await text.fill("こんにちは");
  await expect(page.getByTestId("compose-submit")).toBeEnabled();
  // Tab stays inside the modal.
  await expectTabStaysInside(page, dialog);
  await expectScrollLocked(page, true);
  // Visibility: icon only, read as 公開範囲: 公開; the menu opens; Esc closes only the menu.
  const visibility = page.getByTestId("compose-visibility");
  await expect(visibility).toHaveAttribute("aria-label", "公開範囲: 公開");
  await visibility.click();
  const menu = dialog.getByRole("menu", { name: "公開範囲" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(visibility).toBeFocused();
  await visibility.click();
  await menu.getByRole("menuitemradio", { name: /フォロワー/ }).click();
  await expect(visibility).toHaveAttribute("aria-label", "公開範囲: フォロワー");
  // Posting has no backend contract: the failure is shown, the draft is kept.
  await page.getByTestId("compose-submit").click();
  await expect(dialog.getByRole("alert")).toHaveAttribute("data-error", "not_implemented");
  await expect(text).toHaveValue("こんにちは");
  // Esc closes the form and focus returns to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

async function verifyTimelineTabs(page: Page) {
  const home = page.getByRole("tab", { name: "ホーム" });
  await home.focus();
  await page.keyboard.press("ArrowRight");
  const local = page.getByRole("tab", { name: "ローカル" });
  await expect(local).toHaveAttribute("aria-selected", "true");
  await expect(local).toBeFocused();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  await expect(page.locator("#content article")).toHaveCount(3);
  await page.keyboard.press("ArrowLeft");
  await expect(home).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#content article")).toHaveCount(5);
}

async function verifyPostDetail(page: Page) {
  // L4: the time link leads to the detail.
  await page.locator("#content article").nth(1).getByRole("link").click();
  await expect(page).toHaveURL(/\/posts\/post-sora-zine$/);
  await expect(page.getByTestId("post-detail")).toHaveAttribute("data-state", "loaded");
  const replies = page.getByRole("tab", { name: /返信/ });
  const reactions = page.getByRole("tab", { name: /リアクション/ });
  await expect(replies).toHaveAttribute("aria-selected", "true");
  await expect(replies).toContainText("2");
  await replies.focus();
  await page.keyboard.press("ArrowRight");
  await expect(reactions).toHaveAttribute("aria-selected", "true");
  await expect(reactions).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(replies).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#content article")).toHaveCount(3);
  // L4: clicking the body of a reply opens that post.
  await page.locator("#content article").nth(2).locator(".sp-post-text").click();
  await expect(page).toHaveURL(/\/posts\/post-hina-reply$/);
  await expect(page.getByTestId("post-detail")).toHaveAttribute("data-state", "loaded");
  await page.getByRole("link", { name: "戻る" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
}

async function verifyProfileSwitcher(page: Page, viewport: Viewport) {
  const switcher = visible(page, /投稿用 Profile を切り替え（現在: Fixture Profile）/);
  await switcher.click();
  const menu = page.getByTestId("profile-menu");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu.getByRole("menuitemradio", { name: /Fixture Profile/ })).toHaveAttribute("aria-checked", "true");
  if (viewport.name === "mobile") {
    const sheet = page.getByRole("dialog", { name: "投稿用 Profile を切り替え" });
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expectScrollLocked(page, true);
    await expectTabStaysInside(page, sheet);
  } else {
    await expectScrollLocked(page, false);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(switcher).toBeFocused();
  await switcher.click();
  await menu.getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(visible(page, /投稿用 Profile を切り替え（現在: Fixture Dev）/)).toBeFocused();
  await expectScrollLocked(page, false);
}

async function expectScrollLocked(page: Page, locked: boolean) {
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("sp-scroll-locked"))).toBe(locked);
}

/** Tab and Shift+Tab cycle within an aria-modal layer (ui-spec 実装上の注意 6). */
async function expectTabStaysInside(page: Page, layer: Locator) {
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(key);
      expect(await layer.evaluate((element) => element.contains(document.activeElement)), `${key} #${i + 1} left the modal`).toBe(true);
    }
  }
}

/**
 * The reaction cell keeps its width whether the button is shown or not, so the other
 * actions do not move (ui-spec アクション行). F3 renders an empty slot while reacted;
 * hiding the baseline button here models exactly that.
 */
async function verifyActionRowStable(page: Page, viewport: Viewport) {
  const row = page.locator("#content article").first().locator(".sp-actions");
  const cells = row.locator(":scope > *");
  await expect(cells).toHaveCount(4);
  const measure = () => cells.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, width: box.width };
  }));
  const slot = row.locator(".sp-react-slot");
  const expectedWidth = viewport.name === "mobile" ? 36 : 32;
  const shown = await measure();
  expect(shown[2]!.width, "reaction cell width").toBe(expectedWidth);
  expect((await slot.locator("button").boundingBox())!.width, "reaction button fills its cell").toBe(expectedWidth);
  await slot.locator("button").evaluate((button) => { (button as HTMLElement).style.display = "none"; });
  try {
    expect(await measure(), "action cells must not move when the reaction button is hidden").toEqual(shown);
  } finally {
    await slot.locator("button").evaluate((button) => { (button as HTMLElement).style.display = ""; });
  }
}

/**
 * Crossing the breakpoint while an overlay is open: the desktop and mobile chrome are
 * twins and only one is visible, so focus must land on what is visible now, and the
 * Profile dropdown <-> bottom sheet swap must keep focus inside and the scroll lock in step.
 */
async function verifyBreakpointCrossing(page: Page) {
  const mobile = VIEWPORTS[1];
  const desktop = VIEWPORTS[0];
  await page.setViewportSize({ width: desktop.width, height: desktop.height });
  // Compose opened on desktop, closed on mobile -> focus on the mobile compose tab.
  await visible(page, "投稿する").click();
  const dialog = page.getByRole("dialog", { name: "投稿" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toBeFocused();
  await page.setViewportSize({ width: mobile.width, height: mobile.height });
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toBeFocused();
  await expectTabStaysInside(page, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(visible(page, "投稿する")).toBeFocused();
  await expectScrollLocked(page, false);
  // And back: opened on mobile, closed on desktop -> focus on the sidebar button.
  await visible(page, "投稿する").click();
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toBeFocused();
  await page.setViewportSize({ width: desktop.width, height: desktop.height });
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toBeFocused();
  await expectTabStaysInside(page, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(visible(page, "投稿する")).toBeFocused();
  await expect(page.locator("#sp-compose-desktop")).toBeFocused();
  await expectScrollLocked(page, false);
  // Profile dropdown on desktop -> bottom sheet on mobile -> dropdown again.
  await page.setViewportSize({ width: desktop.width, height: desktop.height });
  await visible(page, /投稿用 Profile を切り替え/).click();
  const menu = page.getByTestId("profile-menu");
  await expect(menu).toBeVisible();
  await expectScrollLocked(page, false);
  await page.setViewportSize({ width: mobile.width, height: mobile.height });
  const sheet = page.getByRole("dialog", { name: "投稿用 Profile を切り替え" });
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expectScrollLocked(page, true);
  await expectTabStaysInside(page, sheet);
  await page.setViewportSize({ width: desktop.width, height: desktop.height });
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expectScrollLocked(page, false);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(visible(page, /投稿用 Profile を切り替え/)).toBeFocused();
}

async function resetMock(server: AppServer) {
  const response = await fetch(`${server.url}/__mock/reset`, { method: "POST" });
  expect(response.status, "mock reset").toBe(204);
}

/** GraphQL operation names the page sent, in order (to prove what was and was not sent). */
function recordOperations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/graphql") || request.method() !== "POST") return;
    const match = /^\s*(?:query|mutation)\s+(\w+)/.exec(String(request.postDataJSON()?.query ?? ""));
    if (match) sent.push(match[1]!);
  });
  return sent;
}

/**
 * Quick reaction on the timeline (ui-spec v6 C / P, 実装上の注意 1-4, 6), by keyboard:
 * picker opens from the reaction button (popover / bottom sheet) with the favourites
 * on top; picking reacts and moves focus to my chip (first); my chip removes it, the
 * reaction button comes back focused and the undo toast appears; undo with the picker
 * open closes the picker and restores the reaction; the removal is sent only when the
 * toast goes away; an unavailable favourite cannot be picked.
 */
async function verifyQuickReaction(page: Page, viewport: Viewport) {
  const sent = recordOperations(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  const articles = page.locator("#content article");
  const mika = articles.nth(0);
  const sora = articles.nth(1);
  await expect(mika.getByTestId("reactions")).toBeVisible();
  // C1: a reacted post shows my chip first and no reaction button, and the cell keeps
  // its width so the other actions stand where they stand on an unreacted post.
  const soraMine = page.locator("#react-mine-post-sora-zine");
  await expect(sora.getByTestId("reactions").locator(".sp-rchip").first()).toHaveAttribute("id", "react-mine-post-sora-zine");
  await expect(soraMine).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#react-post-sora-zine")).toHaveCount(0);
  const cells = (article: Locator) => article.locator(".sp-actions > *").evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().x)));
  const reacted = await cells(sora);
  await expect(soraMine).not.toHaveAttribute("aria-busy", "true");
  await soraMine.click();
  await expect(page.locator("#react-post-sora-zine")).toBeFocused();
  expect(await cells(sora), "action cells stay put when the reaction button comes back").toEqual(reacted);
  await page.getByTestId("reaction-toast").getByRole("button", { name: "元に戻す" }).click();
  await expect(soraMine).toBeFocused();
  expect(await cells(sora), "and when it goes away again").toEqual(reacted);

  // P5 / P1 / 注意 6: Enter opens the picker; Esc closes it and focus returns.
  const button = page.locator("#react-post-mika-picker");
  await button.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("picker");
  await expect(picker).toBeVisible();
  if (viewport.name === "mobile") {
    await expect(picker).toHaveAttribute("aria-modal", "true");
    await expect(picker).toBeFocused();
    await expectScrollLocked(page, true);
    await expectTabStaysInside(page, picker);
  } else {
    await expect(page.locator("#sp-picker-search")).toBeFocused();
    await expectScrollLocked(page, false);
  }
  const favorites = picker.getByTestId("picker-favorites");
  await expect(favorites.getByRole("button")).toHaveCount(5);
  await expect(favorites.getByRole("button", { name: ":old_blob:（利用不可）" })).toHaveAttribute("aria-disabled", "true");
  await expect(favorites.getByRole("link", { name: "常用絵文字を設定" })).toBeVisible();
  // P4: searching hides the favourites row.
  await picker.getByRole("searchbox", { name: "絵文字を検索" }).fill("ねこ");
  await expect(favorites).toHaveCount(0);
  await expect(picker.getByTestId("picker-grid").getByRole("button", { name: "ねこ" })).toBeVisible();
  await picker.getByRole("searchbox", { name: "絵文字を検索" }).fill("");
  // Category tabs move with the arrow keys (data-tablist="picker").
  await picker.getByRole("tab", { name: "顔" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(picker.getByRole("tab", { name: "手・人" })).toHaveAttribute("aria-selected", "true");
  await expect(picker.getByRole("tab", { name: "手・人" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(button).toBeFocused();
  await expectScrollLocked(page, false);

  // P2: an unavailable favourite is not picked; the toast says why and offers 入れ替える.
  await page.keyboard.press("Enter");
  // Opening schedules focus after render. Wait for it before choosing a different
  // target, or the pending focus effect can steal the following Enter on CI.
  await expect(viewport.name === "mobile" ? picker : page.locator("#sp-picker-search")).toBeFocused();
  // aria-disabled (not disabled): it stays focusable so the reason can be announced.
  await favorites.getByRole("button", { name: ":old_blob:（利用不可）" }).focus();
  await page.keyboard.press("Enter");
  const toast = page.getByTestId("reaction-toast");
  await expect(toast).toContainText("利用できません");
  await expect(toast.getByRole("button", { name: "入れ替える" })).toBeVisible();
  await expect(picker).toBeVisible();
  expect(sent.filter((name) => name === "SetNoteReaction"), "nothing sent for an unavailable emoji").toEqual([]);

  // Pick a favourite by keyboard: 2 operations, focus lands on my (first) chip.
  await favorites.getByRole("button", { name: "いいね" }).focus();
  await page.keyboard.press("Enter");
  const mine = page.locator("#react-mine-post-mika-picker");
  await expect(picker).toHaveCount(0);
  await expect(mine).toBeFocused();
  await expect(mine).toContainText("4");
  await expect(mika.getByTestId("reactions").locator(".sp-rchip").first()).toHaveAttribute("id", "react-mine-post-mika-picker");
  await expect(button).toHaveCount(0);
  await expect(mine).not.toHaveAttribute("aria-busy", "true");
  expect(sent.filter((name) => name === "SetNoteReaction")).toHaveLength(1);

  // C2: my chip removes; the reaction button returns focused; undo toast.
  await page.keyboard.press("Enter");
  await expect(mine).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(toast).toContainText("取り消しました");
  // 注意 1: undo while the picker of the same post is open closes the picker.
  await page.keyboard.press("Enter");
  await expect(picker).toBeVisible();
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".sp-sheet-backdrop, .sp-clickaway")).toHaveCount(0);
  await expect(mine).toBeFocused();
  await expect(toast).toHaveCount(0);
  await expectScrollLocked(page, false);
  expect(sent.filter((name) => name === "RemoveNoteReaction"), "undo sends nothing").toEqual([]);

  // D03 q09: the removal is sent when the toast goes away, not before.
  await mine.click();
  await expect(toast).toContainText("取り消しました");
  expect(sent.filter((name) => name === "RemoveNoteReaction")).toEqual([]);
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => sent.filter((name) => name === "RemoveNoteReaction").length).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#react-post-mika-picker")).toBeVisible();
  await expect(page.locator("#react-mine-post-mika-picker")).toHaveCount(0);

  // C3: someone's chip reacts with the same emoji while not reacted.
  await page.locator("#content article").nth(0).getByRole("button", { name: /^いいね でリアクション/ }).click();
  await expect(page.locator("#react-mine-post-mika-picker")).toBeFocused();
  await expect(page.locator("#content article").nth(0).getByRole("button", { name: /でリアクション/ })).toHaveCount(0);
  // Remove again and leave the screen: navigation confirms the removal at once.
  await expect(page.locator("#react-mine-post-mika-picker")).not.toHaveAttribute("aria-busy", "true");
  await page.locator("#react-mine-post-mika-picker").click();
  await page.locator("#content article").nth(1).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/posts\/post-sora-zine$/);
  await expect.poll(() => sent.filter((name) => name === "RemoveNoteReaction").length).toBe(2);
  await expect(page.getByTestId("reaction-toast")).toHaveCount(0);

  // D1 / D3: the reactions tab opens on 「すべて」, me first with 「あなた」; pressing the
  // selected toggle again closes the list.
  await page.getByRole("tab", { name: /リアクション/ }).click();
  const all = page.getByRole("button", { name: /^すべて/ });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const list = page.getByTestId("reactor-list");
  await expect(list.locator("li").first()).toContainText("あなた");
  await expect(list.locator("li").first()).toContainText("Fixture Profile");
  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "キラキラ 2" }).click();
  await expect(list.locator("li")).toHaveCount(2);
  await page.getByRole("tab", { name: /返信/ }).click();
  await page.getByRole("tab", { name: /リアクション/ }).click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  console.info(`OK quick reaction keyboard / focus / undo / delayed removal at ${viewport.name}`);
}

/**
 * 設定 > Profile 常用絵文字 (S2-S6) by keyboard: the unavailable favourite shows 「利用不可」
 * and its menu starts with 入れ替え; 左へ moves it; 削除 is immediate with an undo toast.
 */
async function verifyFavoritesSettings(page: Page, viewport: Viewport) {
  await page.goto("/settings", { waitUntil: "networkidle" });
  const chips = page.getByTestId("favorites");
  await expect(chips).toHaveAttribute("data-state", "loaded");
  const chip = (index: number) => page.locator(`#sp-fav-chip-${index}`);
  await expect(chips.getByText("利用不可")).toBeVisible();
  await expect(page.locator("#sp-fav-add")).toHaveCount(0);
  await chip(4).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByTestId("favorite-menu");
  await expect(menu.getByRole("menuitem").first()).toHaveText("入れ替え");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "左へ" })).toBeFocused();
  if (viewport.name === "mobile") await expectScrollLocked(page, true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(chip(4)).toBeFocused();
  // 左へ keeps the unavailable favourite (moving is allowed, S4).
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "左へ" }).click();
  await expect(chip(3)).toBeFocused();
  await expect(chip(3)).toHaveAttribute("aria-label", ":old_blob:（利用不可）");
  await expect(chips).toHaveAttribute("aria-busy", "false");
  // 削除 then 元に戻す (S2).
  await chip(0).click();
  await menu.getByRole("menuitem", { name: "削除" }).click();
  await expect(page.locator("#sp-fav-add")).toBeFocused();
  await expect(chips.locator(".sp-fchip").first()).toHaveAttribute("aria-label", "おめでとう");
  const toast = page.getByTestId("reaction-toast");
  await expect(toast).toContainText("削除しました");
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(chip(0)).toHaveAttribute("aria-label", "いいね");
  await expect(chip(0)).toBeFocused();
  // ＋ adds through the picker (dialog / sheet); taken emoji cannot be picked again.
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await chip(1).click();
  await menu.getByRole("menuitem", { name: "削除" }).click();
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await page.locator("#sp-fav-add").click();
  const picker = page.getByRole("dialog", { name: "常用絵文字を追加" });
  await expect(picker).toHaveAttribute("aria-modal", "true");
  await expectScrollLocked(page, true);
  await picker.getByRole("tab", { name: "手・人" }).click();
  await expect(picker.getByRole("button", { name: "いいね" })).toBeDisabled();
  await picker.getByRole("button", { name: "ピース" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator("#sp-fav-chip-4")).toBeFocused();
  await expect(page.locator("#sp-fav-chip-4")).toHaveAttribute("aria-label", "ピース");
  await expectScrollLocked(page, false);
  // S3: drag to reorder (desktop pointer).
  if (viewport.name === "desktop") {
    await chip(0).dragTo(chip(2));
    await expect(chip(2)).toHaveAttribute("aria-label", "いいね");
    await expect(chips).toHaveAttribute("aria-busy", "false");
  }
  console.info(`OK favourites settings keyboard / menu / undo at ${viewport.name}`);
}

/** Hold GraphQL operations named `name` until released; then answer them as `answer` says. */
async function gateOperation(page: Page, name: string, answer: "pass" | "fail") {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handled: Promise<void>[] = [];
  await page.route("**/graphql", (route) => {
    const query = String(route.request().postDataJSON()?.query ?? "");
    if (!new RegExp(`^\\s*mutation\\s+${name}\\b`).test(query)) return route.continue();
    const answered = gate.then(() => answer === "pass" ? route.continue() : route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: null, errors: [{ message: "upstream failed", extensions: { code: "UPSTREAM_ERROR" } }] }),
    }));
    handled.push(answered);
    return answered;
  });
  return async () => {
    release();
    await Promise.all(handled);
    await page.unroute("**/graphql");
  };
}

/**
 * Timing and input combinations of the quick reaction UI (PR #42 review):
 *  - 注意 3: focus keeps the undo toast even after the pointer leaves; it goes 3s after
 *    focus leaves too, and only then is the removal sent.
 *  - D03 q09: another toast replacing the undo toast sends the removal at once.
 *  - A DELETE in flight keeps the post busy (no picker); when it fails my chip comes
 *    back focused and the failure is shown (注意 6).
 *  - pagehide hands the removal to keepalive; back from the bfcache (pageshow
 *    persisted) the undo is over, nothing is resent and the screen is read again.
 *  - S2: the undo of a favourite deletion waits for the deletion to be saved; an
 *    unavailable favourite's deletion has no undo (lead decision on PR #42).
 */
async function verifyQuickReactionTiming(page: Page, viewport: Viewport) {
  const sent = recordOperations(page);
  const removals = () => sent.filter((name) => name === "RemoveNoteReaction").length;
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  const toast = page.getByTestId("reaction-toast");
  const soraMine = page.locator("#react-mine-post-sora-zine");
  const soraButton = page.locator("#react-post-sora-zine");
  const mikaMine = page.locator("#react-mine-post-mika-picker");

  // Focus and pointer hold the toast each on their own.
  await soraMine.click();
  await expect(toast).toContainText("取り消しました");
  const undo = toast.getByRole("button", { name: "元に戻す" });
  await undo.hover();
  await undo.focus();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(7_000);
  await expect(toast, "focused toast stays after the pointer leaves").toContainText("取り消しました");
  expect(removals(), "nothing sent while the undo is offered").toBe(0);
  await soraButton.focus();
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(removals).toBe(1);

  // A notice replacing the undo toast ends the undo: the removal is sent then.
  await page.locator("#content article").nth(0).getByRole("button", { name: /^いいね でリアクション/ }).click();
  await expect(mikaMine).toBeFocused();
  await expect(mikaMine).not.toHaveAttribute("aria-busy", "true");
  await mikaMine.click();
  await expect(toast).toContainText("取り消しました");
  await soraButton.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("picker");
  await expect(viewport.name === "mobile" ? picker : page.locator("#sp-picker-search")).toBeFocused();
  await picker.getByTestId("picker-favorites").getByRole("button", { name: ":old_blob:（利用不可）" }).focus();
  await page.keyboard.press("Enter");
  await expect(toast).toContainText("利用できません");
  await expect.poll(removals, { timeout: 2_000 }).toBe(2);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // A slow DELETE keeps the post busy; when it fails my chip comes back focused.
  await page.locator("#content article").nth(1).getByRole("button", { name: /でリアクション/ }).first().click();
  await expect(soraMine).toBeFocused();
  await expect(soraMine).not.toHaveAttribute("aria-busy", "true");
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  const finishRemoval = await gateOperation(page, "RemoveNoteReaction", "fail");
  await soraMine.click();
  await expect(soraButton).toBeFocused();
  await page.mouse.move(0, 0);
  await expect(soraButton).toHaveAttribute("aria-disabled", "true", { timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(picker, "no picker while the DELETE is in flight").toHaveCount(0);
  await finishRemoval();
  await expect(soraMine).toBeFocused();
  await expect(toast).toContainText("取り消せませんでした");
  await expect(toast).toHaveAttribute("data-error", /.+/);

  // Restore BEFORE the keepalive completes. No GET or interaction may race it.
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await soraMine.click();
  await expect(toast).toContainText("取り消しました");
  const before = removals();
  const finishKeepalive = await gateOperation(page, "RemoveNoteReaction", "pass");
  let restoresReads = 0;
  const observeRestoreReads = (request: import("@playwright/test").Request) => {
    if (!request.url().endsWith("/graphql")) return;
    const query = String(request.postDataJSON()?.query ?? "");
    if (/PostReactions|QuickReactionSettings/.test(query)) restoresReads++;
  };
  page.on("request", observeRestoreReads);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(removals).toBe(before + 1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(toast).toHaveCount(0);
  await expect(soraButton).toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(200);
  expect(restoresReads, "no revalidation while keepalive is unresolved").toBe(0);
  await finishKeepalive();
  await expect.poll(() => restoresReads).toBeGreaterThan(0);
  await expect(soraButton).not.toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(7_000);
  expect(removals(), "nothing resent after the restore").toBe(before + 1);
  await expect(soraMine).toHaveCount(0);
  page.off("request", observeRestoreReads);

  // S2: deleting a favourite while its save is slow keeps the undo waiting.
  await page.goto("/settings", { waitUntil: "networkidle" });
  const chips = page.getByTestId("favorites");
  await expect(chips).toHaveAttribute("data-state", "loaded");
  const finishSave = await gateOperation(page, "UpdateQuickReactionSettings", "pass");
  await page.locator("#sp-fav-chip-0").click();
  await page.getByTestId("favorite-menu").getByRole("menuitem", { name: "削除" }).click();
  const waitingUndo = toast.getByRole("button", { name: "元に戻す" });
  await expect(waitingUndo).toHaveAttribute("aria-disabled", "true");
  await waitingUndo.click({ force: true });
  await page.mouse.move(0, 0);
  await page.locator("#sp-fav-add").focus();
  await page.waitForTimeout(7_000);
  await expect(toast, "the undo waits for the deletion to be saved").toContainText("削除しました");
  await waitingUndo.hover();
  await finishSave();
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await expect(waitingUndo).not.toHaveAttribute("aria-disabled", "true");
  await waitingUndo.click();
  await expect(page.locator("#sp-fav-chip-0")).toHaveAttribute("aria-label", "いいね");
  // S2 exception: deleting the unavailable favourite says 削除しました without 元に戻す.
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sp-fav-chip-4")).toHaveAttribute("aria-label", ":old_blob:（利用不可）");
  await page.locator("#sp-fav-chip-4").click();
  await page.getByTestId("favorite-menu").getByRole("menuitem", { name: "削除" }).click();
  await expect(toast).toContainText("削除しました");
  await expect(toast.getByRole("button")).toHaveCount(0);
  await expect(chips.getByRole("button", { name: /利用不可/ })).toHaveCount(0);
  console.info(`OK quick reaction timing (hold / replacement / slow+failed DELETE / bfcache / slow favourite save) at ${viewport.name}`);
}

/**
 * Two sessions (devices) acting as the same Profile share its favourites and its
 * reactions through the stateful mock; the stale one gets 409 and can save again.
 */
async function verifySharedAcrossSessions(browser: Browser, server: AppServer) {
  const deviceA = await openPage(browser, server, VIEWPORTS[0]);
  const deviceB = await openPage(browser, server, VIEWPORTS[1]);
  try {
    for (const device of [deviceA, deviceB]) {
      await device.page.goto("/settings", { waitUntil: "networkidle" });
      await expect(device.page.getByTestId("favorites")).toHaveAttribute("data-state", "loaded");
    }
    // A deletes 🙏 (revision 3 -> 4).
    await deviceA.page.locator("#sp-fav-chip-3").click();
    await deviceA.page.getByTestId("favorite-menu").getByRole("menuitem", { name: "削除" }).click();
    await expect(deviceA.page.getByTestId("favorites")).toHaveAttribute("aria-busy", "false");
    await expect(deviceA.page.locator(".sp-fchip:not(.sp-fchip-add)")).toHaveCount(4);
    // B still shows revision 3; its edit is refused as stale and shows the stored list.
    await deviceB.page.locator("#sp-fav-chip-0").click();
    await deviceB.page.getByTestId("favorite-menu").getByRole("menuitem", { name: "右へ" }).click();
    const problem = deviceB.page.getByTestId("favorites-problem");
    await expect(problem).toHaveAttribute("data-error", "revision_conflict");
    await expect(deviceB.page.locator(".sp-fchip:not(.sp-fchip-add)")).toHaveCount(4);
    await problem.getByRole("button", { name: "もう一度保存" }).click();
    await expect(problem).toHaveCount(0);
    await expect(deviceB.page.getByTestId("favorites")).toHaveAttribute("aria-busy", "false");
    // A new session sees what B saved.
    await deviceA.page.reload({ waitUntil: "networkidle" });
    await expect(deviceA.page.locator("#sp-fav-chip-0")).toHaveAttribute("aria-label", "おめでとう");
    await expect(deviceA.page.locator("#sp-fav-chip-1")).toHaveAttribute("aria-label", "いいね");
    // Reactions are shared too, and a Profile switch does not mix Profiles.
    await deviceA.page.goto("/", { waitUntil: "networkidle" });
    await deviceA.page.locator("#react-post-aoi-profiles").click();
    await deviceA.page.getByTestId("picker").getByTestId("picker-favorites").getByRole("button").first().click();
    await expect(deviceA.page.locator("#react-mine-post-aoi-profiles")).not.toHaveAttribute("aria-busy", "true");
    await deviceB.page.goto("/", { waitUntil: "networkidle" });
    await expect(deviceB.page.locator("#react-mine-post-aoi-profiles")).toBeVisible();
    await visible(deviceB.page, /投稿用 Profile を切り替え/).click();
    await deviceB.page.getByTestId("profile-menu").getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
    await expect(deviceB.page.locator("#react-mine-post-aoi-profiles")).toHaveCount(0);
    await expect(deviceB.page.locator("#react-mine-post-sora-zine")).toHaveCount(0);
    await deviceB.page.locator("#react-post-aoi-profiles").click();
    // P3: Fixture Dev never saved favourites: no favourites row, no link.
    await expect(deviceB.page.getByTestId("picker")).toBeVisible();
    await expect(deviceB.page.getByTestId("picker-favorites")).toHaveCount(0);
    expect([...deviceA.errors, ...deviceB.errors], "two sessions: browser errors").toEqual([]);
    console.info("OK two sessions share a Profile's favourites and reactions; stale saves get 409 and retry");
  } finally {
    await deviceA.context.close();
    await deviceB.context.close();
  }
}

async function verifyMock(browser: Browser, frontendRoot: string, coreURL: string) {
  const server = await startApp(frontendRoot, "ShuttlePub", coreURL);
  try {
    await server.waitUntilReady();
    await verifySsrDocument(server);
    for (const viewport of VIEWPORTS) {
      await resetMock(server);
      const { context, page, errors } = await openPage(browser, server, viewport);
      try {
        await page.goto("/", { waitUntil: "networkidle" });
        await expectHydrated(page);
        await expect(page.getByTestId("app-shell")).toHaveAttribute("data-api-mode", "mock");
        await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "loaded");
        await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
        await expect(page.locator("#content article")).toHaveCount(5);
        await verifyActionRowStable(page, viewport);
        await verifyCompose(page);
        await verifyTimelineTabs(page);
        await verifyPostDetail(page);
        await verifyProfileSwitcher(page, viewport);
        if (viewport.name === "desktop") await verifyBreakpointCrossing(page);
        await verifyQuickReaction(page, viewport);
        await verifyFavoritesSettings(page, viewport);
        await resetMock(server);
        await verifyQuickReactionTiming(page, viewport);
        expect(errors, `mock ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK mock mode hydrates and keeps the shell's keyboard/focus rules at ${viewport.name} (${viewport.width}x${viewport.height})`);
      } finally {
        await context.close();
      }
    }
    await resetMock(server);
    await verifySharedAcrossSessions(browser, server);
    expect(await server.networkViolations(), "mock mode must not fetch anything server-side").toEqual([]);
  } finally {
    await server.stop();
  }
}

async function verifyRealFailure(browser: Browser, frontendRoot: string, status: 500 | 501) {
  const backend = startBackend(status);
  const server = await startApp(frontendRoot, "ShuttlePub", backend.url, {
    env: { SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: backend.url,
      EMUMET_API_URL: backend.url, HYDRA_PUBLIC_URL: backend.url, KRATOS_PUBLIC_URL: backend.url,
      HYDRA_CLIENT_ID: "visual-shuttlepub", HYDRA_CLIENT_SECRET: "visual-fixture-only",
      SHUTTLEPUB_COOKIE_SECRET_BASE64: Buffer.alloc(32, 9).toString("base64") },
  });
  const expectedCode = status === 501 ? "not_implemented" : "upstream_error";
  try {
    await server.waitUntilReady();
    await verifySsrDocument(server);
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openPage(browser, server, viewport);
      try {
        await page.goto("/", { waitUntil: "networkidle" });
        await expectHydrated(page);
        await expect(page.getByTestId("app-shell")).toHaveAttribute("data-api-mode", "real");
        const statusBanner = page.getByTestId("api-status");
        await expect(statusBanner).toHaveAttribute("data-state", "error");
        await expect(statusBanner).toHaveAttribute("data-error", expectedCode);
        await expect(statusBanner).toBeVisible();
        // No timeline endpoint in the pinned OpenAPI: shown as not implemented, never mock posts.
        const timeline = page.getByTestId("timeline");
        await expect(timeline).toHaveAttribute("data-state", "error");
        await expect(timeline).toHaveAttribute("data-error", "not_implemented");
        await expect(page.locator("article")).toHaveCount(0);
        await expect(page.getByText("Fixture Profile")).toHaveCount(0);
        // Unauthenticated viewer: the login entry instead of a Profile switcher; no posting.
        await expect(page.getByTestId("login-link").filter({ visible: true })).toHaveCount(1);
        await expect(visible(page, /投稿用 Profile/)).toHaveCount(0);
        await expect(visible(page, "投稿する")).toBeDisabled();
        // The BFF answers GraphQL errors with HTTP 200; the browser console stays clean.
        expect(errors, `real ${status} ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK real mode ${status} is shown as ${expectedCode} at ${viewport.name}`);
      } finally {
        await context.close();
      }
    }
    expect(new Set(backend.requests), "real mode calls only the documented endpoint").toEqual(new Set(["GET /api/v1/status"]));
    expect(await server.networkViolations(), "real mode may only reach the configured backend").toEqual([]);
  } finally {
    await server.stop();
    backend.stop();
  }
}

/**
 * FA login UI against the real-mode BFF, with a stub provider that denies the
 * authorization request:
 *  - a signed-out viewer gets the header entry and the notice, both returning to the
 *    current screen; posting stays disabled; the login button is keyboard reachable;
 *  - /login -> "Emumet でログイン" -> real /auth/login (PKCE/state) -> provider denial
 *    -> real /auth/callback -> /login?error=denied, with no session created;
 *  - an unknown ?error= value shows nothing;
 *  - a stale session cookie is reported as expired once, and cleared by the BFF.
 */
async function verifySignedOut(browser: Browser, frontendRoot: string) {
  const backend = startShuttlePubStub({ authorize: "deny" });
  const server = await startApp(frontendRoot, "ShuttlePub", backend.url, { env: backend.env });
  try {
    await server.waitUntilReady();
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openPage(browser, server, viewport);
      try {
        await page.goto("/posts/post-sora-zine", { waitUntil: "networkidle" });
        const shell = page.getByTestId("app-shell");
        await expect(shell).toHaveAttribute("data-hydration", "hydrated");
        await expect(shell).toHaveAttribute("data-api-mode", "real");
        const returnHere = "/auth/login?return_to=%2Fposts%2Fpost-sora-zine";
        await expect(page.getByTestId("login-link").filter({ visible: true })).toHaveAttribute("href", returnHere);
        const notice = page.getByTestId("auth-notice");
        await expect(notice).toHaveAttribute("data-state", "signed-out");
        const noticeLogin = notice.getByRole("link", { name: "ログイン" });
        await expect(noticeLogin).toHaveAttribute("href", returnHere);
        await expect(visible(page, "投稿する")).toBeDisabled();
        await expect(page.getByText("ログアウト")).toHaveCount(0);

        await page.goto("/login", { waitUntil: "networkidle" });
        await expect(shell).toHaveAttribute("data-hydration", "hydrated");
        await expect(page.getByTestId("auth-notice")).toHaveCount(0);
        const start = page.getByTestId("login-start");
        await expect(start).toHaveAttribute("href", "/auth/login");
        await start.focus();
        await expect(start).toBeFocused();
        // The stub provider denies THIS authorization request (state echoed back).
        const before = backend.authorizeRequests.length;
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(`${server.url}/login?error=denied`);
        const authorize = backend.authorizeRequests[before];
        expect(backend.authorizeRequests).toHaveLength(before + 1);
        expect(authorize?.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorize?.searchParams.get("prompt")).toBe("login");
        await expect(shell).toHaveAttribute("data-hydration", "hydrated");
        await expect(page.getByTestId("login-error")).toHaveAttribute("data-state", "denied");
        await expect(page.getByText("PROVIDER_TEXT")).toHaveCount(0);
        expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(SHUTTLEPUB_LOOPBACK_SESSION_COOKIE);

        await page.goto("/login?error=%3Cb%3Eforged%3C%2Fb%3E", { waitUntil: "networkidle" });
        await expect(shell).toHaveAttribute("data-hydration", "hydrated");
        await expect(page.getByTestId("login-error")).toHaveCount(0);
        await expect(page.getByText("forged")).toHaveCount(0);

        await context.addCookies([{ name: SHUTTLEPUB_LOOPBACK_SESSION_COOKIE, value: "stale-session", url: server.url }]);
        await page.goto("/", { waitUntil: "networkidle" });
        await expect(page.getByTestId("auth-notice")).toHaveAttribute("data-state", "expired");
        expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(SHUTTLEPUB_LOOPBACK_SESSION_COOKIE);
        await page.reload({ waitUntil: "networkidle" });
        await expect(page.getByTestId("auth-notice")).toHaveAttribute("data-state", "signed-out");
        expect(errors, `signed-out ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK real mode signed-out / denied / expired login UI at ${viewport.name}`);
      } finally {
        await context.close();
      }
    }
    expect(backend.unexpectedRequests, "a viewer without a session never reaches Emumet or the token/IdP APIs").toEqual([]);
    expect(await server.networkViolations(), "real mode may only reach the configured backend").toEqual([]);
  } finally {
    await server.stop();
    backend.stop();
  }
}

/**
 * Focus around session changes inside the Profile switcher (mock mode, with the BFF's
 * answers for one request replaced in the browser), at both widths:
 *  - the menu opened from the "Profile を選ぶ" notice returns focus to it when cancelled,
 *    and to the header switcher when a chosen Profile resolved the notice;
 *  - on /login, a session lost while switching leaves focus on the login button.
 */
async function verifySessionFocus(browser: Browser, frontendRoot: string, coreURL: string) {
  const server = await startApp(frontendRoot, "ShuttlePub", coreURL);
  const gqlError = (code: string) => ({ status: 200, contentType: "application/json",
    body: JSON.stringify({ data: null, errors: [{ message: code, extensions: { code } }] }) });
  try {
    await server.waitUntilReady();
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openPage(browser, server, viewport);
      try {
        // The selected Profile vanished: only the profileContext read says so.
        await page.route(`${server.url}/graphql`, async (route) => {
          const body = route.request().postData() ?? "";
          if (body.includes("profileContext") && !body.includes("selectProfile")) return route.fulfill(gqlError("PROFILE_UNAVAILABLE"));
          return route.continue();
        });
        await page.goto("/", { waitUntil: "networkidle" });
        await expect(page.getByTestId("app-shell")).toHaveAttribute("data-hydration", "hydrated");
        const notice = page.getByTestId("auth-notice");
        await expect(notice).toHaveAttribute("data-state", "profile-unavailable");
        const choose = notice.getByRole("button", { name: "Profile を選ぶ" });
        await choose.click();
        const menu = page.getByTestId("profile-menu");
        await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
        await expect(choose).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(choose).toBeFocused();
        await choose.click();
        await menu.getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
        await expect(notice).toHaveCount(0);
        await expect(visible(page, /投稿用 Profile を切り替え（現在: Fixture Dev）/)).toBeFocused();
        await page.unroute(`${server.url}/graphql`);

        // On /login (signed in), the session ends while switching.
        await page.route(`${server.url}/graphql`, async (route) =>
          (route.request().postData() ?? "").includes("selectProfile") ? route.fulfill(gqlError("UNAUTHENTICATED")) : route.continue());
        await page.goto("/login", { waitUntil: "networkidle" });
        await expect(page.getByTestId("login-state")).toHaveAttribute("data-state", "signed-in");
        await visible(page, /投稿用 Profile を切り替え/).click();
        await menu.getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
        await expect(menu).toHaveCount(0);
        await expect(page.getByTestId("login-start")).toBeFocused();
        await expect(page.getByTestId("login-link").filter({ visible: true })).toHaveCount(1);
        await page.unroute(`${server.url}/graphql`);
        expect(errors, `session focus ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK focus follows the session state in the Profile switcher at ${viewport.name}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.stop();
  }
}

export async function verifyShuttlePub(frontendRoot: string) {
  if (!isAbsolute(frontendRoot)) throw new Error("FRONTEND_ROOT must be an absolute path");
  if (!(await appExists(frontendRoot, "ShuttlePub"))) throw new Error(`apps/shuttlepub-web is missing in ${frontendRoot}`);
  // startApp requires a Core origin for the preload guard; mock mode never contacts it.
  const unusedCore = startBooskiffStub();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    await verifyMock(browser, frontendRoot, unusedCore.url);
    await verifyRealFailure(browser, frontendRoot, 501);
    await verifyRealFailure(browser, frontendRoot, 500);
    await verifySignedOut(browser, frontendRoot);
    await verifySessionFocus(browser, frontendRoot, unusedCore.url);
    expect(unusedCore.unexpectedRequests).toEqual([]);
    console.info("ShuttlePub hydration, shell behaviour and mock/real checks passed");
  } finally {
    await browser?.close();
    unusedCore.stop();
  }
}

if (import.meta.main) {
  await verifyShuttlePub(resolve(process.env.FRONTEND_ROOT ?? resolve(import.meta.dir, "../../../..")));
}
