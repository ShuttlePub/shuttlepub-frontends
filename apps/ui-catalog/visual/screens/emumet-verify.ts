// Behavioural checks for apps/emumet-web's username screens that a screenshot cannot prove.
//
//   bun visual/screens/emumet-verify.ts
//
// Needs the built app (visual/build.sh ../emumet-web) and Playwright Chromium, like the capture driver.
//
//  1. Hydration of every state: the server renders each fixture of App.Fixtures (create modal: every verdict,
//     host unknown / failed, confirmation, pending, error banner; detail: set / unset / no display name / no
//     profile, set dialog in every step; help; login; settings...) as the SSR page. The browser must resume it
//     without touching the DOM (before/after hydration identical, apart from the dialog being opened and the
//     serialized state being consumed) and without any error, also after the session / data answers arrive.
//  2. Dialog behaviour with the keyboard: opening moves the focus into the dialog, Tab / Shift+Tab never leave it,
//     the page behind is blocked, Escape goes back one step / closes, and the focus returns to the opener.
//     The (?) next to the label is a real link to the help page.
import { isAbsolute, resolve } from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { FIXED_TIME, MOCK_IDENTIFIER, MOCK_PASSWORD } from "./cases.ts";
import { startApp, type AppServer } from "./servers.ts";

type ServerModule = {
  fixtureList: { id: string; path: string }[];
  renderFixture: (id: string) => () => string;
};

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function normalize(html: string): string {
  return html
    .replace(/<template-state[\s\S]*?<\/template-state>/g, "")
    .replace(/ open=""/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function verifyHydration(browser: Browser, frontendRoot: string) {
  const app = resolve(frontendRoot, "apps/emumet-web");
  const dist = resolve(app, "dist");
  const server = (await import(resolve(dist, "server.js"))) as ServerModule;
  const theme = await Bun.file(Bun.resolveSync("@shuttlepub/design-tokens/theme.js", app)).text();
  const assets: Record<string, { body: string | ArrayBuffer; type: string }> = {
    "/app.js": { body: await Bun.file(resolve(dist, "app.js")).arrayBuffer(), type: "application/javascript" },
    "/style.css": { body: await Bun.file(resolve(dist, "style.css")).arrayBuffer(), type: "text/css" },
    "/theme.js": { body: theme, type: "application/javascript" },
  };
  const htmlByPath = new Map<string, string>();
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const asset = assets[pathname];
      if (asset) return new Response(asset.body, { headers: { "content-type": asset.type } });
      const html = htmlByPath.get(pathname);
      return html === undefined ? new Response("not found", { status: 404 }) : new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const origin = `http://127.0.0.1:${http.port}`;
  let checked = 0;
  try {
    expect(server.fixtureList.length).toBeGreaterThan(30);
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        baseURL: origin, viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark", serviceWorkers: "block",
      });
      try {
        for (const fixture of server.fixtureList) {
          htmlByPath.set(fixture.path, server.renderFixture(fixture.id)());
          await verifyFixture(context, fixture, viewport.name);
          checked++;
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    http.stop(true);
  }
  console.info(`OK hydration: ${checked} state x viewport combinations resume without DOM changes or errors`);
}

async function verifyFixture(context: BrowserContext, fixture: { id: string; path: string }, viewport: string) {
  const label = `${fixture.id} (${viewport})`;
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`Console: ${message.text()}`);
  });
  let release!: () => void;
  const appGate = new Promise<void>((done) => { release = done; });
  let releaseNetwork!: () => void;
  const networkGate = new Promise<void>((done) => { releaseNetwork = done; });
  let sessionRequested = false;
  await page.route("**/app.js", async (route) => {
    await appGate;
    await route.continue();
  });
  await page.route("**/auth/session", async (route) => {
    sessionRequested = true;
    await networkGate;
    await route.fulfill({ status: 200, json: { authenticated: true, username: MOCK_IDENTIFIER } });
  });
  await page.route("**/graphql", async (route) => {
    await networkGate;
    await route.fulfill({ status: 200, json: { errors: [{ message: "fixture backend offline", extensions: { code: "TEMPORARILY_UNAVAILABLE" } }] } });
  });
  try {
    await page.goto(fixture.path, { waitUntil: "commit" });
    await page.waitForFunction(() => document.querySelector('script[src="/app.js"]') !== null);
    const before = normalize(await page.evaluate(() => document.querySelector("main#app")?.innerHTML ?? ""));
    expect(before.length, `${label}: SSR page has content`).toBeGreaterThan(50);
    release();
    await expect.poll(() => sessionRequested, { message: `${label}: the client resumed and asked for the session` }).toBe(true);
    const after = normalize(await page.evaluate(() => document.querySelector("main#app")?.innerHTML ?? ""));
    if (after !== before) {
      let at = 0;
      while (at < before.length && before[at] === after[at]) at++;
      throw new Error(`${label}: hydration changed the DOM at ${at}\n  SSR : ...${before.slice(Math.max(0, at - 80), at + 160)}\n  DOM : ...${after.slice(Math.max(0, at - 80), at + 160)}`);
    }
    releaseNetwork();
    // The session / data answers re-render the page against the hydrated DOM; a mismatch throws here.
    await page.waitForTimeout(600);
    await expect(page.locator("main#app")).toHaveCount(1);
    expect(errors, `${label}: browser errors`).toEqual([]);
  } finally {
    release();
    releaseNetwork();
    await page.close();
  }
}

async function login(context: BrowserContext, origin: string) {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
    const status = await page.evaluate(async (credentials) => {
      const response = await fetch("/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials),
      });
      return response.status;
    }, { identifier: MOCK_IDENTIFIER, password: MOCK_PASSWORD });
    expect(status, "mock login").toBe(200);
  } finally {
    await page.close();
  }
}

const insideDialog = (page: Page) => page.evaluate(() => {
  const dialog = document.querySelector("dialog[open]");
  return !!dialog && !!document.activeElement && dialog.contains(document.activeElement);
});

async function expectFocusTrapped(page: Page, label: string) {
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 14; index++) {
      await page.keyboard.press(key);
      expect(await insideDialog(page), `${label}: ${key} #${index + 1} keeps the focus inside the dialog`).toBe(true);
    }
  }
}

async function expectBackgroundBlocked(page: Page, label: string) {
  const blocked = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    // A modal dialog sits in the top layer: the nav behind it must not be reachable by pointer or focus.
    const atNav = document.elementFromPoint(8, 8);
    return {
      modal: !!dialog && dialog.matches(":modal"),
      pointerHitsDialog: !!atNav && !!atNav.closest("dialog"),
    };
  });
  expect(blocked.modal, `${label}: the dialog is a real modal (showModal)`).toBe(true);
  expect(blocked.pointerHitsDialog, `${label}: the page behind does not receive pointer input`).toBe(true);
}

async function verifyDialogs(browser: Browser, frontendRoot: string) {
  const core = startBooskiffStub();
  const server: AppServer = await startApp(frontendRoot, "Emumet", core.url);
  try {
    await server.waitUntilReady();
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        baseURL: server.url, viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block",
      });
      try {
        await login(context, server.url);
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        await page.clock.setFixedTime(new Date(FIXED_TIME));
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(`Console: ${message.text()}`);
        });
        await verifyListSpacing(page, `list (${viewport.name})`, viewport.name === "desktop");
        await verifyCreateDialog(page, `create (${viewport.name})`);
        await verifySetDialog(page, `set (${viewport.name})`);
        await verifyHelpLink(page, context, `help (${viewport.name})`);
        expect(errors, `dialogs ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK dialogs behave with the keyboard at ${viewport.name}`);
      } finally {
        await context.close();
      }
    }
    expect(await server.networkViolations()).toEqual([]);
  } finally {
    await server.stop();
    core.stop();
  }
}

async function verifyListSpacing(page: Page, label: string, desktop: boolean) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('main a[href^="/accounts/acc_"]').first()).toBeVisible();
  const boxes = await page.evaluate(() => {
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const cards = [...document.querySelectorAll('main a[href^="/accounts/acc_"] > div')].map(rect);
    const plus = document.querySelector('a[href="/accounts/new"]');
    return { cards, plus: plus ? rect(plus) : null };
  });
  expect(boxes.cards.length, `${label}: the three seeded accounts`).toBeGreaterThanOrEqual(3);
  const [first, second] = boxes.cards as [typeof boxes.cards[number], typeof boxes.cards[number]];
  const gap = desktop ? second.left - first.right : second.top - first.bottom;
  expect(Math.round(gap), `${label}: the visible gap between the account cards (the bordered boxes, not their links; agreed mock: 12px desktop / 8px narrow)`).toBe(desktop ? 12 : 8);
  const lastRight = Math.max(...boxes.cards.map((card) => card.right));
  expect(Math.round(boxes.plus?.right ?? -1), `${label}: the "+" button ends at the cards' right edge`).toBe(Math.round(lastRight));
}

async function verifyCreateDialog(page: Page, label: string) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('main a[href="/accounts/acc_01"]')).toBeVisible();
  const opener = page.locator('a[href="/accounts/new"]');
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator("#new-account-name"), `${label}: the focus moves into the dialog`).toBeFocused();
  await expectBackgroundBlocked(page, label);
  await expectFocusTrapped(page, label);

  // Escape closes the input step and returns the focus to the "+" that opened it.
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(opener, `${label}: the focus returns to the opener`).toBeFocused();

  // Confirmation step: Create -> focus on "back"; Escape goes back one step, then closes.
  await page.keyboard.press("Enter");
  await expect(page.locator("#new-account-name")).toBeFocused();
  await page.locator("#new-account-name").fill("release-bot");
  await page.locator("#new-username").fill("release-bot");
  await expect(page.getByText("利用できます")).toBeVisible();
  const create = page.locator("dialog").getByRole("button", { name: "作成" });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#username-confirm-id")).toContainText("@release-bot");
  await expect(page.locator("dialog button[data-initial-focus]"), `${label}: the confirmation focuses "back"`).toBeFocused();
  await expectFocusTrapped(page, `${label} confirmation`);
  await page.keyboard.press("Escape");
  await expect(page.locator("#new-account-name"), `${label}: Escape on the confirmation returns to the input`).toBeFocused();
  await expect(page.locator("#new-username")).toHaveValue("release-bot");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
}

async function verifySetDialog(page: Page, label: string) {
  await page.goto("/accounts/acc_02", { waitUntil: "networkidle" });
  await expect(page.getByText("ユーザー名が未設定です")).toBeVisible();
  const opener = page.getByRole("button", { name: "設定する" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator("#set-username"), `${label}: the focus moves into the dialog`).toBeFocused();
  await expectBackgroundBlocked(page, label);
  await expectFocusTrapped(page, label);
  await page.locator("#set-username").fill("bob");
  await expect(page.getByText("利用できます")).toBeVisible();
  await page.locator("dialog").getByRole("button", { name: "設定", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#username-confirm-id")).toContainText("@bob");
  await expect(page.locator("dialog button[data-initial-focus]"), `${label}: the confirmation focuses "back"`).toBeFocused();
  await expectFocusTrapped(page, `${label} confirmation`);
  await page.keyboard.press("Escape");
  await expect(page.locator("#set-username"), `${label}: Escape on the confirmation returns to the input`).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent ?? ""), `${label}: the focus returns to a "set" button`).toMatch(/設定/);
}

async function verifyHelpLink(page: Page, context: BrowserContext, label: string) {
  await page.goto("/accounts/new", { waitUntil: "networkidle" });
  await expect(page.locator("dialog[open]")).toBeVisible();
  const help = page.locator('dialog a[aria-label^="ユーザー名のヘルプ"]');
  await expect(help, `${label}: (?) is a link`).toHaveAttribute("href", "/help/username");
  await expect(help).toHaveAttribute("target", "_blank");
  await help.focus();
  await expect(help, `${label}: (?) is reachable by keyboard`).toBeFocused();
  const [popup] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
  await popup.waitForURL("**/help/username");
  expect(new URL(popup.url()).pathname).toBe("/help/username");
  await expect(popup.getByRole("heading", { name: "ユーザー名について" })).toBeVisible();
  await expect(popup.getByText("後から変更できません")).toBeVisible();
  await popup.close();
  await expect(page.locator("dialog[open]"), `${label}: the dialog and its input stay as they were`).toBeVisible();
}

export async function verifyEmumet(frontendRoot: string) {
  if (!isAbsolute(frontendRoot)) throw new Error("FRONTEND_ROOT must be an absolute path");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    await verifyHydration(browser, frontendRoot);
    await verifyDialogs(browser, frontendRoot);
    console.info("Emumet username hydration and dialog checks passed");
  } finally {
    await browser?.close();
  }
}

if (import.meta.main) {
  await verifyEmumet(resolve(process.env.FRONTEND_ROOT ?? resolve(import.meta.dir, "../../../..")));
}
