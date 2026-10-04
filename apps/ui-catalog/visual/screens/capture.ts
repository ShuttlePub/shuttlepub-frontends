import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { FIXED_TIME, MOCK_IDENTIFIER, MOCK_PASSWORD, SCREEN_CASES, type ScreenCase } from "./cases.ts";
import { localImage } from "./fixtures.ts";
import { startApp, type AppServer } from "./servers.ts";

async function prepareScreen(page: Page, item: ScreenCase) {
  const content = page.locator("#content");
  let expectedPath: string = item.path;
  // App chrome/copy changes should produce a visual diff, not make the current
  // driver incompatible with main. Wait for structure and seeded data instead.
  await expect(content.locator("h1")).toBeVisible();
  if (item.id === "login") {
    await expect(content.locator('form input[type="email"]')).toBeVisible();
    await expect(content.locator('form input[type="password"]')).toBeVisible();
    await expect(content.locator('form button[type="submit"]')).toBeVisible();
  } else if (item.id === "not-found") {
    await expect(content.locator("h1 + p")).toBeVisible();
  }
  if (item.app === "Booskiff") {
    if (item.id.startsWith("drive-")) {
      await expect(page.getByTestId("quota")).toContainText(/\d/);
      if (item.data === "empty") {
        // The main baseline has separate empty lists; the hierarchical browser
        // has one empty folder view. Do not require either layout's row tags.
        await expect(content.locator('a[href^="/drive/files/"]')).toHaveCount(0);
        await expect(content.getByText("Projects", { exact: true })).toHaveCount(0);
      } else {
        await expect(content.getByText("Projects", { exact: true })).toBeVisible();
        await expect(content.getByText("Archive", { exact: true })).toBeVisible();
        await expect(content.getByText("README.txt", { exact: true })).toBeVisible();
      }
      if (item.id === "drive-folder") {
        const folderLink = content.locator('a[href="/drive/folders/folder-projects"]');
        if (await folderLink.count()) {
          expectedPath = "/drive/folders/folder-projects";
          await folderLink.click();
        } else {
          await page.getByRole("button", { name: "Projects", exact: true }).click();
        }
        await expect(page.getByTestId("upload-input")).toHaveAttribute("data-folder-id", "folder-projects");
        await expect(content.getByText("design-notes.pdf", { exact: true })).toBeVisible();
        await expect(content.getByText("project-cover.png", { exact: true })).toBeVisible();
        await expect(content.getByText("README.txt", { exact: true })).toHaveCount(0);
      }
    } else if (item.id === "file-detail") {
      await expect(page.getByRole("heading", { name: "design-notes.pdf", exact: true })).toBeVisible();
      await expect(page.getByTestId("file-detail-page").locator('a[href="/api/files/file-design/download"]')).toBeVisible();
    }
  } else {
    if (item.id === "accounts-populated") {
      for (const id of ["acc_01", "acc_02", "acc_03"]) {
        await expect(page.locator(`main a[href="/accounts/${id}"]`)).toBeVisible();
      }
    } else if (item.id === "account-new") {
      await expect(content.locator('input[type="text"]')).toBeVisible();
      await expect(content.getByRole("checkbox")).toBeVisible();
      await expect(content.getByRole("button")).toBeDisabled();
    } else if (item.id === "account-new-filled") {
      await content.locator('input[type="text"]').fill("release-bot");
      await content.getByRole("checkbox").check();
      await expect(content.getByRole("button")).toBeEnabled();
    } else if (item.id.startsWith("account-detail")) {
      await expect(content.locator("h1")).toContainText("Alice Wonderland");
      await expect(content.getByText("ed25519:AAAA", { exact: true })).toBeVisible();
      await expect(page.getByText("https://alice.example.com", { exact: true })).toBeVisible();
      if (item.id === "account-detail-edit") {
        await content.getByRole("button").first().click();
        await expect(content.locator('input[type="text"]')).toHaveCount(3);
        await expect(page.locator("textarea")).toHaveValue("Exploring the rabbit hole of federated social networks.");
      }
    } else if (item.id === "settings") {
      await expect(content).toContainText(MOCK_IDENTIFIER);
      await expect(content.locator("button[data-color-option]")).toHaveCount(2);
      await expect(content.locator("button[data-shape-option]")).toHaveCount(2);
    }
  }
  return expectedPath;
}

async function captureScreen(browser: Browser, server: AppServer, item: ScreenCase, output: string) {
  const context = await browser.newContext({
    baseURL: server.url, viewport: { width: item.viewport.width, height: item.viewport.height },
    deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark",
    reducedMotion: "reduce", serviceWorkers: "block",
  });
  try {
    const errors: string[] = [];
    const responseChecks: Promise<void>[] = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin === server.url) return route.continue();
      const svg = request.resourceType() === "image" ? localImage(request.url()) : undefined;
      if (svg) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg });
      errors.push(`Unexpected external request: ${request.url()}`);
      return route.abort("blockedbyclient");
    });
    if (item.authenticated) {
      // Use Chromium's HTTP/cookie implementation. Bun 1.3.13 supplies a
      // relative response URL to Playwright's Node APIRequestContext, which
      // breaks its Set-Cookie parser even when the request URL is absolute.
      const loginPage = await context.newPage();
      try {
        await loginPage.goto("/login", { waitUntil: "networkidle" });
        const login = await loginPage.evaluate(async (credentials) => {
          const response = await fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
            signal: AbortSignal.timeout(15_000),
          });
          return { status: response.status, json: await response.json() };
        }, { identifier: MOCK_IDENTIFIER, password: MOCK_PASSWORD });
        expect(login.status, `${item.filename}: mock login`).toBe(200);
        expect(login.json).toMatchObject({ authenticated: true, username: MOCK_IDENTIFIER });
      } finally {
        await loginPage.close();
      }
    }
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await page.addInitScript(() => {
      localStorage.setItem("ratcap-color", "catppuccin-mocha");
      localStorage.setItem("ratcap-shape", "rounded");
    });
    const expectedAnonymousSession = (url: string, status: number) =>
      !item.authenticated && url === `${server.url}/auth/session` && status === 401;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (expectedAnonymousSession(message.location().url, 401) && /Failed to load resource:.*401/.test(message.text())) return;
      errors.push(`Console: ${message.text()}`);
    });
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => {
      if (response.status() >= 400 && !expectedAnonymousSession(response.url(), response.status())) {
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
      }
      if (response.url() === `${server.url}/graphql`) {
        responseChecks.push(response.json().then((body: { errors?: unknown[] }) => {
          if (body.errors?.length) errors.push(`GraphQL: ${JSON.stringify(body.errors)}`);
        }).catch((error: unknown) => { errors.push(`Invalid GraphQL response: ${String(error)}`); }));
      }
    });
    // A session response proves the production client has resumed the SSR page.
    const sessionResponse = page.waitForResponse(`${server.url}/auth/session`);
    const documentResponse = await page.goto(item.path, { waitUntil: "networkidle" });
    expect(documentResponse?.status(), `${item.filename}: SSR`).toBe(200);
    expect((await sessionResponse).status()).toBe(item.authenticated ? 200 : 401);
    await expect(page.locator("main#app")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-color", "catppuccin-mocha");
    await expect(page.locator("html")).toHaveAttribute("data-shape", "rounded");
    const expectedPath = await prepareScreen(page, item);
    await expect(page).toHaveURL(new URL(expectedPath, server.url).href);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await expect(page.locator('[role="alert"]:visible, [data-testid="file-upload-error"]:visible')).toHaveCount(0);
    await expect(page.getByText(/^(Loading|Logging in|Failed to load|読み込み)/)).toHaveCount(0);
    await Promise.all(responseChecks);
    expect(errors, `${item.filename}: unexpected browser errors`).toEqual([]);
    await page.screenshot({ path: resolve(output, item.filename), fullPage: true, animations: "disabled", caret: "hide" });
    await Promise.all(responseChecks);
    expect(errors, `${item.filename}: errors during screenshot`).toEqual([]);
    console.info(`Captured ${item.filename}`);
  } finally {
    await context.close();
  }
}

export async function captureScreens(frontendRoot: string, output: string) {
  if (!isAbsolute(frontendRoot) || !isAbsolute(output)) throw new Error("FRONTEND_ROOT and CAPTURE_DIR must be absolute paths");
  await mkdir(output, { recursive: true });
  const stub = startBooskiffStub();
  const servers: AppServer[] = [];
  let browser: Browser | undefined;
  let failed = false;
  try {
    // Register each child immediately so partial startup failure always cleans up.
    for (const app of ["Booskiff", "Emumet"] as const) servers.push(await startApp(frontendRoot, app, stub.url));
    await Promise.all(servers.map((server) => server.waitUntilReady()));
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    for (const item of SCREEN_CASES) {
      const server = servers.find((entry) => entry.app === item.app)!;
      stub.setState(item.data);
      await captureScreen(browser, server, item, output);
      expect(stub.unexpectedRequests, `${item.filename}: unexpected Core API requests`).toEqual([]);
      for (const entry of servers) {
        expect(await entry.networkViolations(), `${entry.app}: unexpected server requests`).toEqual([]);
      }
    }
    console.info(`Captured ${SCREEN_CASES.length} app screenshots in ${output}`);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), ...servers.map((server) => server.stop())]);
    stub.stop();
    if (failed) {
      for (const server of servers) console.error(`${server.app} server log:\n${await server.logs()}`);
    }
    const cleanupErrors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (cleanupErrors.length) {
      if (!failed) throw new AggregateError(cleanupErrors, "Visual capture cleanup failed");
      console.error("Visual capture cleanup errors:", cleanupErrors);
    }
  }
}

if (import.meta.main) {
  await captureScreens(
    resolve(process.env.FRONTEND_ROOT ?? resolve(import.meta.dir, "../../../..")),
    resolve(process.env.CAPTURE_DIR ?? ".visual/actual"),
  );
}
