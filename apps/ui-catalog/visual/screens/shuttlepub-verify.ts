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
import { chromium, expect, type Browser, type Locator, type Page, type Route } from "@playwright/test";
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
  await expect(text).toBeFocused();
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
  await page.locator("#content article").nth(1).locator(".sp-post-time").click();
  await expect(page).toHaveURL(/\/posts\/post-sora-zine$/);
  await expect(page.getByTestId("post-detail")).toHaveAttribute("data-state", "loaded");
  const replies = page.getByRole("tab", { name: /返信/ });
  const reactions = page.getByRole("tab", { name: /リアクション/ });
  await expect(replies).toHaveAttribute("aria-selected", "true");
  // Two visible replies and two of controlled domains (folded, D08 3-5).
  await expect(replies).toContainText("4");
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

/** The modal owns the focus (it moves in after the dialog is drawn): wait for it before sending keys. */
async function expectFocusInside(layer: Locator) {
  await expect.poll(() => layer.evaluate((element) => element.contains(document.activeElement)), { message: "initial focus is inside the modal" }).toBe(true);
}

/** Tab and Shift+Tab cycle within an aria-modal layer (ui-spec 実装上の注意 6). */
async function expectTabStaysInside(page: Page, layer: Locator) {
  // Waiting for the initial focus keeps a slow runner from testing a focus that has not moved in yet.
  await expectFocusInside(layer);
  const where = () => layer.evaluate((element) => {
    const active = document.activeElement;
    return { inside: element.contains(active), active: active ? `${active.tagName.toLowerCase()}#${active.id}[${active.getAttribute("data-testid") ?? ""}] ${(active.textContent ?? "").slice(0, 24)}` : "none" };
  });
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(key);
      const state = await where();
      expect(state.inside, `${key} #${i + 1} left the modal; active element: ${state.active}`).toBe(true);
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
  await page.locator("#content article").nth(1).locator(".sp-post-time").click();
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

async function switchActingProfile(page: Page, name: string) {
  await visible(page, /投稿用 Profile を切り替え/).click();
  await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: new RegExp(name) }).click();
  await expect(visible(page, new RegExp(`投稿用 Profile を切り替え（現在: ${name}）`))).toHaveCount(1);
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
}

/**
 * D09 (host note-search-ui ui-spec §5, d09-q04/q05/q06): another server's emoji is reused
 * only by piggybacking on an existing chip. It carries the globe mark and is always the
 * `:name:` text (the browser never requests an image from another server), a missing /
 * deleted one looks the same and stays pressable, it is not in the picker or favourites,
 * and a reaction on it is removed / undone / switched like any other. Profiles stay apart.
 */
async function verifyRemoteEmoji(page: Page, viewport: Viewport) {
  const sent = recordOperations(page);
  const external: string[] = [];
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && request.url().startsWith("http")) external.push(request.url());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  // The post that carries the chips of other servers (its position changes with the Profile's filters).
  const chips = page.getByTestId("reactions").filter({ has: page.locator('[data-emoji="c:ghostcat@remote.example"]') });
  const chip = (id: string) => chips.locator(`[data-emoji="c:${id}"]`);
  const toast = page.getByTestId("reaction-toast");
  const mine = page.locator("#react-mine-post-aoi-profiles");
  const operations = (name: string) => sent.filter((operation) => operation === name).length;

  // Look: globe right after the emoji and before the count; :name: text, no image of any server.
  const kusaRemote = chip("kusa@remote.example");
  await expect(kusaRemote).toHaveClass(/is-external/);
  await expect(kusaRemote.locator(".sp-emo-label")).toHaveText(":kusa:");
  await expect(kusaRemote.getByTestId("origin-mark")).toHaveCount(1);
  await expect(kusaRemote.locator("img")).toHaveCount(0);
  await expect(kusaRemote).toHaveAttribute("aria-label", /^:kusa:（remote\.example） でリアクション（\d+：/);
  expect(await kusaRemote.evaluate((element) => [...element.children].map((child) => child.className.split(" ")[1] ?? child.className))).toEqual(["sp-emo-label", "sp-origin", "sp-rchip-count"].map((name) => name));
  const globe = await kusaRemote.getByTestId("origin-mark").boundingBox();
  expect(Math.round(globe!.width), "globe is 11px").toBe(11);
  // Same shortcode from this server: the image, no globe.
  const kusaLocal = chip("kusa");
  await expect(kusaLocal.locator("img")).toHaveCount(1);
  await expect(kusaLocal.getByTestId("origin-mark")).toHaveCount(0);
  await expect(kusaLocal).not.toHaveClass(/is-external/);
  // Image missing, and deleted at the origin (still available): the same look, still pressable.
  for (const id of ["ghostcat@remote.example", "goneblob@remote.example"]) {
    await expect(chip(id)).toHaveClass(/is-external/);
    await expect(chip(id).getByTestId("origin-mark")).toHaveCount(1);
    await expect(chip(id).locator("img")).toHaveCount(0);
    await expect(chip(id)).toBeEnabled();
    await expect(chip(id)).not.toHaveAttribute("aria-disabled", "true");
  }
  await expect(chip("ghostcat@remote.example").locator(".sp-emo-label")).toHaveText(":ghostcat:");
  await expect(chip("goneblob@remote.example").locator(".sp-emo-label")).toHaveText(":goneblob:");
  // d09-q06: nothing was requested from another server, and no <img> points at one.
  await expect(page.locator('img[src^="http"]')).toHaveCount(0);
  expect(external, "no request to another origin").toEqual([]);

  // A local image that fails to load falls back to its :name: (no broken image).
  const wrapper = kusaLocal.locator(".sp-emo-custom");
  await expect(wrapper).not.toHaveAttribute("data-image-failed", /.*/);
  await expect(kusaLocal.locator(".sp-emo-name")).toBeHidden();
  await kusaLocal.locator("img").evaluate((image) => { (image as HTMLImageElement).src = "data:image/png;base64,AAAA"; });
  await expect(wrapper).toHaveAttribute("data-image-failed", "true");
  await expect(kusaLocal.locator("img")).toBeHidden();
  await expect(kusaLocal.locator(".sp-emo-name")).toBeVisible();

  // Not in the picker (grid, custom category, search) nor in the favourites.
  const opener = page.locator("#react-post-mika-picker");
  await opener.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("picker-favorites").getByRole("button", { name: /remote\.example|other\.example|ghostcat|partycat|goneblob/ })).toHaveCount(0);
  await picker.getByRole("tab", { name: "このサーバーのカスタム絵文字" }).click();
  const grid = picker.getByTestId("picker-grid");
  await expect(grid.getByRole("button", { name: ":kusa:" })).toHaveCount(1);
  await expect(grid.getByRole("button", { name: /（.*）/ })).toHaveCount(0);
  await picker.getByRole("searchbox", { name: "絵文字を検索" }).fill("partycat");
  await expect(grid.getByRole("button")).toHaveCount(0);
  await picker.getByRole("searchbox", { name: "絵文字を検索" }).fill("kusa");
  await expect(grid.getByRole("button")).toHaveCount(1);
  await expect(grid.getByRole("button", { name: ":kusa:" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Piggyback: one chip press reacts (my chip first), the count goes up.
  const before = Number(await kusaRemote.locator(".sp-rchip-count").textContent());
  await kusaRemote.click();
  await expect(mine).toBeFocused();
  await expect(mine).not.toHaveAttribute("aria-busy", "true");
  await expect(mine).toHaveAttribute("data-emoji", "c:kusa@remote.example");
  await expect(mine.getByTestId("origin-mark")).toHaveCount(1);
  await expect(mine.locator(".sp-rchip-count")).toHaveText(String(before + 1));
  await expect(chips.locator(".sp-rchip").first()).toHaveAttribute("id", "react-mine-post-aoi-profiles");
  await expect(page.locator("#react-post-aoi-profiles")).toHaveCount(0);
  expect(operations("SetNoteReaction")).toBe(1);

  // One reaction per post: the other chips can no longer be pressed.
  await expect(chip("ghostcat@remote.example")).toHaveCount(1);
  await expect(chips.locator("button.sp-rchip:not(.is-mine)")).toHaveCount(0);

  // Remove -> undo restores -> remove -> the removal is sent when switching to another chip.
  await mine.click();
  await expect(mine).toHaveCount(0);
  await expect(toast).toContainText("取り消しました");
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(mine).toBeFocused();
  await expect(mine).toHaveAttribute("data-emoji", "c:kusa@remote.example");
  await mine.click();
  await expect(toast).toContainText("取り消しました");
  await expect(chip("ghostcat@remote.example")).toBeEnabled();
  await chip("ghostcat@remote.example").click();
  await expect(mine).toHaveAttribute("data-emoji", "c:ghostcat@remote.example");
  await expect(mine).not.toHaveAttribute("aria-busy", "true");
  await expect(mine.locator(".sp-emo-label")).toHaveText(":ghostcat:");
  const order = sent.filter((name) => name === "SetNoteReaction" || name === "RemoveNoteReaction");
  expect(order, "the unsent removal goes before the next external PUT (S3: 409 while reacted)").toEqual(["SetNoteReaction", "RemoveNoteReaction", "SetNoteReaction"]);
  await expect(page.locator(".sp-toast[data-error]")).toHaveCount(0);

  // Profiles stay apart: another Profile sees it as somebody else's chip and may use it.
  await switchActingProfile(page, "Fixture Dev");
  await expect(page.locator("#react-mine-post-aoi-profiles")).toHaveCount(0);
  await expect(chip("ghostcat@remote.example").locator(".sp-rchip-count")).toHaveText("2");
  await switchActingProfile(page, "Fixture Profile");
  await expect(page.locator("#react-mine-post-aoi-profiles")).toHaveAttribute("data-emoji", "c:ghostcat@remote.example");
  await mine.click();
  await expect(toast).toContainText("取り消しました");
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await expect(mine).toHaveCount(0);

  // Deleted at its origin (d09-q07): still available, only the image is gone. Its chip is pressed like
  // the others and the reaction is saved (200), shown as :name:.
  await chip("goneblob@remote.example").click();
  await expect(mine).toHaveAttribute("data-emoji", "c:goneblob@remote.example");
  await expect(mine).not.toHaveAttribute("aria-busy", "true");
  await expect(mine.locator(".sp-emo-label")).toHaveText(":goneblob:");
  await expect(mine.getByTestId("origin-mark")).toHaveCount(1);
  await expect(page.locator(".sp-toast[data-error]")).toHaveCount(0);
  await mine.click();
  await expect(toast).toContainText("取り消しました");
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await expect(mine).toHaveCount(0);

  // Disabled by this server (the only unavailable external emoji): the same :name: + globe, but not
  // pressable, and nothing is sent.
  const off = chip("offblob@remote.example");
  await expect(off).toHaveClass(/is-unavailable/);
  await expect(off.getByTestId("origin-mark")).toHaveCount(1);
  await expect(off.locator(".sp-emo-label")).toHaveText(":offblob:");
  await expect(off.locator("img")).toHaveCount(0);
  expect(await off.evaluate((element) => element.tagName)).toBe("SPAN");
  const setsDisabled = operations("SetNoteReaction");
  await off.click({ force: true });
  await page.waitForTimeout(300);
  expect(operations("SetNoteReaction"), "a disabled external emoji sends nothing").toBe(setsDisabled);
  await expect(mine).toHaveCount(0);
  await expect(page.locator("#react-post-aoi-profiles")).toBeVisible();

  // A slow response keeps the post busy and sends nothing else; then it settles.
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  const finish = await gateOperation(page, "SetNoteReaction", "pass");
  await chip("kusa@remote.example").click();
  const setsBefore = operations("SetNoteReaction");
  await expect.poll(() => operations("SetNoteReaction")).toBe(setsBefore);
  await chip("ghostcat@remote.example").click({ timeout: 1_000 }).catch(() => undefined);
  await finish();
  await expect(mine).toHaveAttribute("data-emoji", "c:kusa@remote.example");
  await expect(mine).not.toHaveAttribute("aria-busy", "true");
  expect(operations("SetNoteReaction") - setsBefore, "nothing else sent while the response is pending").toBe(0);
  expect(external, "still no request to another origin").toEqual([]);
  console.info(`OK another server's emoji: globe + :name:, never in the picker, piggyback / undo / switch / Profile / refused / slow at ${viewport.name}`);
}

/**
 * A failed image mark belongs to the image that is shown: Flame reuses the emoji wrapper when a
 * favourite is replaced in place, so a mark left by the old emoji must not hide the new one,
 * while drawing the same emoji again keeps its :name: (no flicker back to a broken image).
 */
async function verifyImageFailureFollowsEmoji(page: Page, viewport: Viewport) {
  await page.goto("/settings", { waitUntil: "networkidle" });
  const chips = page.getByTestId("favorites");
  await expect(chips).toHaveAttribute("data-state", "loaded");
  const chip = (index: number) => page.locator(`#sp-fav-chip-${index}`);
  const wrapper = chip(4).locator(".sp-emo-custom");
  await expect(wrapper).toHaveCount(1);
  await chip(4).locator("img").evaluate((image) => { (image as HTMLImageElement).src = "data:image/png;base64,AAAA"; });
  await expect(wrapper).toHaveAttribute("data-image-failed", "true");
  await expect(chip(4).locator(".sp-emo-name")).toBeVisible();
  // The same emoji drawn again (the menu opens and closes): still the name, never a broken image.
  await chip(4).click();
  const menu = page.getByTestId("favorite-menu");
  await expect(menu.getByRole("menuitem").first()).toHaveText("入れ替え");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(wrapper).toHaveAttribute("data-image-failed", "true");
  await expect(chip(4).locator("img")).toBeHidden();
  // Replaced in place by another custom emoji: its image shows, the mark is gone.
  await chip(4).click();
  await menu.getByRole("menuitem", { name: "入れ替え" }).click();
  const picker = page.getByRole("dialog", { name: "常用絵文字を入れ替え" });
  await picker.getByRole("tab", { name: "このサーバーのカスタム絵文字" }).click();
  await picker.getByRole("button", { name: ":ok_sign:" }).click();
  await expect(picker).toHaveCount(0);
  await expect(chips).toHaveAttribute("aria-busy", "false");
  await expect(chip(4)).toHaveAttribute("aria-label", ":ok_sign:");
  await expect(chip(4).locator(".sp-emo-custom")).not.toHaveAttribute("data-image-failed", /.*/);
  await expect(chip(4).locator("img")).toBeVisible();
  await expect(chip(4).locator(".sp-emo-name")).toBeHidden();
  console.info(`OK a failed emoji image does not hide the emoji that replaces it (favourites replaced in place) at ${viewport.name}`);
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

async function holdFocusFrames(page: Page) {
  const gate = await page.evaluateHandle(() => {
    const original = window.requestAnimationFrame;
    const pending: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => pending.push(callback);
    return { original, pending };
  });
  let released = false;
  return {
    count: () => gate.evaluate(({ pending }) => pending.length),
    release: async () => {
      if (released) return;
      released = true;
      await gate.evaluate(({ original, pending }) => {
        window.requestAnimationFrame = original;
        pending.splice(0).forEach((callback) => callback(performance.now()));
      });
      await gate.dispose();
    },
  };
}

// F6/F7: persist the PUT in the real stateful mock, lose only its reply, and hold
// revalidation while the user focuses the button, opens a picker, or moves away.
async function verifyAmbiguousReactionRestore(page: Page, viewport: Viewport, server: AppServer) {
  for (const mode of ["button", "picker", "other-control", "escape", "escape-other-control"] as const) {
    await resetMock(server);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("body"), "initial reaction GET must not acquire focus").toBeFocused();
    const button = page.locator("#react-post-mika-picker");
    const mine = page.locator("#react-mine-post-mika-picker");
    const picker = page.getByTestId("picker");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let releaseReply!: () => void;
    const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
    const handled: Promise<void>[] = [];
    let frames: Awaited<ReturnType<typeof holdFocusFrames>> | undefined;
    let saved = false;
    let readsHeld = 0;
    const intercept = (route: Route) => {
      const handling = (async () => {
        const query = String(route.request().postDataJSON()?.query ?? "");
        if (/^\s*mutation\s+SetNoteReaction\b/.test(query)) {
          const stored = await route.fetch();
          expect(stored.status()).toBe(200);
          expect((await stored.json()).errors, "the PUT really saved before its reply was lost").toBeUndefined();
          saved = true;
          await replyGate;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
            data: null, errors: [{ message: "reply lost after save", extensions: { code: "UPSTREAM_ERROR" } }],
          }) });
        } else if (saved && /^\s*query\s+PostReactions\b/.test(query)) {
          readsHeld++;
          await gate;
          await route.continue();
        } else await route.continue();
      })();
      handled.push(handling);
      return handling;
    };
    await page.route("**/graphql", intercept);
    try {
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(viewport.name === "mobile" ? picker : page.locator("#sp-picker-search")).toBeFocused();
      await picker.getByTestId("picker-favorites").getByRole("button", { name: "いいね" }).focus();
      await page.keyboard.press("Enter");
      await expect(mine).toBeFocused();
      await expect.poll(() => saved).toBe(true);
      releaseReply();
      await expect(page.getByTestId("reaction-toast")).toContainText("リアクションできませんでした");
      // The optimistic chip may become another live chip after rollback; place
      // focus on the retry origin before exercising its later removal by GET.
      await button.focus();
      await expect(button).toBeFocused();
      await expect.poll(() => readsHeld).toBe(1);
      if (mode === "picker" || mode.startsWith("escape")) {
        await page.keyboard.press("Enter");
        await expect(viewport.name === "mobile" ? picker : page.locator("#sp-picker-search")).toBeFocused();
        if (mode.startsWith("escape")) {
          // Fix the order: Esc patches the picker out, GET removes its opener,
          // and only then may the reserved focus callbacks run.
          frames = await holdFocusFrames(page);
          await page.keyboard.press("Escape");
          await expect(picker).toHaveCount(0);
          await expect(button).toBeVisible();
          expect(await frames.count()).toBeGreaterThan(0);
          if (mode === "escape-other-control") await visible(page, "投稿する").focus();
        }
      } else if (mode === "other-control") {
        await visible(page, "投稿する").focus();
      }
      release();
      await expect(mine).toBeVisible();
      await expect(button).toHaveCount(0);
      await expect(picker, "server restoration closes the anchored picker").toHaveCount(0);
      await expect(page.locator(".sp-reaction-layer .sp-clickaway, .sp-reaction-layer .sp-sheet-backdrop, .sp-reaction-layer .sp-modal-backdrop")).toHaveCount(0);
      await expectScrollLocked(page, false);
      if (mode === "escape") await expect(page.locator("body"), "focus callbacks are still held until after GET").toBeFocused();
      await frames?.release();
      if (mode === "other-control" || mode === "escape-other-control") await expect(visible(page, "投稿する"), "unrelated focus is not stolen").toBeFocused();
      else await expect(mine, "focus lost from the removed button / picker follows my chip").toBeFocused();
    } finally {
      await frames?.release();
      releaseReply();
      release();
      await Promise.all(handled);
      await page.unroute("**/graphql", intercept);
    }
  }
  console.info(`OK saved PUT with failed reply / delayed GET / Esc-before-focus restores picker and focus at ${viewport.name}`);
}

/**
 * D08 設定「ミュート・ブロック」(personal-domain-controls-web-ui) inside the shell: reached
 * from 設定, the mobile "‹ 設定" goes back to it, the unconnected post-side effects are stated,
 * and a dialog owns the keyboard: the toast's "元に戻す" outside it is unreachable (inert)
 * while the dialog is open, Tab stays inside, Esc closes it and returns focus.
 */
/**
 * Quick reaction x mute/block in one browser: the "利用できません" toast (P2) outlives the
 * navigation to the mute/block page. While the add dialog is open that toast is behind
 * it and inert: Tab never reaches 「入れ替える」, and even a click delivered to it does not
 * navigate away, so the URL, the typed domain and the focus stay.
 */
async function verifyReactionToastUnderMuteBlock(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  await expect(page.locator("#content article").first().getByTestId("reactions")).toBeVisible();
  await page.locator("#react-post-mika-picker").click();
  const picker = page.getByTestId("picker");
  // aria-disabled: still clickable, it explains why it cannot be picked (P2).
  await picker.getByTestId("picker-favorites").getByRole("button", { name: ":old_blob:（利用不可）" }).click({ force: true });
  const toast = page.getByTestId("reaction-toast");
  await expect(toast).toContainText("利用できません");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  // In-app navigation keeps the toast (Client.Reaction.leaveScreen).
  await page.getByRole("link", { name: "設定" }).filter({ visible: true }).first().click();
  await page.locator("#content").getByTestId("settings-mute-block").click();
  await expect(page).toHaveURL(/\/settings\/mute-block\/domains$/);
  await expect(page.getByTestId("domain-panel").locator("section")).toHaveAttribute("data-state", "loaded");
  await expect(toast).toBeVisible();
  await page.locator("#mb-add-button").click();
  const input = page.locator("#mb-add-input");
  await expect(input).toBeFocused();
  await page.keyboard.type("keep-me.example");
  await expect(toast).toHaveAttribute("inert", "");
  await expect(toast).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("button", { name: "入れ替える" })).toHaveCount(0);
  // A click that still reaches the button (dispatched directly, bypassing inert) is refused.
  await toast.locator("button").dispatchEvent("click");
  await expect(page).toHaveURL(/\/settings\/mute-block\/domains$/);
  await expect(page.getByTestId("add-dialog")).toBeVisible();
  await expect(input).toHaveValue("keep-me.example");
  await expect(input).toBeFocused();
  await expectTabStaysInside(page, page.getByTestId("add-dialog"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
}

async function verifyMuteBlock(page: Page, viewport: Viewport) {
  const content = page.locator("#content");
  await page.goto("/settings", { waitUntil: "networkidle" });
  await content.getByTestId("settings-mute-block").click();
  await expect(page).toHaveURL(/\/settings\/mute-block\/domains$/);
  const list = page.getByTestId("domain-panel").locator("section");
  await expect(list).toHaveAttribute("data-state", "loaded");
  await expect(page.getByTestId("mute-block-scope")).toContainText("投稿の非表示とリアクションの拒否はまだ反映されません");
  const back = page.getByTestId("mute-block-back");
  if (viewport.name === "mobile") {
    await back.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(content.getByTestId("settings-mute-block")).toBeVisible();
    await content.getByTestId("settings-mute-block").click();
    await expect(list).toHaveAttribute("data-state", "loaded");
  } else {
    await expect(back).toBeHidden();
  }

  // Keyboard: immediate unmute with an undo toast.
  await page.getByRole("button", { name: "ミュート解除（noisy.social）" }).focus();
  await page.keyboard.press("Enter");
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("noisy.social のミュートを解除しました");
  await expect(page.getByRole("button", { name: "元に戻す" })).toHaveCount(1);

  // A dialog opened meanwhile owns the keyboard; the toast is outside it and inert.
  const opener = page.locator("#mb-add-button");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("add-dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#mb-add-input")).toBeFocused();
  await page.keyboard.type("half-typed.exa");
  await expect(page.getByTestId("toast-region")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "元に戻す" })).toHaveCount(0);
  await expectTabStaysInside(page, dialog);
  await expectScrollLocked(page, true);
  await expect(page.locator("#mb-add-input")).toHaveValue("half-typed.exa");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectScrollLocked(page, false);

  // Put the shared stateful mock back (undo if the toast is still there).
  const undo = page.getByRole("button", { name: "元に戻す" });
  if (await undo.count()) {
    await undo.click();
  } else {
    await opener.click();
    await page.locator("#mb-add-input").fill("noisy.social");
    await dialog.getByRole("button", { name: "ミュート", exact: true }).click();
    await page.getByTestId("mute-dialog").getByRole("button", { name: "ミュート", exact: true }).click();
  }
  await expect(page.locator('li[data-domain="noisy.social"]')).toBeVisible();

  // Our own server is refused; a block that detaches follows needs the acknowledgement.
  await opener.click();
  await page.locator("#mb-add-input").fill("https://shuttlepub.example/@me");
  await dialog.getByRole("button", { name: "ブロック", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("自分のサーバーは指定できません");
  await page.locator("#mb-add-input").fill("example.social");
  await dialog.getByRole("button", { name: "ブロック", exact: true }).click();
  const block = page.getByTestId("block-dialog");
  await expect(block.getByTestId("block-impact")).toContainText("フォロー中 3 人・フォロワー 5 人");
  await expect(block.getByRole("button", { name: "ブロック", exact: true })).toBeDisabled();
  await expectTabStaysInside(page, block);
  // The accounts a block detaches open from the keyboard: Tab reaches the disclosure,
  // Enter / Space toggle it.
  const disclosure = block.locator("summary");
  const details = block.locator("details");
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await disclosure.evaluate((element) => element === document.activeElement);
  }
  expect(reached, "Tab reaches 対象を表示 inside the block dialog").toBe(true);
  await expect(details).not.toHaveAttribute("open");
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(block.getByText("example.social/users/alice")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open");
  await page.keyboard.press("Space");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(block).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Switching the Profile in the shell reloads the page for that Profile (the mock acts
  // as the Profile the page shows); its settings stay separate from the first Profile.
  await switchProfile(page, "Fixture Dev");
  await expect(list).toHaveAttribute("data-state", "loaded");
  await expect(page.locator('li[data-domain="noisy.social"]')).toHaveCount(0);
  await opener.click();
  await page.locator("#mb-add-input").fill("only-dev.example");
  await dialog.getByRole("button", { name: "ミュート", exact: true }).click();
  await page.getByTestId("mute-dialog").getByRole("button", { name: "ミュート", exact: true }).click();
  await expect(toast).toContainText("only-dev.example をミュートしました");
  await expect(page.locator('li[data-domain="only-dev.example"]')).toBeVisible();
  await switchProfile(page, "Fixture Profile");
  await expect(page.locator('li[data-domain="noisy.social"]')).toBeVisible();
  await expect(page.locator('li[data-domain="only-dev.example"]')).toHaveCount(0);
  await switchProfile(page, "Fixture Dev");
  const devRow = page.locator('li[data-domain="only-dev.example"]');
  await expect(devRow).toBeVisible();
  await devRow.getByRole("button", { name: "ミュート解除（only-dev.example）" }).click();
  await expect(devRow).toHaveCount(0);
  await switchProfile(page, "Fixture Profile");
  await expect(page.locator('li[data-domain="noisy.social"]')).toBeVisible();
}

/**
 * D08 account list (ui-spec 1-6, d08-q18 / d08-q20, d09-q06): icon, name and acct from
 * target_actor for local / remote and resolved / pending / unavailable / sparse targets, an
 * avatar URL is never requested (the seed has avatars on a remote and on a local target), and
 * unmuting / unblocking names the person as the list does. The seeded rows are put back.
 */
async function verifyMuteBlockAccounts(page: Page, viewport: Viewport) {
  const external: string[] = [];
  const images: string[] = [];
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && request.url().startsWith("http")) external.push(request.url());
    if (request.resourceType() === "image") images.push(request.url());
  });
  await page.goto("/settings/mute-block/accounts", { waitUntil: "networkidle" });
  const panel = page.getByTestId("account-panel");
  await expect(panel.locator("section")).toHaveAttribute("data-state", "loaded");
  const row = (actorUrl: string) => panel.locator(`li[data-actor="${actorUrl}"]`);
  const expectRow = async (actorUrl: string, name: string, acct: string | null, initial: string, label: string, action: string) => {
    const item = row(actorUrl);
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("actor-name")).toHaveText(name);
    if (acct === null) await expect(item.getByTestId("actor-acct")).toHaveCount(0);
    else await expect(item.getByTestId("actor-acct")).toHaveText(acct);
    await expect(item.getByTestId("actor-icon")).toHaveText(initial);
    await expect(item.getByRole("button", { name: label })).toHaveCount(1);
    // No badge, no state text, no date: icon, name, acct and the button text are all of it.
    const text = (await item.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe([initial, name, acct, action].filter((part) => part !== null).join(" "));
  };
  // remote resolved with an avatar URL on another server; local resolved with an avatar on this server.
  await expectRow("https://spam.example/users/spam_bot", "Spam Bot", "@spam_bot@spam.example", "S", "ブロック解除（Spam Bot）", "ブロック解除");
  await expectRow("https://chat.example/users/loud", "Loud", "@loud@chat.example", "L", "ミュート解除（Loud）", "ミュート解除");
  await expectRow("https://shuttlepub.example/users/kei", "Kei", "@kei@shuttlepub.example", "K", "ミュート解除（Kei）", "ミュート解除");
  // pending / unavailable: the actor URL stands in for the name, nothing else is said.
  await expectRow("https://ads.example/users/ad_bot", "https://ads.example/users/ad_bot", null, "A", "ブロック解除（https://ads.example/users/ad_bot）", "ブロック解除");
  await expectRow("https://anime.example/users/spoiler", "https://anime.example/users/spoiler", null, "S", "ミュート解除（https://anime.example/users/spoiler）", "ミュート解除");
  // resolved with the acct only: "@acct" is the name, with no second line repeating it.
  await expectRow("https://small.example/users/quiet", "@quiet@small.example", null, "Q", "ブロック解除（@quiet@small.example）", "ブロック解除");
  await expect(panel.locator("img")).toHaveCount(0);
  // Unmute: its name in the toast, 元に戻す brings the same person back.
  const removed: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/graphql") || request.method() !== "POST") return;
    const body = request.postData() ?? "";
    if (/removeActorPolicy/.test(body)) removed.push(body);
  });
  const loudPolicy = await row("https://chat.example/users/loud").getAttribute("data-policy");
  expect(loudPolicy, "the row carries its policy id").toBeTruthy();
  await row("https://chat.example/users/loud").getByRole("button", { name: "ミュート解除（Loud）" }).click();
  await expect(page.getByTestId("toast")).toContainText("Loud のミュートを解除しました");
  await expect(row("https://chat.example/users/loud")).toHaveCount(0);
  expect(removed, "one removal was sent").toHaveLength(1);
  expect(removed[0], "the unmute sent the row's own policy id").toContain(loudPolicy!);
  for (const other of await panel.locator("li[data-policy]").evaluateAll((items) => items.map((item) => item.getAttribute("data-policy")))) {
    if (other !== loudPolicy) expect(removed[0], "and no other row's id").not.toContain(other!);
  }
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(row("https://chat.example/users/loud")).toHaveCount(1);
  // Unblock: the dialog calls a pending target by its fallback name and a resolved one by its display name.
  await row("https://ads.example/users/ad_bot").getByRole("button", { name: /ブロック解除/ }).click();
  const dialog = page.getByTestId("unblock-dialog");
  await expect(dialog).toContainText("https://ads.example/users/ad_bot のブロックを解除しますか？");
  await expectFocusInside(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await row("https://spam.example/users/spam_bot").getByRole("button", { name: /ブロック解除/ }).click();
  await expect(dialog).toContainText("Spam Bot のブロックを解除しますか？");
  await expectFocusInside(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The filter shows the same rows by kind.
  await panel.getByRole("button", { name: "ブロック", exact: true }).click();
  await expect(panel.locator("li")).toHaveCount(3);
  await panel.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(panel.locator("li")).toHaveCount(6);
  expect(external, "no request to another origin (no avatar of any server is loaded)").toEqual([]);
  expect(images.filter((url) => /avatars|\/media\//.test(url)), `no avatar image at ${viewport.name}`).toEqual([]);
}

/**
 * D08 second stage (host personal-domain-controls-ui ui-spec v5 1-1 主導線, 3-x, 4-1, 5-1;
 * S8 contract in the mock): the post menu by keyboard, immediate mute with 元に戻す, the
 * block confirmation over an inert shell, hidden / revealed direct views (reveal is
 * page-local and never carried to another Profile or a reload), locked operations and
 * the 4-1 sheet with the settings' unblock dialog, folded replies and a person's page.
 * The shared policy mock is put back as it was (noisy.social muted, bot-farm.example blocked).
 */
async function verifyDomainContent(page: Page, viewport: Viewport) {
  const content = page.locator("#content");
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
  await expect(content.locator("article")).toHaveCount(5);
  // 5-1: the default Profile's muted / blocked domains leave no trace on the timeline.
  for (const trace of ["noisy.social", "bot-farm.example", "Nana", "Deals Bot", "これめちゃくちゃ分かる"]) {
    await expect(content).not.toContainText(trace);
  }

  // The menu by keyboard: first item focused, arrows move, Esc returns to the button.
  const more = page.locator("#sp-more-post-mika-picker");
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByTestId("post-menu");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expect(menu.getByRole("menuitem")).toHaveText(["@mika をミュート", "@mika をブロック", "misskey.example をミュート", "misskey.example をブロック"]);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  if (viewport.name === "mobile") {
    await expect(page.getByRole("dialog", { name: "その他" })).toHaveAttribute("aria-modal", "true");
    await expectScrollLocked(page, true);
    await expectTabStaysInside(page, menu);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expectScrollLocked(page, false);

  // 1-1: mute is immediate, with 元に戻す; the post goes without trace and comes back.
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "misskey.example をミュート" }).focus();
  await page.keyboard.press("Enter");
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("misskey.example をミュートしました");
  await expect(content.locator('article[data-post-id="post-mika-picker"]')).toHaveCount(0);
  await expect(content.locator("article")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(content.locator('article[data-post-id="post-mika-picker"]')).toHaveCount(1);

  // 1-1 / 2-1 … 2-3: a block asks first; the shell behind the dialog is inert.
  await page.locator("#sp-more-post-nekota-coffee").click();
  await menu.getByRole("menuitem", { name: "mstdn.example をブロック" }).click();
  const block = page.getByTestId("block-dialog");
  await expect(block).toContainText("mstdn.example をブロックしますか？");
  await expect(block.getByRole("button", { name: "代わりにミュート" })).toBeVisible();
  await expect(page.locator(".sp-body")).toHaveAttribute("inert", "");
  await expectTabStaysInside(page, block);
  await page.keyboard.press("Escape");
  await expect(block).toHaveCount(0);
  await expect(page.locator("#sp-more-post-nekota-coffee")).toBeFocused();
  await expect(page.locator(".sp-body")).not.toHaveAttribute("inert", "");

  // 3-1 / 3-2: a muted domain's post by URL: kind and domain only, then this post only.
  await page.goto("/posts/post-nana-playlist", { waitUntil: "networkidle" });
  const hidden = page.getByTestId("hidden-post");
  await expect(hidden).toHaveAttribute("data-mode", "mute");
  await expect(hidden).toContainText("ミュート中のドメインの投稿です");
  await expect(hidden).toContainText("noisy.social");
  await expect(content).not.toContainText("プレイリスト");
  await expect(content).not.toContainText("Nana");
  await page.getByRole("button", { name: "この投稿だけ表示" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("revealed-bar")).toContainText("noisy.social · ミュート中");
  await expect(page.getByRole("button", { name: "隠す" })).toBeFocused();
  await expect(content).toContainText("プレイリスト");
  // Mute adds no operation restriction.
  await expect(content.locator("[data-locked]")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(hidden).toBeVisible();
  await expect(page.getByRole("button", { name: "この投稿だけ表示" })).toBeFocused();
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  await expect(content).toContainText("プレイリスト");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("hidden-post")).toBeVisible();
  await expect(content).not.toContainText("プレイリスト");

  // 3-3 / 4-1 / 4-2: a blocked domain's post stays locked after the reveal; the sheet
  // leads to the settings' unblock dialog; unblocking and blocking again round-trip.
  await page.goto("/posts/post-deals-sale", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  const locked = page.locator('[data-locked="reply"]');
  await expect(locked).toHaveAttribute("aria-label", "返信（ブロック中）");
  await locked.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByTestId("blocked-sheet");
  await expect(sheet.getByRole("heading")).toHaveText("返信できません");
  await expect(sheet).toContainText("bot-farm.example をブロック中です。");
  await expect(sheet.getByRole("button", { name: "閉じる" })).toBeFocused();
  await expectTabStaysInside(page, sheet);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(locked).toBeFocused();
  await page.keyboard.press("Enter");
  await sheet.getByRole("button", { name: "ブロックを解除…" }).click();
  const unblock = page.getByTestId("unblock-dialog");
  await expect(unblock).toContainText("bot-farm.example のブロックを解除しますか？");
  await expect(unblock.getByRole("button", { name: "ミュートに変更" })).toBeVisible();
  await unblock.getByRole("button", { name: "ブロック解除" }).click();
  await expect(toast).toContainText("bot-farm.example のブロックを解除しました");
  // Unblocked: the page shows the post as is, nothing locked any more.
  await expect(content.locator("[data-locked]")).toHaveCount(0);
  await expect(page.getByTestId("revealed-bar")).toHaveCount(0);
  await content.locator("#sp-more-post-deals-sale").click();
  await menu.getByRole("menuitem", { name: "bot-farm.example をブロック" }).click();
  await block.getByRole("button", { name: "ブロック", exact: true }).click();
  await expect(toast).toContainText("bot-farm.example をブロックしました");
  // The page's reveal still holds (3-2), now under the block again: locked.
  await expect(page.getByTestId("revealed-bar")).toContainText("bot-farm.example · ブロック中");
  await expect(locked).toBeVisible();
  await page.getByRole("button", { name: "隠す" }).click();
  await expect(page.getByTestId("hidden-post")).toHaveAttribute("data-mode", "block");

  // A reveal belongs to the Profile that made it: another Profile (no controls) sees the
  // post as is, and coming back starts hidden again.
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  await expect(page.getByTestId("revealed-bar")).toBeVisible();
  await visible(page, /投稿用 Profile を切り替え/).click();
  await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
  await expect(page.getByTestId("hidden-post")).toHaveCount(0);
  await expect(page.getByTestId("revealed-bar")).toHaveCount(0);
  await expect(content).toContainText("期間限定セール");
  await visible(page, /投稿用 Profile を切り替え/).click();
  await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: /Fixture Profile/ }).click();
  await expect(page.getByTestId("hidden-post")).toHaveAttribute("data-mode", "block");
  await expect(content).not.toContainText("期間限定セール");

  // 3-4 (S8): a quote of a muted post is hidden whole by the quoted domain (cause QUOTE);
  // one reveal shows the quote together with its target, and the quoter can be acted on.
  await page.goto("/posts/post-ken-quote", { waitUntil: "networkidle" });
  // d08-q19: it says it is a quote and names the quoted source; nothing of the quoter or the quoted post.
  const quoteHidden = page.getByTestId("hidden-post");
  await expect(quoteHidden).toHaveAttribute("data-cause", "quote");
  await expect(quoteHidden).toContainText("ミュート中のドメインの投稿を引用しています");
  await expect(page.getByTestId("hidden-source")).toHaveText("引用元: noisy.social");
  await expect(quoteHidden).not.toContainText("ミュート中のドメインの投稿です");
  await expect(content).not.toContainText("これめちゃくちゃ分かる");
  await expect(content).not.toContainText("Ken");
  await expect(content).not.toContainText("プレイリスト");
  await expect(content.getByTestId("quote")).toHaveCount(0);
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  await expect(content).toContainText("これめちゃくちゃ分かる");
  await expect(content.getByTestId("quote")).toContainText("プレイリスト");
  await expect(content.getByTestId("quote")).not.toHaveAttribute("data-state", "hidden");
  await expect(content.locator("[data-locked]")).toHaveCount(0);

  // 3-5: replies of controlled domains fold, then show one by one.
  await page.goto("/posts/post-sora-zine", { waitUntil: "networkidle" });
  const fold = page.getByTestId("hidden-replies");
  await expect(fold).toHaveText("非表示の返信 2 件");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("hidden-reply")).toHaveCount(2);
  await expect(content).not.toContainText("通販あるなら絶対買う");
  await page.getByTestId("hidden-reply").first().getByRole("button", { name: "表示" }).click();
  await expect(content).toContainText("通販あるなら絶対買う");
  await expect(page.getByTestId("hidden-reply")).toHaveCount(1);

  // 3-6 / 4-1: a blocked person's page: badge and bio, posts hidden, follow locked.
  await page.goto("/users/deals%40bot-farm.example", { waitUntil: "networkidle" });
  await expect(page.getByTestId("domain-badge")).toHaveText("ブロック中のドメイン");
  await expect(content).toContainText("セール情報を自動でお届けします。");
  await expect(page.getByTestId("hidden-post")).toBeVisible();
  await expect(content).not.toContainText("期間限定セール");
  await page.locator("#sp-follow").click();
  await expect(sheet.getByRole("heading")).toHaveText("フォローできません");
  await expect(sheet.getByRole("button", { name: "閉じる" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sp-follow")).toBeFocused();
  await page.getByRole("button", { name: "投稿を表示" }).click();
  await expect(page.getByTestId("revealed-posts")).toBeVisible();
  await expect(content).toContainText("期間限定セール");
  // A CW stays restricted after the reveal: no content.
  await expect(page.getByTestId("restricted-post")).toHaveAttribute("data-reason", "cw");
  await expect(content).not.toContainText("閲覧注意の本文");
  await page.getByRole("button", { name: "隠す" }).click();
  await expect(page.getByTestId("hidden-post")).toBeVisible();
  await expect(page.getByRole("button", { name: "投稿を表示" })).toBeFocused();
}

/** Holds the page's GraphQL requests of one operation until released (a slow backend). */
async function holdOperation(page: Page, operation: string) {
  const held: Route[] = [];
  const handler = async (route: Route) => {
    const query = String(route.request().postDataJSON()?.query ?? "");
    if (new RegExp(`^\\s*(?:query|mutation)\\s+${operation}\\b`).test(query)) held.push(route);
    else await route.continue();
  };
  await page.route("**/graphql", handler);
  return {
    held,
    async release() {
      for (const route of held.splice(0)) await route.continue();
      await page.unroute("**/graphql", handler);
    },
    /** The held requests fail: the BFF answers with an upstream error. */
    async fail() {
      for (const route of held.splice(0)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: null, errors: [{ message: "upstream failed", extensions: { code: "UPSTREAM_ERROR" } }] }),
        });
      }
      await page.unroute("**/graphql", handler);
    },
  };
}

/** Puts bot-farm.example back to block (the shared policy mock's seed) from the settings page. */
async function restoreBotFarmBlock(page: Page) {
  await page.goto("/settings/mute-block/domains", { waitUntil: "networkidle" });
  await expect(page.getByTestId("domain-panel").locator("section")).toHaveAttribute("data-state", "loaded");
  await page.locator("#mb-add-button").click();
  await page.locator("#mb-add-input").fill("bot-farm.example");
  await page.getByTestId("add-dialog").getByRole("button", { name: "ブロック", exact: true }).click();
  await page.getByTestId("block-dialog").getByRole("button", { name: "ブロック", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText("bot-farm.example をブロックしました");
}

/**
 * Review follow-ups (PR #46): after a setting changed, a revealed post / person is
 * hidden and pending until the reveal is answered again (nothing of the old reveal, its
 * operations included, is used meanwhile), a failed answer leaves it hidden with the
 * error and the reveal button to retry; a 409 recovered by
 * reloading the settings brings the shown posts up to date (two tabs); a hidden post in a
 * person's list is its own hidden card (Ken's quote of a muted post); the mock says the
 * hiding is a preview; the post menu keeps focus across the breakpoint.
 */
async function verifyDomainContentReview(browser: Browser, server: AppServer, page: Page, viewport: Viewport) {
  const content = page.locator("#content");

  // Preview note where posts are shown (mock mode), short and visible.
  for (const path of ["/", "/posts/post-nana-playlist", "/users/nana%40noisy.social"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByTestId("content-preview-note")).toHaveText("投稿の非表示・操作の制限はプレビューです（サーバー未接続）");
    await expect(page.getByTestId("content-preview-note")).toBeVisible();
  }

  // 1 (post): revealed under a mute (operations allowed) -> block it -> the reveal is asked
  // again; meanwhile the post is hidden and pending (no old operations) -> that request
  // fails -> hidden with the error, the reveal button retries -> revealed and locked.
  await page.goto("/posts/post-nana-playlist", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  await expect(page.getByTestId("revealed-bar")).toContainText("ミュート中");
  await expect(content.locator("[data-locked]")).toHaveCount(0);
  const reveals = await holdOperation(page, "RevealPost");
  await content.locator("#sp-more-post-nana-playlist").click();
  await page.getByTestId("post-menu").getByRole("menuitem", { name: "noisy.social をブロック" }).click();
  const blockDialog = page.getByTestId("block-dialog");
  // If the block detaches relations, confirm them first (2-2).
  await expect(blockDialog.getByTestId("block-impact-loading")).toHaveCount(0);
  if (await blockDialog.locator("#mb-acknowledge").count()) await blockDialog.locator("#mb-acknowledge").check();
  await blockDialog.getByRole("button", { name: "ブロック", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText("noisy.social をブロックしました");
  await expect.poll(() => reveals.held.length).toBeGreaterThan(0);
  const card = page.getByTestId("hidden-post");
  await expect(card).toHaveAttribute("data-mode", "block");
  await expect(card.getByRole("button", { name: "この投稿だけ表示" })).toBeDisabled();
  await expect(page.getByTestId("revealed-bar")).toHaveCount(0);
  await expect(content.locator('article[data-post-id="post-nana-playlist"]')).toHaveCount(0);
  await reveals.fail();
  await expect(card.getByRole("alert")).toContainText("表示できませんでした");
  await expect(card.getByRole("alert")).toHaveAttribute("data-error", "upstream_error");
  await expect(page.getByTestId("revealed-bar")).toHaveCount(0);
  const retry = card.getByRole("button", { name: "この投稿だけ表示" });
  await expect(retry).toBeEnabled();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("revealed-bar")).toContainText("noisy.social · ブロック中");
  await expect(page.locator('[data-locked="reply"]')).toBeVisible();
  await content.locator("#sp-more-post-nana-playlist").click();
  await page.getByTestId("post-menu").getByRole("menuitem", { name: "noisy.social のブロックを解除…" }).click();
  await page.getByTestId("unblock-dialog").getByRole("button", { name: "ミュートに変更" }).click();
  await expect(page.getByTestId("toast")).toContainText("noisy.social をミュートに変更しました");
  await expect(page.getByTestId("revealed-bar")).toContainText("noisy.social · ミュート中");
  await expect(content.locator("[data-locked]")).toHaveCount(0);

  // A re-reveal can no longer be overtaken by [隠す] in the page (the post is hidden and
  // its button disabled until the answer); the update itself still drops an answer that
  // arrives after [隠す] (test/Test/Main.purs).
  await page.getByRole("button", { name: "隠す" }).click();
  await expect(card).toHaveAttribute("data-mode", "mute");

  // 1 (person): the same for [投稿を表示] on a blocked person's page (changed to mute).
  await page.goto("/users/deals%40bot-farm.example", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "投稿を表示" }).click();
  await expect(page.getByTestId("revealed-posts")).toBeVisible();
  const pages = await holdOperation(page, "RevealUserPage");
  await page.locator('[id="sp-more-user-deals@bot-farm.example"]').click();
  await page.getByTestId("post-menu").getByRole("menuitem", { name: "bot-farm.example のブロックを解除…" }).click();
  await page.getByTestId("unblock-dialog").getByRole("button", { name: "ミュートに変更" }).click();
  await expect(page.getByTestId("domain-badge")).toHaveText("ミュート中のドメイン");
  await expect.poll(() => pages.held.length).toBeGreaterThan(0);
  await expect(page.getByTestId("revealed-posts")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "投稿を表示" })).toBeDisabled();
  await pages.fail();
  await expect(card).toHaveAttribute("data-mode", "mute");
  await expect(card.getByRole("alert")).toContainText("表示できませんでした");
  await card.getByRole("button", { name: "投稿を表示" }).click();
  await expect(page.getByTestId("revealed-posts")).toBeVisible();
  await expect(content.locator("[data-locked]")).toHaveCount(0);
  await restoreBotFarmBlock(page);

  // 2: another tab mutes misskey.example; this tab's menu still offers it, the write
  // gets 409, and 再読み込み brings both the settings and the timeline up to date.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(content.locator('article[data-post-id="post-mika-picker"]')).toHaveCount(1);
  const other = await openPage(browser, server, viewport);
  try {
    await other.page.goto("/", { waitUntil: "networkidle" });
    await other.page.locator("#sp-more-post-mika-picker").click();
    await other.page.getByTestId("post-menu").getByRole("menuitem", { name: "misskey.example をミュート" }).click();
    await expect(other.page.getByTestId("toast")).toContainText("misskey.example をミュートしました");
  } finally {
    await other.context.close();
  }
  await page.locator("#sp-more-post-mika-picker").click();
  await page.getByTestId("post-menu").getByRole("menuitem", { name: "misskey.example をミュート" }).click();
  const toast = page.getByTestId("toast");
  await expect(toast.locator("[data-error]")).toHaveAttribute("data-error", "REVISION_CONFLICT");
  await expect(content.locator('article[data-post-id="post-mika-picker"]')).toHaveCount(1);
  await toast.getByRole("button", { name: "再読み込み" }).click();
  await expect(content.locator('article[data-post-id="post-mika-picker"]')).toHaveCount(0);
  await page.locator("#sp-more-post-sora-zine").click();
  await expect(page.getByTestId("post-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/settings/mute-block/domains", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "ミュート解除（misskey.example）" }).click();
  await expect(page.locator('li[data-domain="misskey.example"]')).toHaveCount(0);

  // 3: Ken's page (from his name on the revealed quote): his quote of a muted post is a
  // hidden card of its own, revealed and hidden like 3-1 / 3-2.
  await page.goto("/posts/post-ken-quote", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "この投稿だけ表示" }).click();
  await content.getByRole("link", { name: "Ken", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/ken%40other\.example$/);
  await expect(page.getByTestId("user-page")).toHaveAttribute("data-state", "loaded");
  await expect(page.getByTestId("domain-badge")).toHaveCount(0);
  const listed = page.getByTestId("hidden-post");
  await expect(listed).toHaveAttribute("data-domain", "noisy.social");
  await expect(content).not.toContainText("これめちゃくちゃ分かる");
  await listed.getByRole("button", { name: "この投稿だけ表示" }).click();
  await expect(content).toContainText("これめちゃくちゃ分かる");
  await expect(page.getByRole("button", { name: "隠す" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hidden-post")).toBeVisible();
  await expect(content).not.toContainText("これめちゃくちゃ分かる");

  // Optional follow-up: the post menu keeps focus when the width crosses the breakpoint.
  if (viewport.name === "desktop") {
    const mobile = VIEWPORTS[1];
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("#sp-more-post-mika-picker").click();
    const menu = page.getByTestId("post-menu");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.setViewportSize({ width: mobile.width, height: mobile.height });
    await expect(page.getByRole("dialog", { name: "その他" })).toHaveAttribute("aria-modal", "true");
    await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expectScrollLocked(page, true);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expectScrollLocked(page, false);
    await page.keyboard.press("Escape");
    await expect(page.locator("#sp-more-post-mika-picker")).toBeFocused();
  }
}

async function switchProfile(page: Page, name: string) {
  await visible(page, /投稿用 Profile を切り替え/).click();
  await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: new RegExp(name) }).click();
  await expect(visible(page, new RegExp(`投稿用 Profile を切り替え（現在: ${name}）`))).toHaveCount(1);
  await expect(page.getByTestId("domain-panel").locator("section")).toHaveAttribute("data-state", "loaded");
}

/** GraphQL operations of the post search (D04), by the names the PureScript client sends. */
const searchCount = (ops: string[], name: string) => ops.filter((op) => op === name).length;

/** An answer of the BFF's GraphQL with one error code (the page must show it as such). */
const searchGqlError = (code: string) => ({ status: 200, contentType: "application/json",
  body: JSON.stringify({ data: null, errors: [{ message: code, extensions: { code } }] }) });

/**
 * D04 post search (host note-search-ui ui-spec v2, grill d04-q08..q18), at both widths, mock mode:
 *  - Enter searches, the URL keeps the condition (not the cursor) and back / forward restore it;
 *  - the match is marked with text elements only, a content warning is folded, HTML-looking text stays text;
 *  - muted / blocked people leave no trace (count, rows, marks);
 *  - from:@acct becomes a chip: space only converts, Enter converts then searches, a second from replaces,
 *    a failure keeps the text and searches nothing, a host-less acct goes to the server as typed, a chosen
 *    suggestion is never resolved again, IME composition neither converts nor searches;
 *  - infinite scroll ends without duplicates, a time limit keeps the partial result and waits for the
 *    button, a failed page waits for its button, 501 / 429 / 503 are shown as what they are;
 *  - late answers (search, suggestions) never overwrite newer input, the person page's menu entry searches
 *    that person at once, SSR is hydrated without losing the condition, a Profile switch searches again,
 *    and no request leaves the origin.
 */
async function verifySearch(browser: Browser, server: AppServer, viewport: Viewport) {
  await resetMock(server);
  const { context, page, errors } = await openPage(browser, server, viewport);
  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(server.url) && !url.startsWith("data:") && !url.startsWith("about:")) external.push(url);
  });
  const ops = recordOperations(page);
  const posts: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/graphql") && request.method() === "POST") posts.push(request.postData() ?? ""); });
  const sora = "https://shuttlepub.example/users/sora";
  const aoi = "https://shuttlepub.example/users/aoi";
  const input = page.getByTestId("search-input");
  const notes = page.getByTestId("search-note");
  const toBottom = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const noteIds = () => notes.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-note-id")));
  const search = async (text: string) => { await input.fill(text); await input.press("Enter"); };
  try {
    // SSR already carries the box and the chip of the URL's condition; hydration keeps them.
    const ssr = await (await fetch(server.url + "/search?q=ZINE&from=" + encodeURIComponent(sora))).text();
    expect(ssr).toContain('value="ZINE"');
    expect(ssr).toContain('data-actor-url="' + sora + '"');
    expect(ssr).not.toContain('data-testid="search-note"');
    await page.goto("/search?q=ZINE&from=" + encodeURIComponent(sora), { waitUntil: "networkidle" });
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-hydration", "hydrated");
    await expect(page.locator("main#app")).toHaveCount(1);
    await expect(page.locator("#content h1")).toHaveCount(1);
    await expect(input).toHaveValue("ZINE");
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", sora);
    await expect(notes.first()).toBeVisible();
    expect(await noteIds()).toHaveLength(20);

    // Keyword only, from the empty box: Enter searches; the URL is the condition.
    await page.goto("/search", { waitUntil: "networkidle" });
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(page.getByTestId("search-results")).toHaveAttribute("data-state", "idle");
    await expect(page.getByRole("button", { name: /投稿者を追加|\+ ?投稿者/ })).toHaveCount(0);
    await search("ZINE");
    await expect(page).toHaveURL(/\/search\?q=ZINE$/);
    await expect(notes.first()).toBeVisible();
    // Infinite scroll to the end: every page once, no duplicates, nothing after the end.
    const before = searchCount(ops, "SearchNotes");
    await expect.poll(async () => { await toBottom(); return page.getByTestId("search-results").getAttribute("data-tail"); }, { timeout: 20_000 }).toBe("end");
    const ids = (await noteIds()) as string[];
    expect(ids.length).toBeGreaterThanOrEqual(41);
    expect(new Set(ids).size).toBe(ids.length);
    const pages = searchCount(ops, "SearchNotes") - before;
    expect(pages).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(500);
    expect(searchCount(ops, "SearchNotes") - before, "nothing loads after the end").toBe(pages);
    for (const mark of await page.getByTestId("search-mark").allTextContents()) expect(mark.toLowerCase()).toBe("zine");

    // A new condition replaces the results; back / forward restore the condition from the URL.
    await page.evaluate(() => window.scrollTo(0, 0));
    await search("検索");
    await expect(page).toHaveURL(/\/search\?q=%E6%A4%9C%E7%B4%A2$/);
    await expect(page.getByTestId("search-results")).toHaveAttribute("data-tail", "end");
    // Everything shown: nothing more is said (no "ここまで").
    await expect(page.getByTestId("search-results")).not.toContainText("ここまで");
    await expect(notes).toHaveCount(7);
    // The page never scrolls sideways (the long actor-URL names are cut, the kind badge keeps its line).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow").toBe(true);
    const content = page.locator("#content");
    // Muted / blocked people leave no trace: not in the rows, not in the marks.
    await expect(content).not.toContainText("ミュート中のドメイン");
    await expect(content).not.toContainText("検索の話を引用します");
    // Highlight: text elements only, several matches in one note, emoji and Japanese intact.
    await expect(content).toContainText("検索テスト 🔍🎉 日本語の検索語、検索 検索 検索");
    expect(await page.getByTestId("search-note").filter({ hasText: "検索テスト" }).getByTestId("search-mark").count()).toBe(5);
    // HTML-looking text is text.
    await expect(content).toContainText('<script>alert("検索")</script> <b>太字</b> &amp; &lt;img src=x onerror=alert(1)&gt; 検索');
    await expect(content.locator("script, b, img")).toHaveCount(0);
    // A content-warned note is folded: only the (marked) warning is shown, never its body (the contract gives none).
    const folded = page.getByTestId("search-note-cw");
    await expect(folded).toHaveCount(1);
    await expect(folded).toContainText("ネタバレ注意: 検索");
    await expect(folded.getByTestId("search-mark")).toHaveCount(1);
    await expect(content).not.toContainText("本文にも 検索 が入っています");
    // No avatar image of another origin is requested (d09-q06): letters only.
    await expect(content.locator("img")).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=ZINE$/);
    await expect(input).toHaveValue("ZINE");
    await expect(notes.first()).toBeVisible();
    await page.goForward();
    await expect(input).toHaveValue("検索");
    await expect(notes).toHaveCount(7);
    // Nothing found is its own message.
    await search("zzzz存在しない語");
    await expect(page.getByTestId("search-empty")).toHaveText("見つかりませんでした");
    await expect(page.getByTestId("search-empty-timeout")).toHaveCount(0);

    // from:@acct. Suggestions follow the typed prefix; a space only converts (no search).
    await page.goto("/search", { waitUntil: "networkidle" });
    // The agreed box (ui-spec 2): placeholder "検索", 36px field, a click in its margin focuses the input.
    await expect(input).toHaveAttribute("placeholder", "検索");
    const field = page.getByTestId("search-field");
    expect((await field.boundingBox())?.height).toBe(36);
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    await field.click({ position: { x: 4, y: 18 } });
    await expect(input).toBeFocused();
    await input.pressSequentially("from:@sor", { delay: 20 });
    await expect(page.getByTestId("author-suggestion")).toHaveCount(1);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    // The typed prefix is marked in the suggestion (text only).
    await expect(page.getByTestId("search-suggest-hit").first()).toHaveText(/^sor/i);
    expect(await page.getByTestId("author-suggestion").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(viewport.name === "mobile" ? 44 : 36);
    await input.pressSequentially("a ", { delay: 20 });
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", sora);
    // The chip: 26px (30px on a phone), its remove button 24px (30px), the full acct for readers.
    // (offset sizes: the chip is still scaling in while highlighted)
    expect(await page.getByTestId("author-chip").evaluate((element) => (element as HTMLElement).offsetHeight)).toBe(viewport.name === "mobile" ? 30 : 26);
    expect(await page.getByTestId("author-chip-remove").evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(viewport.name === "mobile" ? 30 : 24);
    await expect(page.getByTestId("author-chip")).toHaveAttribute("title", /@sora@/);
    await expect(page.getByTestId("author-chip")).toHaveClass(/is-just-/);
    await expect(input).toHaveValue("");
    await expect(page).toHaveURL(/\/search$/);
    expect(searchCount(ops, "ResolveSearchAuthor")).toBeGreaterThan(0);
    await expect(page.getByTestId("search-results")).toHaveAttribute("data-state", "idle");
    // Enter searches the author only (author is optional, the keyword may be empty).
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp("/search\\?from=" + encodeURIComponent(sora).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    await expect(notes.first()).toBeVisible();
    // A second from replaces the first; Enter converts and then searches.
    await input.fill("from:@aoi");
    await input.press("Enter");
    await expect(page.getByTestId("author-chip")).toHaveCount(1);
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", aoi);
    await expect(page).toHaveURL(new RegExp("from=" + encodeURIComponent(aoi).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    // A host-less acct is the server's own; the browser's host is never sent.
    const resolved = posts.filter((body) => body.includes("ResolveSearchAuthor")).at(-1) ?? "";
    expect(resolved).toContain("aoi");
    expect(resolved).not.toContain("127.0.0.1");
    // A failure keeps the text, shows one short line and searches nothing.
    const searchesBefore = searchCount(ops, "SearchNotes");
    await input.fill("kw from:@nobody@gone.example");
    await input.press("Enter");
    await expect(page.getByTestId("search-problem")).toBeVisible();
    await expect(input).toHaveValue("kw from:@nobody@gone.example");
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", aoi);
    await expect(page).toHaveURL(/from=/);
    expect(searchCount(ops, "SearchNotes")).toBe(searchesBefore);
    // An ambiguous acct (409 of the author lookup) is not a reaction conflict.
    await input.fill("from:@pat@dup.example");
    await input.press("Enter");
    await expect(page.getByTestId("search-problem")).toContainText("複数");
    // A chosen suggestion is the returned actor, never resolved again; it only converts.
    await input.fill("");
    const resolveBefore = searchCount(ops, "ResolveSearchAuthor");
    await input.pressSequentially("from:@sor", { delay: 20 });
    await expect(page.getByTestId("author-suggestion")).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", /sp-search-option-0/);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", sora);
    await expect(input).toHaveValue("");
    await expect(page).toHaveURL(new RegExp("from=" + encodeURIComponent(aoi).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    expect(searchCount(ops, "ResolveSearchAuthor")).toBe(resolveBefore);
    // Esc closes the list; Backspace at the start removes the chip.
    await input.pressSequentially("from:@ao", { delay: 20 });
    await expect(page.getByTestId("author-suggestions")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("author-suggestions")).toHaveCount(0);
    await input.fill("");
    await input.press("Backspace");
    await expect(page.getByTestId("author-chip")).toHaveCount(0);

    // IME: a composing Enter / space neither converts nor searches; the confirmed text does.
    await page.goto("/search", { waitUntil: "networkidle" });
    const composingBefore = searchCount(ops, "SearchNotes");
    const resolvesBefore = searchCount(ops, "ResolveSearchAuthor");
    await input.focus();
    await input.evaluate((element) => {
      const field = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setter.call(field, "from:@sora ");
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(400);
    expect(searchCount(ops, "SearchNotes")).toBe(composingBefore);
    expect(searchCount(ops, "ResolveSearchAuthor")).toBe(resolvesBefore);
    await expect(page.getByTestId("author-chip")).toHaveCount(0);
    await input.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "from:@sora " })));
    await expect(page.getByTestId("author-chip")).toHaveAttribute("data-actor-url", sora);
    await page.getByTestId("search-clear").click();
    await expect(page.getByTestId("author-chip")).toHaveCount(0);

    // A late answer never overwrites newer input: hold the first search, make a newer one, release.
    await page.goto("/search", { waitUntil: "networkidle" });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    let held = false;
    await page.route(server.url + "/graphql", async (route) => {
      const body = route.request().postData() ?? "";
      if (!held && body.includes("SearchNotes") && body.includes("ZINE")) {
        held = true;
        await gate;
        return route.continue().catch(() => undefined);
      }
      return route.continue();
    });
    await search("ZINE");
    await expect.poll(() => held).toBe(true);
    await search("検索");
    await expect(notes).toHaveCount(7);
    release();
    await page.waitForTimeout(600);
    await expect(notes).toHaveCount(7);
    await expect(input).toHaveValue("検索");
    await expect(page).toHaveURL(/q=%E6%A4%9C%E7%B4%A2$/);
    await page.unroute(server.url + "/graphql");
    // ...nor does a late suggestion list reopen over a box that moved on.
    let suggestHeld = false;
    let releaseSuggest: () => void = () => {};
    const suggestGate = new Promise<void>((resolveGate) => { releaseSuggest = resolveGate; });
    await page.route(server.url + "/graphql", async (route) => {
      if (!suggestHeld && (route.request().postData() ?? "").includes("SuggestSearchAuthors")) {
        suggestHeld = true;
        await suggestGate;
      }
      return route.continue().catch(() => undefined);
    });
    await input.fill("");
    await input.pressSequentially("from:@so", { delay: 20 });
    await expect.poll(() => suggestHeld).toBe(true);
    await input.fill("keyword");
    releaseSuggest();
    await page.waitForTimeout(600);
    await expect(page.getByTestId("author-suggestions")).toHaveCount(0);
    await expect(page.getByTestId("author-suggestions-note")).toHaveCount(0);
    await page.unroute(server.url + "/graphql");

    // Time limit (d04-q17): the partial result stays, nothing loads by itself, the button resumes.
    await page.goto("/search?q=" + encodeURIComponent("時間切れ"), { waitUntil: "networkidle" });
    await expect(page.getByTestId("search-interrupted")).toBeVisible();
    await expect(notes).toHaveCount(5);
    const interruptedBefore = searchCount(ops, "SearchNotes");
    await toBottom();
    await page.waitForTimeout(700);
    expect(searchCount(ops, "SearchNotes"), "an interrupted search loads nothing by itself").toBe(interruptedBefore);
    await page.getByTestId("search-continue").click();
    await expect(notes).toHaveCount(10);
    await expect(page.getByTestId("search-interrupted")).toBeVisible();
    await page.getByTestId("search-continue").click();
    await expect(page.getByTestId("search-results")).toHaveAttribute("data-tail", "end");
    expect(new Set(await noteIds()).size).toBe(12);

    // A failed extra page keeps the notes and waits for its button; it never retries by itself.
    await page.goto("/search?q=ZINE", { waitUntil: "networkidle" });
    await expect(notes).toHaveCount(20);
    await page.route(server.url + "/graphql", (route) =>
      (route.request().postData() ?? "").includes("cursor") ? route.abort() : route.continue());
    await toBottom();
    await expect(page.getByTestId("search-more-failed")).toBeVisible();
    await expect(notes).toHaveCount(20);
    const failedBefore = searchCount(ops, "SearchNotes");
    await toBottom();
    await page.waitForTimeout(700);
    expect(searchCount(ops, "SearchNotes"), "a failed page is not retried by itself").toBe(failedBefore);
    await page.unroute(server.url + "/graphql");
    await page.getByTestId("search-retry-more").click();
    await expect.poll(async () => { await toBottom(); return notes.count(); }, { timeout: 20_000 }).toBeGreaterThan(20);

    // 501 / 429 / 503 are shown as what they are, never as an empty or partial result.
    for (const [code, text, retry] of [
      ["NOT_IMPLEMENTED", "投稿検索はまだ使えません", false],
      ["RATE_LIMITED", "リクエストが多すぎます", true],
      ["SEARCH_TIMEOUT", "検索がタイムアウトしました", true],
    ] as const) {
      await page.route(server.url + "/graphql", (route) =>
        (route.request().postData() ?? "").includes("SearchNotes") ? route.fulfill(searchGqlError(code)) : route.continue());
      await page.goto("/search?q=ZINE", { waitUntil: "networkidle" });
      const failure = page.getByTestId("search-error");
      await expect(failure).toContainText(text);
      await expect(failure).toHaveAttribute("data-error", /.+/);
      await expect(page.getByTestId("search-empty")).toHaveCount(0);
      await expect(notes).toHaveCount(0);
      await expect(page.getByTestId("search-retry")).toHaveCount(retry ? 1 : 0);
      await page.unroute(server.url + "/graphql");
    }
    // The author lookup's own failures (429 / 503) are one short line of the box.
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.route(server.url + "/graphql", (route) =>
      (route.request().postData() ?? "").includes("ResolveSearchAuthor") ? route.fulfill(searchGqlError("RATE_LIMITED")) : route.continue());
    await search("from:@sora");
    await expect(page.getByTestId("search-problem")).toContainText("リクエストが多すぎます");
    await expect(input).toHaveValue("from:@sora");
    await page.unroute(server.url + "/graphql");

    // The person page's "…" has the entry (and only there); it searches that person at once.
    await page.goto("/users/sora%40shuttlepub.example", { waitUntil: "networkidle" });
    await expect(page.getByTestId("user-page")).toHaveAttribute("data-state", "loaded");
    await page.locator("[id^='sp-more-user-']").click();
    const menu = page.getByTestId("post-menu");
    await expect(menu.getByRole("menuitem").first()).toHaveText("@sora の投稿を検索");
    await menu.getByTestId("menu-search-author").click();
    await expect(page).toHaveURL(new RegExp("/search\\?from=" + encodeURIComponent(sora).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    await expect(page.getByTestId("author-chip")).toContainText("sora");
    await expect(notes.first()).toBeVisible();
    await expect(page.getByTestId("search-note-author").first()).toHaveText("sora");
    await expect(input).toBeFocused();
    // The shared post menu is not extended.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
    await page.locator("#sp-more-post-mika-picker").click();
    await expect(page.getByTestId("post-menu").getByTestId("menu-search-author")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A Profile switch searches again for the new Profile (the old Profile's list is dropped).
    await page.goto("/search?q=ZINE", { waitUntil: "networkidle" });
    await expect(notes.first()).toBeVisible();
    const switchBefore = searchCount(ops, "SearchNotes");
    await visible(page, /投稿用 Profile を切り替え/).click();
    await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
    await expect(visible(page, /投稿用 Profile を切り替え（現在: Fixture Dev）/)).toHaveCount(1);
    await expect.poll(() => searchCount(ops, "SearchNotes")).toBeGreaterThan(switchBefore);
    await expect(notes.first()).toBeVisible();
    await expect(input).toHaveValue("ZINE");

    expect(external, "no request leaves the origin (no external avatar or emoji)").toEqual([]);
    // The only console error is the extra page this check aborted on purpose.
    expect(errors.filter((message) => message !== "Console: Failed to load resource: net::ERR_FAILED"), "search " + viewport.name + ": browser errors").toEqual([]);
    console.info("OK post search: Enter / space / IME, from chip, suggestions, URL, paging, time limit, errors, menu entry at " + viewport.name);
  } finally {
    await context.close();
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
        await verifyAmbiguousReactionRestore(page, viewport, server);
        await resetMock(server);
        await verifyRemoteEmoji(page, viewport);
        await resetMock(server);
        await verifyImageFailureFollowsEmoji(page, viewport);
        expect(errors, `mock ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK mock mode hydrates and keeps the shell's keyboard/focus rules at ${viewport.name} (${viewport.width}x${viewport.height})`);
      } finally {
        await context.close();
      }
      // A fresh browser for the mute/block settings (D08), with the quick reaction mock at its fixtures.
      await resetMock(server);
      const muteBlock = await openPage(browser, server, viewport);
      try {
        await verifyReactionToastUnderMuteBlock(muteBlock.page);
        await verifyMuteBlock(muteBlock.page, viewport);
        expect(muteBlock.errors, `mute/block ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK mute/block settings: keyboard, modal, reaction toast behind it, own server, Profile switch at ${viewport.name}`);
      } finally {
        await muteBlock.context.close();
      }
      // D08 account list: icon / name / acct from target_actor, no avatar request, unmute / unblock naming.
      await resetMock(server);
      const accounts = await openPage(browser, server, viewport);
      try {
        await verifyMuteBlockAccounts(accounts.page, viewport);
        expect(accounts.errors, `mute/block accounts ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK account list: names, accts, placeholders, no avatar request, unmute/unblock naming at ${viewport.name}`);
      } finally {
        await accounts.context.close();
      }
      // D08 second stage: posts of muted / blocked domains, the post menu and the 4-1 sheet.
      await resetMock(server);
      const domainContent = await openPage(browser, server, viewport);
      try {
        await verifyDomainContent(domainContent.page, viewport);
        await verifyDomainContentReview(browser, server, domainContent.page, viewport);
        expect(domainContent.errors, `domain content ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK post menu, hidden/revealed posts, locked operations, folded replies, person page at ${viewport.name}`);
      } finally {
        await domainContent.context.close();
      }
      // D04 post search.
      await verifySearch(browser, server, viewport);
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
