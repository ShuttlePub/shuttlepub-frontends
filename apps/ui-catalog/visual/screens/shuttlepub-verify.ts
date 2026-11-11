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

async function verifyMock(browser: Browser, frontendRoot: string, coreURL: string) {
  const server = await startApp(frontendRoot, "ShuttlePub", coreURL);
  try {
    await server.waitUntilReady();
    await verifySsrDocument(server);
    for (const viewport of VIEWPORTS) {
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
        expect(errors, `mock ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK mock mode hydrates and keeps the shell's keyboard/focus rules at ${viewport.name} (${viewport.width}x${viewport.height})`);
      } finally {
        await context.close();
      }
    }
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
