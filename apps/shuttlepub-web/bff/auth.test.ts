import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { pkceChallenge } from "@shuttlepub/auth-core";
import { createAuth, EMUMET_AUDIENCE, safeAppReturnTo, type Auth, type FetchLike, type ViewerSession } from "./auth.ts";
import { loadAuthConfig, type AuthConfig } from "./auth-config.ts";
import { createApp } from "./app.ts";

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair("RS256"); wrongKeys = await generateKeyPair("RS256"); });
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const origin = "https://shuttlepub.example";
const secret = Buffer.alloc(32, 7).toString("base64"); // Test fixture only.
const now = () => Math.floor(Date.now() / 1000);
function req(path: string, init?: RequestInit) { return new Request(origin + path, init); }
function cookie(response: Response, name: string) {
  return response.headers.getSetCookie().find(value => value.startsWith(name + "="))?.split(";")[0] ?? "";
}
async function fixture(rememberLogin = false) {
  let authorize: URL;
  let currentSubject = "viewer";
  let rememberedSubject: string | undefined;
  let selectedSubject = "viewer";
  let mode = "ok";
  let exchanges = 0;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  let issuer = "";
  let accessToken = "";
  const revoked: string[] = [];
  const sign = (payload: JWTPayload, wrong = false) => new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(wrong ? wrongKeys.privateKey : keys.privateKey);
  async function access(overrides: JWTPayload = {}) {
    return sign({ iss: issuer, sub: "viewer", aud: EMUMET_AUDIENCE, iat: now(), exp: now() + 3600, ...overrides });
  }
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/.well-known/jwks.json") return Response.json({ keys: [jwk] });
    if (path === "/oauth2/revoke") {
      revoked.push((await request.formData()).get("token") as string);
      return new Response(null, { status: 200 });
    }
    if (path === "/oauth2/token") {
      exchanges++;
      const body = new URLSearchParams(await request.text());
      if (mode === "pkce" || body.get("grant_type") === "authorization_code" &&
        await pkceChallenge(body.get("code_verifier") ?? "") !== authorize.searchParams.get("code_challenge")) {
        return Response.json({ error: "invalid_grant", leak: "SENSITIVE_PROVIDER_RESPONSE" }, { status: 400 });
      }
      accessToken = await access({ sub: selectedSubject, ...(mode === "access-aud" ? { aud: "wrong-api" } : mode === "access-sub" ? { sub: "different-viewer" } : {}) });
      const payload: JWTPayload = { iss: issuer, sub: selectedSubject, aud: "shuttlepub-bff", iat: now(), exp: now() + 3600,
        nonce: authorize.searchParams.get("nonce") };
      if (mode === "issuer") payload.iss = "https://evil.example";
      if (mode === "audience") payload.aud = "booskiff-bff";
      if (mode === "expiry") payload.exp = now();
      if (mode === "nonce") payload.nonce = "wrong";
      if (mode === "multi-audience") payload.aud = ["shuttlepub-bff", "another-client"];
      if (mode === "missing-exp") delete payload.exp;
      const id = await sign(payload, mode === "signature");
      return Response.json({ access_token: accessToken, refresh_token: "SECRET_REFRESH_TOKEN", token_type: mode === "token-type" ? "MAC" : "Bearer",
        expires_in: mode === "invalid-ttl" ? -1 : 3600, scope: "openid profile email offline_access",
        ...(mode === "missing-id" ? {} : { id_token: id }) });
    }
    return new Response(null, { status: 503 });
  } });
  servers.push(server);
  issuer = server.url.origin;
  const config: AuthConfig = { appOrigin: origin, hydraPublicUrl: issuer, issuer,
    kratosPublicUrl: issuer, emumetApiUrl: "https://emumet.example", clientId: "shuttlepub-bff", clientSecret: "fixture-client-secret", cookieSecret: secret };
  const auth = createAuth(config);
  async function start(returnTo = "/") {
    const response = await auth.handle(req("/auth/oauth/start?return_to=" + encodeURIComponent(returnTo)));
    authorize = new URL(response.headers.get("location")!);
    selectedSubject = rememberLogin && authorize.searchParams.get("prompt") !== "login"
      ? rememberedSubject ?? currentSubject : currentSubject;
    if (rememberLogin) rememberedSubject = selectedSubject;
    return { response, pending: cookie(response, auth.oauthCookieName), authorize };
  }
  async function callback(pending: string, state = authorize.searchParams.get("state")!) {
    return auth.handle(req("/auth/callback?code=code&state=" + encodeURIComponent(state), { headers: { Cookie: pending } }));
  }
  async function login() {
    const { pending } = await start();
    const response = await callback(pending);
    expect(response.status).toBe(302);
    return cookie(response, auth.sessionCookieName);
  }
  return { auth, config, start, callback, login, access, setMode: (value: string) => { mode = value; },
    setIdentity: (value: string) => { currentSubject = value; },
    get exchanges() { return exchanges; }, get accessToken() { return accessToken; }, revoked };
}

describe("OIDC BFF security boundary", () => {
  test("PKCE S256 + nonce/state, app-specific host cookies, encrypted token-only session", async () => {
    const f = await fixture();
    const { response, pending, authorize } = await f.start("/settings?tab=profile");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("prompt")).toBe("login");
    expect(authorize.searchParams.get("audience")).toBe("account");
    expect(authorize.searchParams.get("nonce")).toHaveLength(43);
    expect(authorize.searchParams.get("state")).toHaveLength(43);
    expect(authorize.searchParams.get("redirect_uri")).toBe(origin + "/auth/callback");
    expect(f.auth.oauthCookieName).toBe("__Host-shuttlepub_oauth");
    expect(response.headers.get("set-cookie")).toContain("Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=300");
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    const callback = await f.callback(pending);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/settings?tab=profile");
    expect(callback.headers.getSetCookie()).toContainEqual(expect.stringContaining("__Host-shuttlepub_oauth=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0"));
    const sessionHeader = callback.headers.getSetCookie().find(v => v.startsWith(f.auth.sessionCookieName + "="))!;
    expect(sessionHeader).toContain("Path=/; HttpOnly; SameSite=Lax; Secure");
    expect(sessionHeader).not.toContain("Domain=");
    expect(sessionHeader.length).toBeLessThanOrEqual(4096);
    const sessionCookie = cookie(callback, f.auth.sessionCookieName);
    expect(sessionCookie).not.toContain(f.accessToken);
    expect(sessionCookie).not.toContain("SECRET_REFRESH_TOKEN");
    const cookies: string[] = [];
    const viewer = await f.auth.resolveSession(req("/", { headers: { Cookie: sessionCookie } }), cookies);
    expect(viewer.sub).toBe("viewer");
    const session = await f.auth.handle(req("/auth/session", { headers: { Cookie: sessionCookie } }));
    expect(await session.json()).toEqual({ authenticated: true });
    expect(session.headers.get("cache-control")).toBe("no-store");
    expect(session.headers.get("referrer-policy")).toBe("no-referrer");
    const otherApp = await f.auth.handle(req("/auth/session", { headers: { Cookie: sessionCookie.replace(f.auth.sessionCookieName, "booskiff_session") } }));
    expect(otherApp.status).toBe(401);
    const otherKey = createAuth({ ...f.config, cookieSecret: Buffer.alloc(32, 8).toString("base64") });
    expect((await otherKey.handle(req("/auth/session", { headers: { Cookie: sessionCookie } }))).status).toBe(401);
  });

  test("ambiguous pending cookies fail closed in either order before token exchange", async () => {
    const f = await fixture();
    const victim = await f.start();
    const attacker = await f.start();
    for (const pending of [
      attacker.pending + "; " + victim.pending,
      victim.pending + "; " + attacker.pending,
      attacker.pending + "; " + attacker.pending,
      f.auth.oauthCookieName + "=; " + attacker.pending,
    ]) {
      const response = await f.callback(pending, attacker.authorize.searchParams.get("state")!);
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(f.exchanges).toBe(0);
  });

  test("duplicate session cookies never choose the first valid identity", async () => {
    const f = await fixture();
    const session = await f.login();
    for (const cookies of [session + "; " + session, session + "; " + f.auth.sessionCookieName + "=invalid",
      f.auth.sessionCookieName + "=invalid; " + session]) {
      expect((await f.auth.handle(req("/auth/session", { headers: { Cookie: cookies } }))).status).toBe(401);
    }
  });

  test("A logout -> B login bypasses a modeled remembered Hydra subject", async () => {
    const f = await fixture(true);
    f.setIdentity("viewer-a");
    const first = await f.login();
    expect((await f.auth.resolveSession(req("/", { headers: { Cookie: first } }), [])).sub).toBe("viewer-a");
    expect((await f.auth.handle(req("/auth/logout", {
      method: "POST", headers: { Origin: origin, Cookie: first },
    }))).status).toBe(204);
    // Only the current Kratos identity changes; the modeled Hydra login still remembers A.
    f.setIdentity("viewer-b");
    const second = await f.login();
    expect((await f.auth.resolveSession(req("/", { headers: { Cookie: second } }), [])).sub).toBe("viewer-b");
  });

  for (const mode of ["signature", "issuer", "audience", "expiry", "nonce", "multi-audience", "missing-exp", "missing-id", "pkce", "access-aud", "access-sub", "token-type", "invalid-ttl"]) {
    test(mode + " failure never creates a session or leaks upstream bodies", async () => {
      const f = await fixture();
      const { pending } = await f.start();
      f.setMode(mode);
      const response = await f.callback(pending);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
      expect(response.headers.getSetCookie()).toContainEqual(expect.stringContaining(f.auth.sessionCookieName + "=;"));
      expect(response.headers.getSetCookie()).toContainEqual(expect.stringContaining("Max-Age=0"));
    });
  }
  test("state mismatch, tampered cookie, denial, absent params and exact TTL boundary fail before token exchange", async () => {
    const f = await fixture();
    const { pending } = await f.start();
    expect((await f.callback(pending, "wrong-state")).status).toBe(401);
    expect((await f.callback(pending + "corrupted")).status).toBe(401);
    expect((await f.auth.handle(req("/auth/callback?error=access_denied&error_description=SECRET"))).status).toBe(401);
    expect((await f.auth.handle(req("/auth/callback"))).status).toBe(401);
    const before = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(before + 300_000);
    try { expect((await f.callback(pending)).status).toBe(401); } finally { clock.mockRestore(); }
    expect(f.exchanges).toBe(0);
  });
  test("strict Origin check applies to logout/login and GraphQL mutation, GET logout is forbidden", async () => {
    const f = await fixture();
    for (const path of ["/auth/logout", "/auth/login"]) {
      for (const source of [undefined, "null", "https://evil.example", origin + "/"]) {
        const headers = new Headers({ Referer: origin });
        if (source) headers.set("Origin", source);
        expect((await f.auth.handle(req(path, { method: "POST", headers }))).status).toBe(403);
      }
    }
    expect((await f.auth.handle(req("/auth/logout"))).status).toBe(405);
    const app = createApp({ mode: "real", apiUrl: "https://backend.example" }, { auth: f.config });
    const response = await app.handleGraphql(req("/graphql", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ query: 'mutation { selectProfile(id: "other") { activeProfile { id } } }' }) }));
    expect(response.status).toBe(403);
    expect((await app.handleGraphql(req('/graphql?query=' + encodeURIComponent('mutation { selectProfile(id: "other") { activeProfile { id } } }')))).status).toBe(405);
    const crossOriginRead = await app.handleGraphql(req("/graphql?query=%7BapiMode%7D", { headers: { Origin: "https://evil.example" } }));
    expect(crossOriginRead.headers.get("access-control-allow-origin")).toBeNull();
    expect(crossOriginRead.headers.get("access-control-allow-credentials")).toBeNull();
  });
  test("unsolicited callback errors cannot log out an existing viewer or destroy another pending flow", async () => {
    const f = await fixture();
    const sessionCookie = await f.login();
    const { pending } = await f.start();
    for (const path of ["/auth/callback?error=access_denied", "/auth/callback?code=invalid&state=foreign"]) {
      const response = await f.auth.handle(req(path, { headers: { Cookie: sessionCookie + "; " + pending } }));
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
    expect((await f.auth.handle(req("/auth/session", { headers: { Cookie: sessionCookie } }))).status).toBe(200);
    expect((await f.callback(pending)).status).toBe(302);
  });
  test("logout revokes both tokens, clears cookies even when Kratos is unavailable", async () => {
    const f = await fixture();
    const session = await f.login();
    const response = await f.auth.handle(req("/auth/logout", { method: "POST", headers: { Origin: origin, Cookie: session } }));
    expect(response.status).toBe(204);
    expect(f.revoked).toContain(f.accessToken);
    expect(f.revoked).toContain("SECRET_REFRESH_TOKEN");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie().every(value => value.includes("Max-Age=0"))).toBe(true);
    expect((await f.auth.handle(req("/auth/session"))).status).toBe(401);
  });
  test("valid refresh retains selection; expired session/failed refresh fail closed", async () => {
    const f = await fixture();
    const initial = await f.login();
    const viewer = await f.auth.resolveSession(req("/", { headers: { Cookie: initial } }), []);
    const expiring: ViewerSession = { ...viewer, expiresAt: now() - 1, activeProfileId: "owned" };
    const header = await f.auth.sealSession(expiring);
    const cookies: string[] = [];
    const refreshed = await f.auth.resolveSession(req("/", { headers: { Cookie: header.split(";")[0]! } }), cookies);
    expect(refreshed.activeProfileId).toBe("owned");
    expect(cookies).toHaveLength(1);
    f.setMode("pkce");
    await expect(f.auth.resolveSession(req("/", { headers: { Cookie: header.split(";")[0]! } }), [])).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const active = await f.auth.sealSession({ ...viewer, expiresAt: now() + 30 });
    expect((await f.auth.resolveSession(req("/", { headers: { Cookie: active.split(";")[0]! } }), [])).accessToken).toBe(viewer.accessToken);
    const absoluteExpired = await f.auth.sealSession({ ...viewer, sessionExpiresAt: now() });
    await expect(f.auth.resolveSession(req("/", { headers: { Cookie: absoluteExpired.split(";")[0]! } }), [])).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  test("tokens never appear in auth response bodies or auth diagnostics", async () => {
    const f = await fixture();
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const session = await f.login();
      const response = await f.auth.handle(req("/auth/session", { headers: { Cookie: session } }));
      const text = await response.text();
      const diagnostics = JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls]);
      for (const token of [f.accessToken, "SECRET_REFRESH_TOKEN", "fixture-client-secret"]) {
        expect(text).not.toContain(token);
        expect(diagnostics).not.toContain(token);
      }
    } finally { log.mockRestore(); warn.mockRestore(); error.mockRestore(); }
  });
});

test("safe return URL rejects normalization, encoded slash/backslash/control and absolute redirects", () => {
  for (const value of ["https://evil.example", "//evil.example", "/a/..//evil.example", "/a/%2e%2e//evil.example", "/\\evil.example", "/\nevil.example", "/%2f%2fevil.example", "/%5cevil.example", "/%0d%0aLocation:evil", "/bad%", "javascript:alert(1)"]) {
    expect(safeAppReturnTo(value)).toBe("/");
  }
  expect(safeAppReturnTo("/settings?tab=profile#selection")).toBe("/settings?tab=profile#selection");
  expect(safeAppReturnTo("/プロフィール")).toBe("/%E3%83%97%E3%83%AD%E3%83%95%E3%82%A3%E3%83%BC%E3%83%AB");
});

test("real config requires app-only key and URLs; issuer is exact, not normalized", () => {
  const env = { APP_ORIGIN: origin, EMUMET_API_URL: "https://emumet.example", HYDRA_PUBLIC_URL: "https://hydra.example/",
    KRATOS_PUBLIC_URL: "https://kratos.example", HYDRA_CLIENT_ID: "shuttlepub-bff", HYDRA_CLIENT_SECRET: "fixture", SHUTTLEPUB_COOKIE_SECRET_BASE64: secret };
  expect(loadAuthConfig(env).issuer).toBe("https://hydra.example/");
  for (const key of Object.keys(env)) expect(() => loadAuthConfig({ ...env, [key]: undefined })).toThrow();
  expect(() => loadAuthConfig({ ...env, APP_ORIGIN: "http://production.example" })).toThrow();
  expect(() => loadAuthConfig({ ...env, EMUMET_API_URL: "https://user:secret@emumet.example" })).toThrow();
  expect(() => loadAuthConfig({ ...env, SHUTTLEPUB_COOKIE_SECRET_BASE64: "short" })).toThrow();
  // The public actor host is optional at startup (never derived from EMUMET_API_URL) and must be host[:port].
  expect(loadAuthConfig(env).emumetPublicHost).toBeUndefined();
  expect(loadAuthConfig({ ...env, EMUMET_PUBLIC_HOST: "social.example:8443" }).emumetPublicHost).toBe("social.example:8443");
  for (const bad of ["https://social.example", "social.example/path", "user@social.example"]) {
    expect(() => loadAuthConfig({ ...env, EMUMET_PUBLIC_HOST: bad })).toThrow();
  }
});

test("Kratos bridge uses its CSRF node and forwards only IdP cookies, never credentials or app cookies in responses", async () => {
  const f = await fixture();
  const seen: { url: string; init: RequestInit }[] = [];
  const auth = createAuth(f.config, { fetch: async (url, init = {}) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("/login/browser")) {
      return Response.json({ id: "flow-id", ui: { nodes: [{ attributes: { name: "csrf_token", value: "kratos-csrf-fixture" } }] } }, {
        headers: { "Set-Cookie": "ory_kratos_csrf_token=fixture; HttpOnly; Path=/" },
      });
    }
    const headers = new Headers();
    headers.append("Set-Cookie", "ory_kratos_session=fixture; HttpOnly; Path=/");
    headers.append("Set-Cookie", "shuttlepub_session=forged; Path=/");
    return Response.json({ session: { secret: "SENSITIVE_PROVIDER_BODY" } }, { headers });
  } });
  const response = await auth.handle(req("/auth/login", {
    method: "POST", headers: { Origin: origin, Cookie: "shuttlepub_session=APP_COOKIE_SECRET; other_session=OTHER_COOKIE_SECRET; ory_kratos_session=old", "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: " user@example.com ", password: "PASSWORD_FIXTURE" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ next: "/auth/oauth/start" });
  expect(seen).toHaveLength(2);
  expect(JSON.parse(seen[1]!.init.body as string)).toEqual({
    method: "password", identifier: "user@example.com", password: "PASSWORD_FIXTURE", csrf_token: "kratos-csrf-fixture",
  });
  for (const request of seen) {
    const cookies = new Headers(request.init.headers).get("cookie")!;
    expect(cookies).not.toContain("APP_COOKIE_SECRET");
    expect(cookies).not.toContain("OTHER_COOKIE_SECRET");
  }
  expect(response.headers.getSetCookie().every(value => value.startsWith("ory_kratos"))).toBe(true);
  expect(JSON.stringify(response.headers.getSetCookie())).not.toContain("forged");
});

test("Kratos errors/malformed flows are sanitized; logout never follows a supplied URL", async () => {
  const f = await fixture();
  for (const status of [400, 401, 500]) {
    const auth = createAuth(f.config, { fetch: async (url) => String(url).includes("/login/browser")
      ? Response.json({ id: "flow-id", ui: { nodes: [{ attributes: { name: "csrf_token", value: "csrf" } }] } })
      : Response.json({ error: "SENSITIVE_UPSTREAM_ERROR" }, { status }) });
    const response = await auth.handle(req("/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "test@example.com", password: "fixture" }) }));
    expect(response.status).toBe(status === 500 ? 502 : 401);
    expect(await response.text()).not.toContain("SENSITIVE_UPSTREAM_ERROR");
  }
  const seen: string[] = [];
  const auth = createAuth(f.config, { fetch: async (url) => {
    seen.push(String(url));
    return String(url).endsWith("/browser")
      ? Response.json({ logout_url: "https://evil.example/exfiltrate", logout_token: "logout-token" })
      : new Response(null, { status: 303, headers: { "Set-Cookie": "ory_kratos_session=; Max-Age=0; Path=/" } });
  } });
  const logout = await auth.handle(req("/auth/logout", { method: "POST", headers: { Origin: origin } }));
  expect(logout.status).toBe(204);
  expect(seen).toEqual([f.config.kratosPublicUrl + "/self-service/logout/browser", f.config.kratosPublicUrl + "/self-service/logout?token=logout-token"]);
  expect(logout.headers.getSetCookie()).toContainEqual(expect.stringContaining("ory_kratos_session=;"));
  expect((await auth.handle(req("/auth/login", { method: "POST", headers: { Origin: origin }, body: "invalid-json" }))).status).toBe(400);
});

describe("authenticated Emumet Profile context", () => {
  const owned = { id: "owned-account", name: "owner", display_name: "My profile", moderation: null, profile_id: "owned-profile", profile_username: null };
  async function graphql(app: ReturnType<typeof createApp>, sessionCookie: string, query: string) {
    return app.handleGraphql(req("/graphql", {
      method: "POST", headers: { Origin: origin, Cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }));
  }
  test("Bearer only goes to Emumet; selected ownership is revalidated on every request, never shared between viewers", async () => {
    const f = await fixture();
    const session = await f.login();
    const requests: { url: string; headers: Headers }[] = [];
    let items = [owned];
    const app = createApp({ mode: "real", apiUrl: "https://shuttlepub-backend.example" }, {
      auth: f.config,
      emumetFetch: (async (url: string | URL, init: RequestInit) => {
        expect(new URL(url).searchParams.get("direction")).toBe("next");
        requests.push({ url: String(url), headers: new Headers(init.headers) });
        return Response.json({ items, first: items[0]?.id ?? null, last: items.at(-1)?.id ?? null });
      }) as FetchLike,
    });
    const list = await graphql(app, session, "{ availableProfiles { id handle displayName } profileContext { activeProfile { id } } }");
    const body = await list.json();
    expect(body).toEqual({ data: { availableProfiles: [{ id: "owned-account", handle: "owner", displayName: "My profile" }], profileContext: { activeProfile: null } } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toStartWith("https://emumet.example/api/v1/accounts?");
    expect(requests[0]!.url).not.toContain("ids=");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer " + f.accessToken);
    expect(requests[0]!.headers.get("cookie")).toBeNull();
    expect(JSON.stringify(body)).not.toContain(f.accessToken);

    const selected = await graphql(app, session, 'mutation { selectProfile(id: "owned-account") { activeProfile { id } } }');
    expect(await selected.json()).toEqual({ data: { selectProfile: { activeProfile: { id: "owned-account" } } } });
    const selectedCookie = cookie(selected, f.auth.sessionCookieName);
    expect(selectedCookie).not.toBe("");
    const current = await graphql(app, selectedCookie, "{ profileContext { activeProfile { id } } }");
    expect(await current.json()).toEqual({ data: { profileContext: { activeProfile: { id: "owned-account" } } } });
    const secondViewer = await graphql(app, session, "{ profileContext { activeProfile { id } } }");
    expect(await secondViewer.json()).toEqual({ data: { profileContext: { activeProfile: null } } });
    items = [];
    const removed = await graphql(app, selectedCookie, "{ profileContext { activeProfile { id } } }");
    expect((await removed.json()).errors[0].extensions.code).toBe("PROFILE_UNAVAILABLE");
    const denied = await graphql(app, session, 'mutation { selectProfile(id: "not-owned") { activeProfile { id } } }');
    expect((await denied.json()).errors[0].extensions.code).toBe("PROFILE_UNAVAILABLE");
    expect(denied.headers.getSetCookie()).toHaveLength(0);
  });
  for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [500, "UPSTREAM_UNAVAILABLE"], [501, "UPSTREAM_UNAVAILABLE"], [302, "UPSTREAM_UNAVAILABLE"]] as const) {
    test(`Emumet HTTP ${status} cannot turn into Profile data`, async () => {
      const f = await fixture();
      const session = await f.login();
      const app = createApp({ mode: "real", apiUrl: "https://backend.example" }, {
        auth: f.config,
        emumetFetch: (async () => Response.json({ token: "SENSITIVE_ERROR_BODY" }, { status })) as FetchLike,
      });
      const result = await graphql(app, session, "{ availableProfiles { id } }");
      const body = await result.json();
      expect(body.data).toBeNull();
      expect(body.errors[0].extensions.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("SENSITIVE_ERROR_BODY");
      if (status === 401) expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    });
  }
  test("unavailable/malformed/moderated data and unauthenticated access never fall back to mock", async () => {
    const f = await fixture();
    const session = await f.login();
    for (const data of [{}, { items: [{ id: "made-up" }] }, { items: [owned, owned] }, { items: [{ ...owned, profile_id: undefined }] }]) {
      const app = createApp({ mode: "real", apiUrl: "https://backend.example" }, {
        auth: f.config, emumetFetch: (async () => Response.json(data)) as FetchLike,
      });
      const result = await graphql(app, session, "{ availableProfiles { id } }");
      expect((await result.json()).errors[0].extensions.code).toBe("INVALID_UPSTREAM_RESPONSE");
    }
    const restricted = createApp({ mode: "real", apiUrl: "https://backend.example" }, {
      auth: f.config, emumetFetch: async () => Response.json({ items: [{ ...owned, moderation: { type: "banned" } }] }),
    });
    expect((await (await graphql(restricted, session, "{ availableProfiles { id } }")).json()).errors[0].extensions.code).toBe("FORBIDDEN");
    let called = false;
    const app = createApp({ mode: "real", apiUrl: "https://backend.example" }, {
      auth: f.config, emumetFetch: (async () => { called = true; throw new Error("unavailable"); }) as FetchLike,
    });
    expect((await (await graphql(app, "", "{ availableProfiles { id } }")).json()).errors[0].extensions.code).toBe("UNAUTHENTICATED");
    expect(called).toBe(false);
    expect((await (await graphql(app, session, "{ availableProfiles { id } }")).json()).errors[0].extensions.code).toBe("UPSTREAM_UNAVAILABLE");
  });
  test("exhausts owned-account cursor pages and rejects repeating cursors", async () => {
    const f = await fixture();
    const session = await f.login();
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...owned, id: "owned-" + i }));
    const urls: string[] = [];
    let repeating = false;
    const app = createApp({ mode: "real", apiUrl: "https://backend.example" }, {
      auth: f.config, emumetFetch: (async (url: string | URL) => {
        urls.push(String(url));
        const firstPage = !new URL(url).searchParams.has("cursor") || repeating;
        return Response.json({ items: firstPage ? fullPage : [owned], last: firstPage ? "owned-99" : owned.id });
      }) as FetchLike,
    });
    const result = await graphql(app, session, "{ availableProfiles { id } }");
    expect((await result.json()).data.availableProfiles).toHaveLength(101);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]!).searchParams.get("cursor")).toBe("owned-99");
    expect(new URL(urls[1]!).searchParams.get("direction")).toBe("next");
    repeating = true;
    expect((await (await graphql(app, session, "{ availableProfiles { id } }")).json()).errors[0].extensions.code).toBe("INVALID_UPSTREAM_RESPONSE");
  });
});
