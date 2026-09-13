// ============================================================
// BFF ルーティング (純粋ハンドラ) — Bun.serve に依存せず bun test から
// 直接呼べる。index.ts は env 由来の依存を DI して配線するだけ。
// - handleAuthRequest: /auth/* (mock / real は deps.mode で分岐)
//   mock モードも real と同じ AppSession 形状 (accessToken = 実署名
//   テスト JWT, refreshToken 無し) を AES-GCM seal した cookie を使うため
//   /auth/session と /api のセッション解決は 1 本のコードパス。
// - handleApiRequest: /api/* (実装は bff/api.ts)
// ============================================================

import { csrfCheck, safeReturnTo, type AppSession, type SessionAdapter } from "@shuttlepub/auth-bun";
import { realLogin, realOAuthCallback, revokeAndCollectKratosCookies, startRealOAuth } from "./auth-real.ts";
import { signTestJwt, type TestJwtConfig } from "./test-jwt.ts";

export { handleApiRequest, type ApiDeps } from "./api.ts";

export type MockAuthConfig = {
  readonly kind: "mock";
  readonly testJwt: TestJwtConfig;
};

export type RealAuthConfig = {
  readonly kind: "real";
  readonly kratosPublicUrl: string;
  readonly hydraPublicUrl: string;
  readonly hydraClientId: string;
  readonly hydraClientSecret: string;
  readonly hydraRedirectUri: string;
  readonly hydraScopes: string;
  readonly hydraAudience: string;
  readonly oauthStateTtlSeconds: number;
};

export type AuthDeps = {
  readonly adapter: SessionAdapter<AppSession>;
  readonly mode: MockAuthConfig | RealAuthConfig;
};

const MOCK_PASSWORD = "password";

export async function handleAuthRequest(req: Request, deps: AuthDeps): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/auth/")) return null;

  const methods: Readonly<Record<string, string>> = {
    "/auth/login": "POST", "/auth/logout": "POST", "/auth/oauth/start": "GET",
    "/auth/callback": "GET", "/auth/session": "GET",
  };
  const allowed = methods[pathname];
  if (allowed && req.method !== allowed) {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: allowed } });
  }

  switch (pathname) {
    case "/auth/login":
      return deps.mode.kind === "mock"
        ? mockLogin(req, deps.mode.testJwt, deps.adapter)
        : realLogin(req, deps.mode, deps.adapter);
    case "/auth/oauth/start":
      return deps.mode.kind === "mock" ? mockOAuthStart(req) : startRealOAuth(req, deps.mode);
    case "/auth/callback":
      return deps.mode.kind === "mock" ? mockOAuthCallback() : realOAuthCallback(req, deps.mode, deps.adapter);
    case "/auth/session":
      return sessionInfo(req, deps.adapter);
    case "/auth/logout":
      return logout(req, deps);
    default:
      return null;
  }
}

async function mockLogin(req: Request, testJwt: TestJwtConfig, adapter: SessionAdapter<AppSession>): Promise<Response> {
  const reject = csrfCheck(req);
  if (reject) return reject;

  let data: { identifier?: unknown; password?: unknown };
  try {
    data = await req.json() as { identifier?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof data.identifier !== "string" || typeof data.password !== "string" || !data.identifier.trim() || !data.password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }
  const username = data.identifier.trim();
  if (data.password !== MOCK_PASSWORD) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const session: AppSession = {
    v: 1,
    sub: username,
    accessToken: await signTestJwt(testJwt, username, nowSeconds),
    tokenType: "Bearer",
    scope: "",
    expiresAt: nowSeconds + testJwt.ttlSeconds,
  };
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", await adapter.sealSessionCookie(session));
  return new Response(JSON.stringify({ authenticated: true, username }), { status: 200, headers });
}

function mockOAuthStart(req: Request): Response {
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("return_to"));
  return new Response(null, { status: 302, headers: { Location: returnTo } });
}

function mockOAuthCallback(): Response {
  return new Response(null, { status: 302, headers: { Location: "/login" } });
}

function usernameOf(session: AppSession): string {
  return session.email ?? session.sub ?? "unknown";
}

async function sessionInfo(req: Request, adapter: SessionAdapter<AppSession>): Promise<Response> {
  const session = await adapter.getSession(req);
  if (!session) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  const outcome = await adapter.refreshSessionIfNeeded(session);
  switch (outcome.kind) {
    case "fresh":
    case "refresh-failed-active":
      return Response.json({ authenticated: true, username: usernameOf(session) });
    case "refreshed": {
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", outcome.sessionCookieHeader);
      return new Response(JSON.stringify({ authenticated: true, username: usernameOf(session) }), { status: 200, headers });
    }
    case "refresh-failed-expired": {
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", outcome.sessionCookieHeader);
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers });
    }
  }
}

async function logout(req: Request, deps: AuthDeps): Promise<Response> {
  const reject = csrfCheck(req);
  if (reject) return reject;

  const session = await deps.adapter.getSession(req);
  const kratosSetCookies = deps.mode.kind === "real"
    ? await revokeAndCollectKratosCookies(req, deps.mode, session)
    : [];

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", deps.adapter.clearSessionCookie());
  for (const setCookie of kratosSetCookies) {
    headers.append("Set-Cookie", setCookie);
  }
  return new Response(JSON.stringify({ loggedOut: true }), { status: 200, headers });
}
