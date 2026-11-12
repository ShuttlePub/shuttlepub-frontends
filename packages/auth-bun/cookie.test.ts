// ============================================================
// Cookie の曖昧受理 (cookie tossing) 対策 — 同名 cookie が複数ある場合は
// どれも採用しない (fail-closed)。共有 parser / CookieJar / session adapter。
// ============================================================

import { describe, expect, test } from "bun:test";
import { CookieJar, createSessionAdapter, parseCookieValue, type AppSession } from "./src/index.ts";

const KEY_BASE64 = btoa("0123456789abcdef0123456789abcdef");
const session: AppSession = {
  v: 1, sub: "user-1", accessToken: "access-1", tokenType: "Bearer", scope: "openid",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const adapter = createSessionAdapter({
  cookieSecretBase64: KEY_BASE64, sessionCookieName: "app_session", isSecureOrigin: false,
  hydraPublicUrl: "http://hydra.test", hydraClientId: "client", hydraClientSecret: "secret", refreshSkewSeconds: 60,
});

function request(cookie: string): Request {
  return new Request("http://localhost:3000/", { headers: { cookie } });
}

describe("parseCookieValue", () => {
  test("returns the value of a single cookie anywhere in the header", () => {
    expect(parseCookieValue("a=1", "a")).toBe("1");
    expect(parseCookieValue("x=0; a=1; y=2", "a")).toBe("1");
    expect(parseCookieValue("x=0;a=1", "a")).toBe("1");
    expect(parseCookieValue("a=v=with=equals", "a")).toBe("v=with=equals");
  });

  test("returns null when the cookie is absent, empty, or the header is missing", () => {
    expect(parseCookieValue(null, "a")).toBeNull();
    expect(parseCookieValue("", "a")).toBeNull();
    expect(parseCookieValue("b=1", "a")).toBeNull();
    expect(parseCookieValue("a=", "a")).toBeNull();
  });

  test("does not match a longer or prefixed name", () => {
    expect(parseCookieValue("xa=1; a_b=2; ab=3", "a")).toBeNull();
    expect(parseCookieValue("a.b=1", "a.b")).toBe("1");
    expect(parseCookieValue("axb=1", "a.b")).toBeNull();
  });

  test("returns null when the same name appears more than once, whatever the order or value", () => {
    expect(parseCookieValue("a=attacker; a=victim", "a")).toBeNull();
    expect(parseCookieValue("a=victim; b=1; a=attacker", "a")).toBeNull();
    expect(parseCookieValue("a=same; a=same", "a")).toBeNull();
    expect(parseCookieValue("a=; a=victim", "a")).toBeNull();
  });

  test("duplicates of an unrelated name do not affect the requested cookie", () => {
    expect(parseCookieValue("b=1; b=2; a=ok", "a")).toBe("ok");
  });
});

describe("session adapter with duplicate session cookies", () => {
  test("accepts a single sealed session cookie", async () => {
    const sealed = (await adapter.sealSessionCookie(session)).split(";")[0]!;
    expect((await adapter.getSession(request(sealed)))?.sub).toBe("user-1");
  });

  test("rejects the session when another cookie of the same name is injected, in either order", async () => {
    const sealed = (await adapter.sealSessionCookie(session)).split(";")[0]!;
    const injected = (await adapter.sealSessionCookie({ ...session, sub: "attacker" })).split(";")[0]!;
    expect(await adapter.getSession(request(`${injected}; ${sealed}`))).toBeNull();
    expect(await adapter.getSession(request(`${sealed}; ${injected}`))).toBeNull();
  });
});

describe("CookieJar.mergeBrowserCookies", () => {
  test("forwards a single ory_kratos cookie and drops application cookies", () => {
    const jar = new CookieJar();
    jar.mergeBrowserCookies(request("app_session=secret; ory_kratos_session=s1; ory_kratos_csrf_token_x=c1"));
    expect(jar.toCookieHeader()).toBe("ory_kratos_session=s1; ory_kratos_csrf_token_x=c1");
  });

  test("drops a name that appears more than once and keeps the unambiguous ones", () => {
    const jar = new CookieJar();
    jar.mergeBrowserCookies(request("ory_kratos_session=attacker; ory_kratos_csrf_token_x=c1; ory_kratos_session=victim"));
    expect(jar.toCookieHeader()).toBe("ory_kratos_csrf_token_x=c1");
  });

  test("keeps the cookie value that upstream already set for the name", () => {
    const jar = new CookieJar();
    jar.ingest(new Response(null, { headers: { "Set-Cookie": "ory_kratos_session=fresh; Path=/" } }));
    jar.mergeBrowserCookies(request("ory_kratos_session=old"));
    expect(jar.toCookieHeader()).toBe("ory_kratos_session=fresh");
  });

  test("preserves '=' inside a cookie value", () => {
    const jar = new CookieJar();
    jar.mergeBrowserCookies(request("ory_kratos_session=a=b=="));
    expect(jar.toCookieHeader()).toBe("ory_kratos_session=a=b==");
  });
});
