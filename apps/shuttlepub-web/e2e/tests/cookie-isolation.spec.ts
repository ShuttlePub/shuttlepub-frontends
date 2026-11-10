import { expect, test } from "@playwright/test";
import { createAuth } from "../../bff/auth.ts";

test("HTTPS pending cookie rejects sibling Domain injection (legacy prefix positive control)", async ({ page, context }) => {
  const appOrigin = "https://app.shuttlepub.example";
  let exchanges = 0;
  const auth = createAuth({
    appOrigin, hydraPublicUrl: "https://hydra.example", issuer: "https://hydra.example",
    kratosPublicUrl: "https://kratos.example", emumetApiUrl: "https://emumet.example",
    clientId: "cookie-isolation-fixture", clientSecret: "fixture-only",
    cookieSecret: Buffer.alloc(32, 7).toString("base64"),
  }, { fetch: async () => { exchanges++; throw new Error("No token exchange expected"); } });
  const start = () => auth.handle(new Request(appOrigin + "/auth/oauth/start"));
  const attacker = await start();
  const attackerCookie = attacker.headers.getSetCookie()[0]!;
  const attackerState = new URL(attacker.headers.get("location")!).searchParams.get("state")!;
  const victim = await start();
  const victimCookie = victim.headers.getSetCookie()[0]!;
  const victimValue = victimCookie.split(";")[0]!.split("=")[1]!;
  const injected = attackerCookie.replace("Path=/", "Domain=shuttlepub.example; Path=/auth/callback");

  await context.route("https://evil.shuttlepub.example/**", async route => {
    const legacy = route.request().url().endsWith("/legacy");
    await route.fulfill({ status: 200, body: "test-only cookie injection",
      headers: { "Set-Cookie": legacy ? injected.replace("__Host-", "__Secure-") : injected } });
  });
  let callbackCookies = "";
  await context.route(appOrigin + "/**", async route => {
    if (new URL(route.request().url()).pathname === "/seed") {
      await route.fulfill({ status: 200, body: "test-only legitimate flow", headers: { "Set-Cookie": victimCookie } });
      return;
    }
    callbackCookies = await route.request().headerValue("cookie") ?? "";
    const response = await auth.handle(new Request(route.request().url(), { headers: { Cookie: callbackCookies } }));
    await route.fulfill({ status: response.status, body: await response.text(),
      headers: Object.fromEntries(response.headers) });
  });

  await page.goto(appOrigin + "/seed");
  await page.goto("https://evil.shuttlepub.example/legacy");
  await page.goto("https://evil.shuttlepub.example/host-prefix");
  const cookies = await context.cookies(appOrigin + "/auth/callback");
  // Chromium accepts the old __Secure- Domain cookie, proving the attack surface.
  expect(cookies.find(cookie => cookie.name === "__Secure-shuttlepub_oauth")).toMatchObject({
    domain: ".shuttlepub.example", path: "/auth/callback",
  });
  const pending = cookies.filter(cookie => cookie.name === "__Host-shuttlepub_oauth");
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    domain: "app.shuttlepub.example", path: "/", value: victimValue,
    httpOnly: true, secure: true, sameSite: "Lax",
  });
  const response = await page.goto(appOrigin + "/auth/callback?code=unused&state=" + encodeURIComponent(attackerState));
  expect(response?.status()).toBe(401);
  expect(callbackCookies).toContain("__Secure-shuttlepub_oauth=");
  expect(callbackCookies).toContain("__Host-shuttlepub_oauth=" + victimValue);
  expect((await context.cookies()).some(cookie => cookie.name === auth.sessionCookieName)).toBe(false);
  expect(exchanges).toBe(0);
});
