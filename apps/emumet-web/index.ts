import { renderPage } from "./dist/server.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  clearCookieHeader,
  CookieJar,
  createConsentHandler,
  createMockSessionAdapter,
  createSessionAdapter,
  csrfCheck,
  encodeMockCookie,
  getCookieValue,
  getMockSession,
  getOAuthState,
  getRealSession,
  isSessionExpiringSoon,
  pkceChallenge,
  randomBase64Url,
  refreshAccessToken,
  safeReturnTo,
  sealCookie,
  setCookieHeader,
  setOAuthCookie,
  setRealSessionCookie,
  unsealCookie,
  type AppSession,
  type MockSession,
  type SessionAdapter,
} from "@shuttlepub/auth-bun";
import { createYogaHandler } from "./bff/server.ts";
import { createMockEmumetClient } from "./bff/emumet/mock.ts";
import { REGISTRATION_GATE_SCENARIOS, isRegistrationGateScenario } from "./bff/emumet/registration-gate-scenarios.ts";
import { createRealEmumetClient } from "./bff/emumet/real.ts";
import { isAdminPath, loadAdminSsrState } from "./bff/admin-ssr.ts";

// ============================================================
// Configuration
// ============================================================

const USE_MOCK = process.env.USE_MOCK !== "false"; // default: mock mode
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";

// External service URLs (real mode only)
const KRATOS_PUBLIC_URL = process.env.KRATOS_PUBLIC_URL || "http://localhost:4433";
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL || "http://localhost:4444";
const EMUMET_API_URL = process.env.EMUMET_API_URL || "http://localhost:8080";

// Hydra OAuth2 client config
const HYDRA_CLIENT_ID = process.env.HYDRA_CLIENT_ID || "ratcap-bff";
const HYDRA_CLIENT_SECRET = process.env.HYDRA_CLIENT_SECRET || "dev-secret";
const HYDRA_REDIRECT_URI = process.env.HYDRA_REDIRECT_URI || `${APP_ORIGIN}/auth/callback`;
const HYDRA_SCOPES = process.env.HYDRA_SCOPES || "openid offline_access email";
const HYDRA_AUDIENCE = process.env.HYDRA_AUDIENCE || "account";

// Cookie config
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ratcap_session";
const OAUTH_COOKIE_NAME = process.env.OAUTH_COOKIE_NAME || "ratcap_oauth";
const COOKIE_SECRET_BASE64 = process.env.COOKIE_SECRET_BASE64; // 32-byte key, base64-encoded

// Timing config
const OAUTH_STATE_TTL_SECONDS = Number(process.env.OAUTH_STATE_TTL_SECONDS) || 300; // 5 min
const SESSION_REFRESH_SKEW_SECONDS = Number(process.env.SESSION_REFRESH_SKEW_SECONDS) || 60; // 1 min

// Derived config
const IS_SECURE_ORIGIN = APP_ORIGIN.startsWith("https://");

// ============================================================
// Cookie helpers (mock: base64 JSON, real: AES-GCM)
// ============================================================

function setMockSessionCookie(headers: Headers, data: MockSession): void {
  headers.append("Set-Cookie", setCookieHeader(SESSION_COOKIE_NAME, encodeMockCookie(data)));
}
function clearMockSessionCookie(headers: Headers): void {
  headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE_NAME));
}

// ============================================================
// Static files
// ============================================================

const staticFiles: Record<string, { path: string; contentType: string }> = {
  "/app.js": { path: "dist/app.js", contentType: "application/javascript" },
  "/style.css": { path: "dist/style.css", contentType: "text/css" },
  "/theme.js": { path: "node_modules/@shuttlepub/design-tokens/theme.js", contentType: "application/javascript" },
};

function serveStatic(pathname: string): Response | null {
  const entry = staticFiles[pathname];
  if (!entry) return null;
  return new Response(Bun.file(entry.path), {
    headers: { "Content-Type": entry.contentType },
  });
}

// ============================================================
// Mock Auth handlers (BFF /auth/* endpoints)
// ============================================================

const MOCK_PASSWORD = "password";

async function handleMockAuth(req: Request, pathname: string): Promise<Response | null> {
  const method = req.method;

  // POST /auth/login — mock Kratos login
  if (method === "POST" && pathname === "/auth/login") {
    const csrfReject = csrfCheck(req);
    if (csrfReject) return csrfReject;

    let data: { identifier: unknown; password: unknown };
    try {
      data = await req.json() as { identifier: unknown; password: unknown };
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (typeof data.identifier !== "string" || typeof data.password !== "string" || !data.identifier.trim() || !data.password) {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (data.password !== MOCK_PASSWORD) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const username = data.identifier.trim();
    const token = "mock-bearer-token-" + username;
    const headers = new Headers({ "Content-Type": "application/json" });
    setMockSessionCookie(headers, { token, username });
    return new Response(JSON.stringify({ authenticated: true, username }), { status: 200, headers });
  }

  // GET /auth/oauth/start — mock: no-op redirect to return_to (session cookie already set by /auth/login)
  if (method === "GET" && pathname === "/auth/oauth/start") {
    const url = new URL(req.url);
    return new Response(null, {
      status: 302,
      headers: { Location: safeReturnTo(url.searchParams.get("return_to")) },
    });
  }

  // GET /auth/session — check session cookie, return session info
  if (method === "GET" && pathname === "/auth/session") {
    const session = getMockSession(req);
    if (session) {
      return Response.json({ authenticated: true, username: session.username });
    }
    return Response.json({ authenticated: false }, { status: 401 });
  }

  // POST /auth/logout — clear session cookie
  if (method === "POST" && pathname === "/auth/logout") {
    const csrfReject = csrfCheck(req);
    if (csrfReject) return csrfReject;

    const headers = new Headers({ "Content-Type": "application/json" });
    clearMockSessionCookie(headers);
    return new Response(JSON.stringify({ loggedOut: true }), { status: 200, headers });
  }

  return null;
}

// ============================================================
// Real Auth handlers (BFF /auth/* endpoints, Kratos + Hydra)
// ============================================================

async function handleRealAuth(req: Request, pathname: string): Promise<Response | null> {
  const method = req.method;

  // POST /auth/login — Kratos Browser Flow proxy (2-step)
  if (method === "POST" && pathname === "/auth/login") {
    const csrfReject = csrfCheck(req);
    if (csrfReject) return csrfReject;

    let data: { identifier: unknown; password: unknown };
    try {
      data = await req.json() as { identifier: unknown; password: unknown };
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (typeof data.identifier !== "string" || typeof data.password !== "string" || !data.identifier.trim() || !data.password) {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }

    const jar = new CookieJar();
    jar.mergeBrowserCookies(req);

    try {
      // Step 1: Create login flow (refresh=true allows re-auth when session already exists)
      const flowResp = await fetch(`${KRATOS_PUBLIC_URL}/self-service/login/browser?refresh=true`, {
        headers: { "Accept": "application/json", "Cookie": jar.toCookieHeader() },
        redirect: "manual",
      });
      jar.ingest(flowResp);

      if (!flowResp.ok) {
        console.error("Kratos flow creation failed:", flowResp.status, await flowResp.text());
        return Response.json({ error: "Authentication service unavailable" }, { status: 502 });
      }

      const flow = await flowResp.json() as {
        id: string;
        ui?: { nodes?: Array<{ attributes?: { name?: string; value?: string }; type?: string }> };
      };

      // Extract CSRF token from flow UI nodes
      const csrfNode = flow.ui?.nodes?.find(
        (n: { attributes?: { name?: string } }) => n.attributes?.name === "csrf_token"
      );
      const csrfToken = csrfNode?.attributes?.value || "";

      // Step 2: Submit credentials
      const submitResp = await fetch(`${KRATOS_PUBLIC_URL}/self-service/login?flow=${flow.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Cookie": jar.toCookieHeader(),
        },
        body: JSON.stringify({
          method: "password",
          identifier: data.identifier.trim(),
          password: data.password,
          csrf_token: csrfToken,
        }),
        redirect: "manual",
      });
      jar.ingest(submitResp);

      // Handle Kratos errors (400 = validation, 401 = bad creds)
      if (submitResp.status === 400 || submitResp.status === 401) {
        const errBody = await submitResp.json() as {
          ui?: { messages?: Array<{ text?: string }> };
          error?: { message?: string };
        };
        // Extract user-facing error message from Kratos UI messages
        const kratosMsg = errBody.ui?.messages?.[0]?.text
          || errBody.error?.message
          || "Invalid email or password";
        return Response.json({ error: kratosMsg }, { status: 401 });
      }

      if (!submitResp.ok && submitResp.status !== 200) {
        console.error("Kratos login submit failed:", submitResp.status, await submitResp.text());
        return Response.json({ error: "Authentication service error" }, { status: 502 });
      }

      // Login succeeded — Kratos has set ory_kratos_session cookie in the jar
      const sessionResp = await submitResp.json() as {
        session?: { identity?: { traits?: { email?: string }; id?: string } };
      };
      const email = sessionResp.session?.identity?.traits?.email || data.identifier.trim();

      // Forward Kratos Set-Cookie headers to browser (especially ory_kratos_session)
      const responseHeaders = new Headers({ "Content-Type": "application/json" });
      jar.applyToResponse(responseHeaders);

      return new Response(JSON.stringify({ authenticated: true, username: email }), {
        status: 200,
        headers: responseHeaders,
      });
    } catch (err) {
      console.error("Kratos login error:", err);
      return Response.json({ error: "Authentication service unavailable" }, { status: 502 });
    }
  }

  // GET /auth/oauth/start — PKCE + state → redirect to Hydra authorize
  if (method === "GET" && pathname === "/auth/oauth/start") {
    const url = new URL(req.url);
    const returnTo = safeReturnTo(url.searchParams.get("return_to"));

    const state = randomBase64Url(32);
    const codeVerifier = randomBase64Url(32);
    const codeChallenge = await pkceChallenge(codeVerifier);

    // Store PKCE state in encrypted cookie
    const pendingOAuth = {
      v: 1 as const,
      state,
      codeVerifier,
      returnTo,
      expiresAt: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    };

    const headers = new Headers();
    await setOAuthCookie(headers, pendingOAuth);

    // Build Hydra authorize URL
    const authorizeUrl = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", HYDRA_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", HYDRA_REDIRECT_URI);
    authorizeUrl.searchParams.set("scope", HYDRA_SCOPES);
    authorizeUrl.searchParams.set("audience", HYDRA_AUDIENCE);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    headers.set("Location", authorizeUrl.toString());
    return new Response(null, { status: 302, headers });
  }

  // GET /auth/callback — exchange code for tokens, issue session cookie
  if (method === "GET" && pathname === "/auth/callback") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Hydra error redirect
    if (error) {
      console.error("OAuth2 error:", error, url.searchParams.get("error_description"));
      const headers = new Headers({ Location: `/login?error=${encodeURIComponent(error)}` });
      headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      return new Response(null, { status: 302, headers });
    }

    if (!code || !state) {
      const headers = new Headers({ Location: "/login?error=missing_params" });
      headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      return new Response(null, { status: 302, headers });
    }

    // Validate state from encrypted cookie
    const pendingOAuth = await getOAuthState(req);
    if (!pendingOAuth || pendingOAuth.state !== state) {
      const headers = new Headers({ Location: "/login?error=invalid_state" });
      headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      return new Response(null, { status: 302, headers });
    }

    // Check TTL
    if (pendingOAuth.expiresAt < Math.floor(Date.now() / 1000)) {
      const headers = new Headers({ Location: "/login?error=state_expired" });
      headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      return new Response(null, { status: 302, headers });
    }

    // Exchange code for tokens
    try {
      const tokenResp = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(`${HYDRA_CLIENT_ID}:${HYDRA_CLIENT_SECRET}`),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: HYDRA_REDIRECT_URI,
          code_verifier: pendingOAuth.codeVerifier,
        }),
      });

      if (!tokenResp.ok) {
        console.error("Token exchange failed:", tokenResp.status, await tokenResp.text());
        const errHeaders = new Headers({ Location: "/login?error=token_exchange_failed" });
        errHeaders.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
        return new Response(null, { status: 302, headers: errHeaders });
      }

      const tokens = await tokenResp.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
        token_type: string;
        id_token?: string;
      };

      // Decode id_token for user info (JWT payload, no verification needed — we just got it from Hydra)
      let email: string | undefined;
      let sub: string | undefined;
      if (tokens.id_token) {
        try {
          const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(tokens.id_token.split(".")[1]!))) as { sub?: string; email?: string };
          sub = payload.sub;
          email = payload.email;
        } catch { /* ignore malformed id_token */ }
      }

      const session: AppSession = {
        v: 1,
        sub,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: "Bearer",
        scope: tokens.scope,
        expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      };

      console.log("OAuth callback: token exchange success, setting session cookie. sub:", sub, "email:", email, "expiresAt:", session.expiresAt);

      const headers = new Headers();
      await setRealSessionCookie(headers, session);
      // Clear OAuth state cookie
      headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      headers.set("Location", pendingOAuth.returnTo);
      return new Response(null, { status: 302, headers });
    } catch (err) {
      console.error("Token exchange error:", err);
      const errHeaders = new Headers({ Location: "/login?error=token_exchange_error" });
      errHeaders.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
      return new Response(null, { status: 302, headers: errHeaders });
    }
  }

  // GET /auth/session — check session cookie, return session info (+ lazy refresh)
  if (method === "GET" && pathname === "/auth/session") {
    const session = await getRealSession(req);
    if (!session) {
      const rawCookie = getCookieValue(req, SESSION_COOKIE_NAME);
      console.log("GET /auth/session: no valid session. Raw cookie present:", !!rawCookie, rawCookie ? `(length: ${rawCookie.length})` : "");
      return Response.json({ authenticated: false }, { status: 401 });
    }

    // Lazy refresh if expiring soon
    if (isSessionExpiringSoon(session)) {
      const refreshed = await refreshAccessToken(session);
      if (refreshed) {
        const headers = new Headers({ "Content-Type": "application/json" });
        await setRealSessionCookie(headers, refreshed);
        return new Response(
          JSON.stringify({ authenticated: true, username: refreshed.email || refreshed.sub || "unknown" }),
          { status: 200, headers }
        );
      }
      // Refresh failed but token not yet expired — serve stale
      if (session.expiresAt > Math.floor(Date.now() / 1000)) {
        return Response.json({ authenticated: true, username: session.email || session.sub || "unknown" });
      }
      // Expired and no refresh — force re-login
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE_NAME));
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers });
    }

    return Response.json({ authenticated: true, username: session.email || session.sub || "unknown" });
  }

  // POST /auth/logout — clear session cookie + best-effort Hydra token revoke
  if (method === "POST" && pathname === "/auth/logout") {
    const csrfReject = csrfCheck(req);
    if (csrfReject) return csrfReject;

    const session = await getRealSession(req);

    // Best-effort token revocation (access token + refresh token)
    if (session) {
      const revokeToken = async (token: string) => {
        await fetch(`${HYDRA_PUBLIC_URL}/oauth2/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${HYDRA_CLIENT_ID}:${HYDRA_CLIENT_SECRET}`),
          },
          body: new URLSearchParams({ token }),
        });
      };
      try {
        const revocations: Promise<void>[] = [];
        if (session.accessToken) revocations.push(revokeToken(session.accessToken));
        if (session.refreshToken) revocations.push(revokeToken(session.refreshToken));
        await Promise.allSettled(revocations);
      } catch { /* best effort */ }
    }

    // Best-effort Kratos logout — forward Set-Cookie to clear ory_kratos_session
    // Only forward ory_kratos_* cookies to Kratos (same allowlist as CookieJar)
    const kratosSetCookies: string[] = [];
    try {
      const browserCookies = req.headers.get("cookie") || "";
      const filteredCookies = browserCookies
        .split(";")
        .map(c => c.trim())
        .filter(c => c.startsWith("ory_kratos"))
        .join("; ");

      const kratosLogoutResp = await fetch(`${KRATOS_PUBLIC_URL}/self-service/logout/browser`, {
        headers: {
          "Accept": "application/json",
          "Cookie": filteredCookies,
        },
      });
      if (kratosLogoutResp.ok) {
        const logoutFlow = await kratosLogoutResp.json() as { logout_url?: string };
        if (logoutFlow.logout_url) {
          // Hit the logout URL server-side to destroy Kratos session
          const logoutResp = await fetch(logoutFlow.logout_url, { redirect: "manual" });
          // Collect Set-Cookie headers from Kratos logout (to clear ory_kratos_session on browser)
          for (const sc of logoutResp.headers.getSetCookie()) {
            const match = sc.match(/^([^=]+)=/);
            if (match && match[1]!.startsWith("ory_kratos")) {
              kratosSetCookies.push(sc);
            }
          }
        }
      }
    } catch { /* best effort */ }

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE_NAME));
    for (const sc of kratosSetCookies) {
      headers.append("Set-Cookie", sc);
    }
    return new Response(JSON.stringify({ loggedOut: true }), { status: 200, headers });
  }

  return null;
}

// ============================================================
// SSR
// ============================================================

// 管理画面だけは、強制開放中の警告帯を SSR 直後から出すため、呼び出し者と登録ゲートの状態を初期 Model に渡す
// (bff/admin-ssr.ts)。取得できないときは空文字を渡し、従来どおりクライアントで取得させる
async function adminSsrState(req: Request, url: URL): Promise<string> {
  if (!isAdminPath(url.pathname)) return "";
  let username: string;
  let accessToken: string;
  if (USE_MOCK) {
    const session = getMockSession(req);
    if (!session) return "";
    username = session.username;
    accessToken = session.token;
  } else {
    const session = await getRealSession(req);
    if (!session || session.expiresAt <= Math.floor(Date.now() / 1000)) return "";
    username = session.email || session.sub || "unknown";
    accessToken = session.accessToken;
  }
  const client = sharedMockEmumetClient ?? createRealEmumetClient({ baseUrl: EMUMET_API_URL }, accessToken);
  const state = await loadAdminSsrState(client, username);
  return state === null ? "" : JSON.stringify(state);
}

async function serveSSR(req: Request, url: URL): Promise<Response> {
  const html = renderPage(url.pathname + url.search)(await adminSsrState(req, url))();
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ============================================================
// Server
// ============================================================

// ============================================================
// Startup validation
// ============================================================

if (!USE_MOCK) {
  // Validate required env vars for real mode
  const required: [string, string | undefined][] = [
    ["COOKIE_SECRET_BASE64", COOKIE_SECRET_BASE64],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Real mode requires these environment variables: ${missing.join(", ")}`);
  }
  // Validate COOKIE_SECRET_BASE64 decodes to 32 bytes
  try {
    const raw = Uint8Array.from(atob(COOKIE_SECRET_BASE64!), c => c.charCodeAt(0));
    if (raw.length !== 32) throw new Error("not 32 bytes");
  } catch (err) {
    throw new Error(`COOKIE_SECRET_BASE64 must be a valid base64 string that decodes to exactly 32 bytes: ${err}`);
  }
}

// GraphQL BFF (bff/): SessionAdapter は USE_MOCK に応じて切替。
// Mock: base64 MockSession を解決 + プロセス共有の MockEmumetClient (token 無視)。
// Real: AES-GCM AppSession + Hydra refresh + token から RealEmumetClient を生成。
const sessionAdapter: SessionAdapter<{ accessToken: string }> = USE_MOCK
  ? createMockSessionAdapter(SESSION_COOKIE_NAME, IS_SECURE_ORIGIN)
  : createSessionAdapter({
      cookieSecretBase64: COOKIE_SECRET_BASE64!,
      sessionCookieName: SESSION_COOKIE_NAME,
      isSecureOrigin: IS_SECURE_ORIGIN,
      hydraPublicUrl: HYDRA_PUBLIC_URL,
      hydraClientId: HYDRA_CLIENT_ID,
      hydraClientSecret: HYDRA_CLIENT_SECRET,
      refreshSkewSeconds: SESSION_REFRESH_SKEW_SECONDS,
    });
const sharedMockEmumetClient = USE_MOCK ? createMockEmumetClient() : null;
const yogaHandler = createYogaHandler(
  sessionAdapter,
  sharedMockEmumetClient
    ? () => sharedMockEmumetClient
    : (token) => createRealEmumetClient({ baseUrl: EMUMET_API_URL }, token),
);
const consentHandler = createConsentHandler({ emumetApiUrl: EMUMET_API_URL, appOrigin: APP_ORIGIN });

Bun.serve({
  async fetch(req) {
    const url = new URL(req.url);

    const staticResponse = serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    // GraphQL BFF endpoint
    if (url.pathname === "/graphql") return yogaHandler(req);

    // Mock 専用: 登録ゲート管理画面のシナリオ切替 (開発・frontend visual の撮影用)。real モードには存在しない
    if (sharedMockEmumetClient && url.pathname === "/__mock/registration-gate/scenario" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name : "";
      if (!isRegistrationGateScenario(name)) return new Response("unknown scenario", { status: 400 });
      sharedMockEmumetClient.registrationGateControl.reset(REGISTRATION_GATE_SCENARIOS[name]);
      return new Response(null, { status: 204 });
    }

    // Auth endpoints (BFF)
    if (url.pathname.startsWith("/auth/")) {
      const authHandler = USE_MOCK ? handleMockAuth : handleRealAuth;
      const authResponse = await authHandler(req, url.pathname);
      if (authResponse) return authResponse;
    }

    if (!USE_MOCK && url.pathname === "/oauth2/consent") {
      return consentHandler(req);
    }

    return serveSSR(req, url);
  },
});

console.log(`Server running at http://localhost:3000 (${USE_MOCK ? "MOCK" : "REAL: Kratos=" + KRATOS_PUBLIC_URL + " Hydra=" + HYDRA_PUBLIC_URL + " Emumet=" + EMUMET_API_URL})`);
