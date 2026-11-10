import {
  buildCookieHeader, importCookieKey, parseCookieValue, pkceChallenge, randomBase64Url,
  safeReturnTo, sealWithKey, unsealWithKey, type AppSession,
} from "@shuttlepub/auth-core";
import { CookieJar, createSessionAdapter } from "@shuttlepub/auth-bun";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthConfig } from "./auth-config.ts";
import { AuthError } from "./auth-error.ts";

export const EMUMET_AUDIENCE = "account"; // Emumet .env/.env.example EXPECTED_AUDIENCE (not its unset-code default).
const OAUTH_TTL = 300;
const SESSION_TTL = 86_400;
export type ViewerSession = AppSession & { sub: string; sessionExpiresAt: number; activeProfileId?: string };
type Pending = { state: string; nonce: string; codeVerifier: string; returnTo: string; expiresAt: number };
export type FetchLike = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
export type AuthDependencies = { fetch?: FetchLike };

export function safeAppReturnTo(value: string | null): string {
  const path = safeReturnTo(value);
  try {
    const decoded = decodeURIComponent(path);
    if (/[\\\x00-\x20\x7f]/.test(path + decoded) || !/^\/(?!\/)/.test(decoded)) return "/";
    const url = new URL(path, "https://app.invalid");
    if (url.origin !== "https://app.invalid" || url.pathname.startsWith("//")) return "/";
    return url.pathname + url.search + url.hash;
  } catch { return "/"; }
}

export function checkOrigin(request: Request, origin: string): Response | null {
  return request.headers.get("origin") === origin
    ? null : Response.json({ error: "FORBIDDEN" }, { status: 403 });
}

function uniqueAuthCookie(header: string | null, name: string): string | null {
  // Cookie headers omit Domain/Path: choosing the first duplicate permits cookie tossing.
  const matches = (header ?? "").split(";").filter(part => part.trim().split("=", 1)[0] === name);
  return matches.length === 1 ? parseCookieValue(header, name) : null;
}

async function scopedSecret(secret: string, purpose: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("shuttlepub-web/v1"),
    info: new TextEncoder().encode(purpose),
  }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export function createAuth(config: AuthConfig, deps: AuthDependencies = {}) {
  const fetcher = deps.fetch ?? fetch;
  const secure = config.appOrigin.startsWith("https:");
  const sessionCookieName = secure ? "__Host-shuttlepub_session" : "shuttlepub_session";
  const oauthCookieName = secure ? "__Host-shuttlepub_oauth" : "shuttlepub_oauth";
  const sessionAdapter = scopedSecret(config.cookieSecret, "session").then(cookieSecretBase64 => createSessionAdapter({
    cookieSecretBase64, sessionCookieName, isSecureOrigin: secure,
    hydraPublicUrl: config.hydraPublicUrl, hydraClientId: config.clientId,
    hydraClientSecret: config.clientSecret, refreshSkewSeconds: 60,
  }));
  const oauthKey = scopedSecret(config.cookieSecret, "oauth").then(importCookieKey);
  const jwks = createRemoteJWKSet(new URL(config.hydraPublicUrl + "/.well-known/jwks.json"), { timeoutDuration: 5000 });
  const now = () => Math.floor(Date.now() / 1000);
  const redirectUri = config.appOrigin + "/auth/callback";
  const basic = "Basic " + btoa(encodeURIComponent(config.clientId) + ":" + encodeURIComponent(config.clientSecret));
  const oauthCookie = (value: string, maxAge: number) => buildCookieHeader(secure, oauthCookieName, value, { path: "/", maxAge });
  const clearOAuth = () => oauthCookie("", 0);
  const request = (url: string, init: RequestInit = {}) => fetcher(url, {
    ...init, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });

  async function sealSession(session: ViewerSession): Promise<string> {
    const header = await (await sessionAdapter).sealSessionCookie(session);
    // Browsers silently discard oversized cookies: never report a successful login in that case.
    if (header.length > 4096) throw new AuthError("UPSTREAM_UNAVAILABLE", 502);
    return header;
  }
  async function clearSession(): Promise<string> { return (await sessionAdapter).clearSessionCookie(); }
  async function readSession(req: Request): Promise<ViewerSession | null> {
    if (!uniqueAuthCookie(req.headers.get("cookie"), sessionCookieName)) return null;
    const session = await (await sessionAdapter).getSession(req) as ViewerSession | null;
    if (!session || session.v !== 1 || !session.sub || typeof session.accessToken !== "string" ||
      !session.accessToken || session.tokenType !== "Bearer" || typeof session.scope !== "string" ||
      !Number.isFinite(session.expiresAt) || !Number.isFinite(session.sessionExpiresAt) ||
      session.sessionExpiresAt <= now() ||
      (session.refreshToken !== undefined && typeof session.refreshToken !== "string") ||
      (session.activeProfileId !== undefined && typeof session.activeProfileId !== "string")) return null;
    return session;
  }
  async function accessClaims(token: string, subject?: string) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer, audience: EMUMET_AUDIENCE, algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp"],
    });
    if (typeof payload.sub !== "string" || !payload.sub || (subject !== undefined && payload.sub !== subject)) throw new Error("Invalid subject");
    return payload;
  }
  async function tokenRequest(body: URLSearchParams) {
    const response = await request(config.hydraPublicUrl + "/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic }, body,
    });
    if (!response.ok) throw new AuthError("UNAUTHENTICATED", 401);
    const data = await response.json() as Record<string, unknown>;
    if (typeof data.access_token !== "string" || !data.access_token ||
      typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      typeof data.scope !== "string" ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" || !data.refresh_token))) {
      throw new AuthError("UNAUTHENTICATED", 401);
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token as string | undefined,
      scope: data.scope, expiresIn: data.expires_in, idToken: data.id_token };
  }
  async function resolveSession(req: Request, cookies: string[]): Promise<ViewerSession> {
    const session = await readSession(req);
    if (!session) {
      if (parseCookieValue(req.headers.get("cookie"), sessionCookieName)) cookies.push(await clearSession());
      throw new AuthError("UNAUTHENTICATED", 401);
    }
    try {
      if (session.expiresAt > now() + 60) {
        await accessClaims(session.accessToken, session.sub);
        return session;
      }
      // Same lazy refresh policy as booskiff-web: an active token may survive a refresh outage.
      if (session.refreshToken) {
        try {
          const tokens = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }));
          const claims = await accessClaims(tokens.accessToken, session.sub);
          const refreshed: ViewerSession = { ...session, accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? session.refreshToken, scope: tokens.scope,
            expiresAt: Math.min(claims.exp!, now() + tokens.expiresIn) };
          cookies.push(await sealSession(refreshed));
          return refreshed;
        } catch { /* If still valid, validate and use the old token, never the failed response. */ }
      }
      if (session.expiresAt <= now()) throw new AuthError("UNAUTHENTICATED", 401);
      await accessClaims(session.accessToken, session.sub);
      return session;
    } catch {
      cookies.push(await clearSession());
      throw new AuthError("UNAUTHENTICATED", 401);
    }
  }
  async function start(req: Request): Promise<Response> {
    const pending: Pending = { state: randomBase64Url(32), nonce: randomBase64Url(32),
      codeVerifier: randomBase64Url(32), returnTo: safeAppReturnTo(new URL(req.url).searchParams.get("return_to")),
      expiresAt: now() + OAUTH_TTL };
    const url = new URL(config.hydraPublicUrl + "/oauth2/auth");
    for (const [name, value] of Object.entries({
      response_type: "code", client_id: config.clientId, redirect_uri: redirectUri,
      scope: "openid profile email offline_access", audience: EMUMET_AUDIENCE,
      state: pending.state, nonce: pending.nonce, code_challenge: await pkceChallenge(pending.codeVerifier),
      // Re-check the current Kratos identity, not Hydra's previously remembered subject.
      code_challenge_method: "S256", prompt: "login",
    })) url.searchParams.set(name, value);
    return new Response(null, { status: 302, headers: { Location: url.toString(),
      "Set-Cookie": oauthCookie(await sealWithKey(await oauthKey, pending), OAUTH_TTL) } });
  }
  async function callback(req: Request): Promise<Response> {
    const headers = new Headers();
    let matchedState = false;
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!state || url.searchParams.getAll("state").length !== 1) throw new Error();
      const cookie = uniqueAuthCookie(req.headers.get("cookie"), oauthCookieName);
      const pending = cookie ? await unsealWithKey<Pending>(await oauthKey, cookie) : null;
      if (!pending || pending.state !== state || pending.expiresAt <= now() || !pending.nonce || !pending.codeVerifier) throw new Error();
      matchedState = true;
      headers.append("Set-Cookie", clearOAuth());
      if (url.searchParams.has("error") || !code || url.searchParams.getAll("code").length !== 1) throw new Error();
      const tokens = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code,
        redirect_uri: redirectUri, code_verifier: pending.codeVerifier }));
      if (typeof tokens.idToken !== "string") throw new Error();
      const { payload } = await jwtVerify(tokens.idToken, jwks, {
        issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp", "nonce"],
      });
      if (typeof payload.sub !== "string" || !payload.sub || payload.nonce !== pending.nonce ||
        (payload.azp !== undefined && payload.azp !== config.clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)) throw new Error();
      const claims = await accessClaims(tokens.accessToken, payload.sub);
      const session: ViewerSession = { v: 1, sub: payload.sub, accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}), tokenType: "Bearer", scope: tokens.scope,
        expiresAt: Math.min(claims.exp!, now() + tokens.expiresIn), sessionExpiresAt: now() + SESSION_TTL };
      headers.append("Set-Cookie", await sealSession(session));
      headers.set("Location", safeAppReturnTo(pending.returnTo));
      return new Response(null, { status: 302, headers });
    } catch {
      // An unsolicited GET callback must not provide a cross-site logout primitive.
      if (matchedState) headers.append("Set-Cookie", await clearSession());
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
    }
  }
  async function login(req: Request): Promise<Response> {
    let data: Record<string, unknown>;
    try { data = await req.json(); } catch { return Response.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
    if (!data || typeof data.identifier !== "string" || !data.identifier.trim() || typeof data.password !== "string" || !data.password) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const jar = new CookieJar();
    jar.mergeBrowserCookies(req);
    try {
      const flowResponse = await request(config.kratosPublicUrl + "/self-service/login/browser?refresh=true", {
        headers: { Accept: "application/json", Cookie: jar.toCookieHeader() },
      });
      jar.ingest(flowResponse);
      if (!flowResponse.ok) throw new Error();
      const flow = await flowResponse.json() as { id: string; ui: { nodes: { attributes: { name?: string; value?: string } }[] } };
      const csrf = flow.ui.nodes.find(node => node.attributes.name === "csrf_token")?.attributes.value;
      if (!flow.id || !csrf) throw new Error();
      const response = await request(config.kratosPublicUrl + "/self-service/login?flow=" + encodeURIComponent(flow.id), {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: jar.toCookieHeader() },
        body: JSON.stringify({ method: "password", identifier: data.identifier.trim(), password: data.password, csrf_token: csrf }),
      });
      if (response.status === 400 || response.status === 401) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      if (!response.ok) throw new Error();
      jar.ingest(response);
      const headers = new Headers();
      jar.applyToResponse(headers);
      return Response.json({ next: "/auth/oauth/start" }, { headers });
    } catch { return Response.json({ error: "UPSTREAM_UNAVAILABLE" }, { status: 502 }); }
  }
  async function logout(req: Request): Promise<Response> {
    const headers = new Headers({ "Set-Cookie": await clearSession() });
    headers.append("Set-Cookie", clearOAuth());
    const session = await readSession(req);
    if (session) await Promise.allSettled([session.accessToken, session.refreshToken].filter((v): v is string => !!v).map(token =>
      request(config.hydraPublicUrl + "/oauth2/revoke", { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic }, body: new URLSearchParams({ token }) })));
    try {
      const jar = new CookieJar();
      jar.mergeBrowserCookies(req);
      const response = await request(config.kratosPublicUrl + "/self-service/logout/browser", { headers: { Accept: "application/json", Cookie: jar.toCookieHeader() } });
      if (response.ok) {
        const flow = await response.json() as { logout_token?: string };
        // Never follow a server-supplied logout_url (SSRF); use only the configured Kratos endpoint.
        if (flow.logout_token) {
          const result = await request(config.kratosPublicUrl + "/self-service/logout?token=" + encodeURIComponent(flow.logout_token), { headers: { Cookie: jar.toCookieHeader() } });
          jar.ingest(result);
          jar.applyToResponse(headers);
        }
      }
    } catch { /* Revocation/IdP outage must not prevent local logout. No upstream bodies are logged. */ }
    return new Response(null, { status: 204, headers });
  }
  async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method !== "GET" && req.method !== "POST") return new Response(null, { status: 405 });
    if (req.method === "POST") {
      const rejected = checkOrigin(req, config.appOrigin);
      if (rejected) return rejected;
      if (path === "/auth/login") return login(req);
      if (path === "/auth/logout") return logout(req);
      return new Response(null, { status: 405 });
    }
    if (path === "/auth/login" || path === "/auth/oauth/start") return start(req);
    if (path === "/auth/callback") return callback(req);
    if (path === "/auth/session") {
      const cookies: string[] = [];
      try {
        await resolveSession(req, cookies);
        return withCookies(Response.json({ authenticated: true }), cookies);
      } catch { return withCookies(Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }), [...cookies, await clearSession()]); }
    }
    return new Response(null, { status: path === "/auth/logout" ? 405 : 404 });
  }
  return { config, sessionCookieName, oauthCookieName, resolveSession, sealSession, clearSession,
    handle: async (req: Request) => privateResponse(await handle(req)) };
}

export function withCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

export function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}

export type Auth = ReturnType<typeof createAuth>;
