import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function enterCredentials(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill("testuser@example.com");
  await page.getByTestId("login-password").fill("testuser");
  // The login form is hydrated client-side; a click fired before hydration is
  // inert, so retry click+wait until the login XHR actually fires.
  await expect(async () => {
    await page.getByTestId("login-submit").click();
    await page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/auth/login" && response.request().method() === "POST",
      { timeout: 5_000 },
    );
  }).toPass({ timeout: 20_000 });
  // Real-mode login success hands off to /auth/oauth/start automatically (the
  // BFF `next` URL), so the Hydra consent screen arrives through the UI flow
  // alone. return_to=/drive: the OAuth callback lands on a full /drive load,
  // whose resumed DOM stays intact since the issue #19 fix (#21).
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function expectSignedOut(page: Page): Promise<void> {
  expect((await page.context().cookies()).some((cookie) => cookie.name === "booskiff_session")).toBe(false);
  const session = await page.request.get("/auth/session");
  expect(session.status()).toBe(401);
  expect(await session.json()).toEqual({ authenticated: false });
  expect((await page.request.get("/api/files")).status()).toBe(401);
}

test("fails closed when Hydra returns consent denial", async ({ page }) => {
  // Given: a real Kratos login and a pending Hydra consent challenge.
  await enterCredentials(page);
  // When: the user denies consent through the real Hydra admin protocol.
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  // Then: the OAuth error never becomes an application session.
  await expect(page).toHaveURL(/\/login\?error=access_denied$/);
  await expectSignedOut(page);
});

test("fails closed when the callback state is not the browser's pending state", async ({ page }) => {
  // Given: the BFF has minted a real pending OAuth cookie.
  await page.request.get("/auth/oauth/start", { maxRedirects: 0 });
  // When: an unsolicited response carries a different state.
  await page.goto("/auth/callback?code=invalid-code&state=wrong-state");
  // Then: no token exchange/session is accepted.
  await expect(page).toHaveURL(/\/login\?error=invalid_state$/);
  await expectSignedOut(page);
});

test("fails closed when Hydra rejects an invalid authorization code", async ({ page }) => {
  // Given: a matching state from the actual BFF authorization redirect.
  const start = await page.request.get("/auth/oauth/start", { maxRedirects: 0 });
  expect(start.status()).toBe(302);
  const state = new URL(start.headers()["location"] ?? "").searchParams.get("state");
  expect(state).toBeTruthy();
  // When: Hydra receives a nonexistent code with that valid browser state.
  await page.goto(`/auth/callback?code=invalid-code&state=${encodeURIComponent(state ?? "")}`);
  // Then: Hydra's token error is fail-closed at the BFF.
  await expect(page).toHaveURL(/\/login\?error=token_exchange_failed$/);
  await expectSignedOut(page);
});

test("real login grants a cookie session, drive access, and logout", async ({ page }) => {
  // Given: credentials are checked by Kratos, not the BFF mock login.
  await enterCredentials(page);
  const callback = page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/callback");
  // When: consent completes the real authorization-code + PKCE exchange.
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  expect((await callback).status()).toBe(302);
  // Then: the Hydra ID token becomes an HttpOnly application session.
  await expect(page).toHaveURL(/\/drive$/);
  await expect(page.getByTestId("drive-page")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "booskiff_session")?.httpOnly).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "booskiff_oauth")).toBe(false);
  const session = await page.request.get("/auth/session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ authenticated: true, username: "testuser@example.com" });
  expect((await page.request.get("/.well-known/jwks.json")).status()).toBe(404);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);

  // The core validates Hydra's signed access token before persisting this folder.
  const folder = `hydra-${crypto.randomUUID()}`;
  await page.getByTestId("folder-name-input").fill(folder);
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/folders" && response.request().method() === "POST");
  await page.getByTestId("folder-create-submit").click();
  expect((await created).ok()).toBe(true);
  // Persistence is verified through the UI after a full /drive reload: SSR +
  // resumeMount must render the stored folder without the DOM corruption that
  // issue #19 documented (fixed in #21).
  await page.goto("/drive");
  await expect(page.getByTestId("drive-page")).toBeVisible();
  await expect(page.getByTestId("folder-list")).toContainText(folder);

  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL(/\/login$/);
  await expectSignedOut(page);
  await page.goto("/drive");
  await expect(page).toHaveURL(/\/login$/);
});
