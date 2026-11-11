import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3231";
const tokenPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"(?:access_token|refresh_token|id_token)"\s*:/;

async function submitCredentials(page: Page, identifier = "testuser@example.com", password = "testuser") {
  // No login screen is being designed: use the JSON Kratos bridge, then navigate
  // through the same real Hydra provider/consent used by booskiff-web's E2E.
  const response = await page.request.post("/auth/login", {
    headers: { Origin: origin },
    data: { identifier, password },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ next: "/auth/oauth/start" });
}

async function enterCredentials(page: Page) {
  await submitCredentials(page);
  await page.goto("/auth/oauth/start");
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
}

async function profiles(page: Page) {
  return page.request.post("/graphql", {
    headers: { Origin: origin },
    data: { query: "{ availableProfiles { id handle displayName } profileContext { activeProfile { id } } }" },
  });
}

async function signedOut(page: Page) {
  expect((await page.context().cookies()).some(cookie => cookie.name === "shuttlepub_session")).toBe(false);
  expect((await page.request.get("/auth/session")).status()).toBe(401);
  const body = await (await profiles(page)).json();
  expect(body.data).toBeNull();
  expect(body.errors[0].extensions.code).toBe("UNAUTHENTICATED");
}

test("Kratos login -> Hydra PKCE -> real Emumet owned-account read -> logout (no tokens in browser)", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", message => messages.push(message.text()));
  await enterCredentials(page);
  const callback = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/callback");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  expect((await callback).status()).toBe(302);
  await expect(page).toHaveURL(origin + "/");
  const cookies = await page.context().cookies();
  expect(cookies.find(cookie => cookie.name === "shuttlepub_session")).toMatchObject({ httpOnly: true, path: "/", sameSite: "Lax", secure: false });
  expect(cookies.some(cookie => cookie.name === "shuttlepub_oauth")).toBe(false);
  expect(cookies.some(cookie => /^(ratcap|booskiff)_session$/.test(cookie.name))).toBe(false);
  const session = await page.request.get("/auth/session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ authenticated: true });
  // The real Emumet service verifies Hydra's signed access token with audience=account.
  // A new Kratos identity has no SNS Account/Profile. Never invent one to make the test pass.
  const read = await profiles(page);
  expect(read.status()).toBe(200);
  expect(await read.json()).toEqual({ data: { availableProfiles: [], profileContext: { activeProfile: null } } });
  expect(read.headers()["cache-control"]).toBe("no-store");
  const forbiddenSelection = await page.request.post("/graphql", {
    headers: { Origin: origin }, data: { query: 'mutation { selectProfile(id: "not-owned") { activeProfile { id } } }' },
  });
  expect((await forbiddenSelection.json()).errors[0].extensions.code).toBe("PROFILE_UNAVAILABLE");
  const clientState = await page.evaluate(() => JSON.stringify({
    local: localStorage, session: sessionStorage, cookie: document.cookie, html: document.documentElement.outerHTML,
  }));
  expect(clientState).not.toMatch(tokenPattern);
  expect(clientState).not.toContain("shuttlepub_session");
  expect(messages.join("\n")).not.toMatch(tokenPattern);
  expect((await page.request.post("/auth/logout", { headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  expect((await page.request.post("/auth/logout", { headers: { Origin: origin } })).status()).toBe(204);
  expect((await page.context().cookies()).some(cookie => cookie.name === "ory_kratos_session")).toBe(false);
  await signedOut(page);
});

test("real Hydra consent denial never creates an app session and lands on the login screen", async ({ page }) => {
  await enterCredentials(page);
  const callback = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/callback");
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  // A browser navigation gets the fixed reason, never the provider's error text.
  const response = await callback;
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe("/login?error=denied");
  await expect(page).toHaveURL(origin + "/login?error=denied");
  await signedOut(page);
});

test("state mismatch and a real Hydra invalid-code response fail closed", async ({ page }) => {
  await page.request.get("/auth/oauth/start", { maxRedirects: 0 });
  const wrongState = await page.request.get("/auth/callback?code=bad-code&state=wrong-state");
  expect(wrongState.status()).toBe(401);
  // The same failure as a browser navigation: the login screen with the generic reason.
  await page.goto("/auth/callback?code=bad-code&state=wrong-state");
  await expect(page).toHaveURL(origin + "/login?error=failed");
  const start = await page.request.get("/auth/oauth/start", { maxRedirects: 0 });
  const state = new URL(start.headers()["location"]!).searchParams.get("state");
  const invalidCode = await page.request.get("/auth/callback?code=invalid-code&state=" + encodeURIComponent(state!));
  expect(invalidCode.status()).toBe(401);
  expect(await invalidCode.json()).toEqual({ error: "UNAUTHENTICATED" });
  await signedOut(page);
});

test("A logout -> B login rechecks Kratos despite Hydra remembering A", async ({ page }) => {
  await enterCredentials(page);
  await expect(page.locator("form[data-email]")).toHaveAttribute("data-email", "testuser@example.com");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page).toHaveURL(origin + "/");
  expect((await page.request.post("/auth/logout", { headers: { Origin: origin } })).status()).toBe(204);
  await signedOut(page);
  await submitCredentials(page, "testuser-b@example.com", "testuser-b");

  // Positive control: without prompt=login the provider's real remembered skip
  // branch chooses A, even though Kratos now belongs to B.
  const probe = await page.request.get("/auth/oauth/start", { maxRedirects: 0 });
  const remembered = new URL(probe.headers()["location"]!);
  expect(remembered.searchParams.get("prompt")).toBe("login");
  remembered.searchParams.delete("prompt");
  await page.goto(remembered.toString());
  await expect(page.locator("form[data-email]")).toHaveAttribute("data-email", "testuser@example.com");
  expect((await page.request.get("/auth/session")).status()).toBe(401);

  await page.goto("/auth/oauth/start");
  await expect(page.locator("form[data-email]")).toHaveAttribute("data-email", "testuser-b@example.com");
  const callback = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/callback");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  expect((await callback).status()).toBe(302);
  await expect(page).toHaveURL(origin + "/");
  expect((await page.request.get("/auth/session")).status()).toBe(200);
  expect(await (await profiles(page)).json()).toEqual({ data: { availableProfiles: [], profileContext: { activeProfile: null } } });
  expect((await page.request.post("/auth/logout", { headers: { Origin: origin } })).status()).toBe(204);
  await signedOut(page);
});
