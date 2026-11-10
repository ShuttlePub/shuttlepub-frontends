// Behavioural checks for apps/shuttlepub-web that a screenshot cannot prove.
//
//   bun visual/screens/shuttlepub-verify.ts
//
// Needs the built app (visual/build.sh ../shuttlepub-web) and Playwright Chromium,
// exactly like the screen capture driver, and runs from the same CI job.
//
//  - mock mode: the SSR response is hydrated by the client (mobile and desktop
//    widths), the DOM keeps one copy of each row after resume, and no backend is called.
//  - real mode against a stub backend that answers 501: the 501 is displayed as a
//    "not implemented" error and the page never shows mock data.
//  - real mode against a stub backend that answers 500: displayed as a backend error.
import { isAbsolute, resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { appExists, startApp, type AppServer } from "./servers.ts";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

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

async function openHome(browser: Browser, server: AppServer, viewport: (typeof VIEWPORTS)[number]) {
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
  expect(html).toContain("<h1>ShuttlePub</h1>");
  expect(html).toContain("<template-state");
  expect(html).toContain('data-testid="hydration-state" data-state="ssr"');
  // SSR must not claim to know data the client has not fetched yet.
  expect(html).toContain("API status: Loading");
}

async function expectHydrated(page: Page) {
  await expect(page.getByTestId("hydration-state")).toHaveAttribute("data-state", "hydrated");
  // Flame matches SSR nodes to virtual nodes by index only; a mismatch duplicates or loses rows.
  for (const id of ["hydration-state", "api-mode", "api-status", "profile-context"]) {
    await expect(page.getByTestId(id)).toHaveCount(1);
  }
  await expect(page.locator("main#app")).toHaveCount(1);
  await expect(page.locator("#content")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
}

async function verifyMock(browser: Browser, frontendRoot: string, coreURL: string) {
  const server = await startApp(frontendRoot, "ShuttlePub", coreURL);
  try {
    await server.waitUntilReady();
    await verifySsrDocument(server);
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openHome(browser, server, viewport);
      try {
        await page.goto("/", { waitUntil: "networkidle" });
        await expectHydrated(page);
        await expect(page.getByTestId("api-mode")).toHaveAttribute("data-state", "loaded");
        await expect(page.getByTestId("api-mode")).toContainText("mock");
        await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "loaded");
        await expect(page.getByTestId("api-status")).toContainText("v1");
        await expect(page.getByTestId("profile-context")).toContainText("Fixture Profile");
        expect(errors, `mock ${viewport.name}: browser errors`).toEqual([]);
        console.info(`OK mock mode hydrates at ${viewport.name} (${viewport.width}x${viewport.height})`);
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
    env: { SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: backend.url },
  });
  const expectedCode = status === 501 ? "not_implemented" : "upstream_error";
  try {
    await server.waitUntilReady();
    await verifySsrDocument(server);
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openHome(browser, server, viewport);
      try {
        await page.goto("/", { waitUntil: "networkidle" });
        await expectHydrated(page);
        await expect(page.getByTestId("api-mode")).toContainText("real");
        const statusRow = page.getByTestId("api-status");
        await expect(statusRow).toHaveAttribute("data-state", "error");
        await expect(statusRow).toHaveAttribute("data-error", expectedCode);
        // Never success, never mock data.
        await expect(statusRow).not.toHaveText(/^API status: v1$/);
        await expect(page.getByTestId("profile-context")).not.toContainText("Fixture Profile");
        if (status === 501) {
          await expect(statusRow).toContainText("Not implemented");
          await expect(page.getByTestId("profile-context")).toHaveAttribute("data-error", "not_implemented");
        }
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
    expect(unusedCore.unexpectedRequests).toEqual([]);
    console.info("ShuttlePub hydration and mock/real checks passed");
  } finally {
    await browser?.close();
    unusedCore.stop();
  }
}

if (import.meta.main) {
  await verifyShuttlePub(resolve(process.env.FRONTEND_ROOT ?? resolve(import.meta.dir, "../../../..")));
}
