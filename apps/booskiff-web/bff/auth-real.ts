// ============================================================
// Real モードの /auth/* フロー (Kratos login + Hydra OAuth2 PKCE)。
// emumet-web/index.ts handleRealAuth と同じワイヤ契約:
// - login: Kratos browser flow (refresh=true) → CSRF node 抽出 →
//   credential POST → ory_kratos_session の Set-Cookie を forward
// - oauth/start: PKCE (S256) + state を暗号化 cookie (PendingOAuth) へ
//   保存し Hydra authorize へ 302
// - callback: state 検証 → token exchange (Basic auth) → AppSession を
//   AES-GCM seal して 302 returnTo
// - logout: Hydra revoke + Kratos logout browser flow の ory_kratos_*
//   Set-Cookie forward (いずれもベストエフォクト)
// ============================================================

import {
  clearCookieHeader,
  CookieJar,
  csrfCheck,
  getOAuthState,
  OAUTH_COOKIE_NAME,
  pkceChallenge,
  randomBase64Url,
  safeReturnTo,
  setOAuthCookie,
  type AppSession,
  type PendingOAuth,
  type SessionAdapter,
} from "@shuttlepub/auth-bun";
import type { RealAuthConfig } from "./routes.ts";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";

type ParsedLogin =
  | { kind: "invalid-json" }
  | { kind: "missing-fields" }
  | { kind: "ok"; identifier: string; password: string };

async function parseLoginBody(req: Request): Promise<ParsedLogin> {
  let data: { identifier?: unknown; password?: unknown };
  try {
    data = await req.json() as { identifier?: unknown; password?: unknown };
  } catch {
    return { kind: "invalid-json" };
  }
  if (typeof data.identifier !== "string" || typeof data.password !== "string" || !data.identifier.trim() || !data.password) {
    return { kind: "missing-fields" };
  }
  return { kind: "ok", identifier: data.identifier.trim(), password: data.password };
}

export async function realLogin(req: Request, config: RealAuthConfig, adapter: SessionAdapter<AppSession>): Promise<Response> {
  const reject = csrfCheck(req);
  if (reject) return reject;

  const parsed = await parseLoginBody(req);
  if (parsed.kind === "invalid-json") return Response.json({ error: "Invalid JSON" }, { status: 400 });
  if (parsed.kind === "missing-fields") return Response.json({ error: "Email and password are required" }, { status: 400 });

  const jar = new CookieJar();
  jar.mergeBrowserCookies(req);

  try {
    // Step 1: login flow 作成 (refresh=true で既存セッションありでも再認証できる)
    const flowResp = await fetch(`${config.kratosPublicUrl}/self-service/login/browser?refresh=true`, {
      headers: { Accept: "application/json", Cookie: jar.toCookieHeader() },
      redirect: "manual",
    });
    jar.ingest(flowResp);
    if (!flowResp.ok) {
      console.error("Kratos flow creation failed:", flowResp.status, await flowResp.text());
      return Response.json({ error: "Authentication service unavailable" }, { status: 502 });
    }

    const flow = await flowResp.json() as {
      id: string;
      ui?: { nodes?: Array<{ attributes?: { name?: string; value?: string } }> };
    };
    const csrfNode = flow.ui?.nodes?.find((node) => node.attributes?.name === "csrf_token");
    const csrfToken = csrfNode?.attributes?.value ?? "";

    // Step 2: credential 送信
    const submitResp = await fetch(`${config.kratosPublicUrl}/self-service/login?flow=${flow.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: jar.toCookieHeader() },
      body: JSON.stringify({
        method: "password",
        identifier: parsed.identifier,
        password: parsed.password,
        csrf_token: csrfToken,
      }),
      redirect: "manual",
    });
    jar.ingest(submitResp);

    if (submitResp.status === 400 || submitResp.status === 401) {
      const errBody = await submitResp.json() as {
        ui?: { messages?: Array<{ text?: string }> };
        error?: { message?: string };
      };
      const kratosMsg = errBody.ui?.messages?.[0]?.text ?? errBody.error?.message ?? "Invalid email or password";
      return Response.json({ error: kratosMsg }, { status: 401 });
    }
    if (!submitResp.ok) {
      console.error("Kratos login submit failed:", submitResp.status, await submitResp.text());
      return Response.json({ error: "Authentication service error" }, { status: 502 });
    }

    // 成功 — Kratos が jar に ory_kratos_session をセットしている
    const sessionResp = await submitResp.json() as {
      session?: { identity?: { traits?: { email?: string } } };
    };
    const email = sessionResp.session?.identity?.traits?.email ?? parsed.identifier;

    const headers = new Headers({ "Content-Type": "application/json" });
    jar.applyToResponse(headers);
    // XHR は 302 で cross-origin Hydra chain を進められないため、トップレベル遷移用 URL を渡す。
    // return_to=/drive: callback 後の /drive フルロードで発生していた resume DOM 破損 (#19) は
    // #21 で修正済みのため、SPA 経路回避策 (return_to=/login) は解除する。
    return new Response(JSON.stringify({ authenticated: true, username: email, next: "/auth/oauth/start?return_to=/drive" }), { status: 200, headers });
  } catch (err) {
    console.error("Kratos login error:", err);
    return Response.json({ error: "Authentication service unavailable" }, { status: 502 });
  }
}

export async function startRealOAuth(req: Request, config: RealAuthConfig): Promise<Response> {
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("return_to"));

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await pkceChallenge(codeVerifier);

  const pendingOAuth: PendingOAuth = {
    v: 1,
    state,
    codeVerifier,
    returnTo,
    expiresAt: Math.floor(Date.now() / 1000) + config.oauthStateTtlSeconds,
  };

  const headers = new Headers();
  await setOAuthCookie(headers, pendingOAuth);

  const authorizeUrl = new URL(`${config.hydraPublicUrl}/oauth2/auth`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.hydraClientId);
  authorizeUrl.searchParams.set("redirect_uri", config.hydraRedirectUri);
  authorizeUrl.searchParams.set("scope", config.hydraScopes);
  authorizeUrl.searchParams.set("audience", config.hydraAudience);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  headers.set("Location", authorizeUrl.toString());
  return new Response(null, { status: 302, headers });
}

function oauthErrorRedirect(error: string): Response {
  const headers = new Headers({ Location: `/login?error=${error}` });
  headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
  return new Response(null, { status: 302, headers });
}

export async function realOAuthCallback(req: Request, config: RealAuthConfig, adapter: SessionAdapter<AppSession>): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("OAuth2 error:", error, url.searchParams.get("error_description"));
    return oauthErrorRedirect(encodeURIComponent(error));
  }
  if (!code || !state) return oauthErrorRedirect("missing_params");

  const pendingOAuth = await getOAuthState(req);
  if (!pendingOAuth || pendingOAuth.state !== state) return oauthErrorRedirect("invalid_state");
  if (pendingOAuth.expiresAt < Math.floor(Date.now() / 1000)) return oauthErrorRedirect("state_expired");

  try {
    const tokenResp = await fetch(`${config.hydraPublicUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${config.hydraClientId}:${config.hydraClientSecret}`),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.hydraRedirectUri,
        code_verifier: pendingOAuth.codeVerifier,
      }),
    });
    if (!tokenResp.ok) {
      console.error("Token exchange failed:", tokenResp.status, await tokenResp.text());
      return oauthErrorRedirect("token_exchange_failed");
    }

    const tokens = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
      token_type: string;
      id_token?: string;
    };

    if (!tokens.id_token) return oauthErrorRedirect("missing_id_token");

    let email: string | undefined;
    let sub: string | undefined;
    if (tokens.id_token) {
      const jwks = createRemoteJWKSet(new URL(`${config.hydraPublicUrl}/.well-known/jwks.json`), { timeoutDuration: 5000 });
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: config.hydraPublicUrl,
        audience: config.hydraClientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp"],
      });
      sub = payload.sub;
      email = typeof payload.email === "string" ? payload.email : undefined;
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

    const headers = new Headers();
    headers.append("Set-Cookie", await adapter.sealSessionCookie(session));
    headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE_NAME));
    headers.set("Location", pendingOAuth.returnTo);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof errors.JOSEError) {
      console.warn("ID token verification failed", { code: err.code });
      return oauthErrorRedirect("invalid_id_token");
    }
    console.error("Token exchange error:", err);
    return oauthErrorRedirect("token_exchange_error");
  }
}

/** ベストエフォクトの revoke / Kratos logout。失敗しても logout 自体は成功させる。 */
export async function revokeAndCollectKratosCookies(
  req: Request,
  config: RealAuthConfig,
  session: AppSession | null,
): Promise<string[]> {
  const kratosSetCookies: string[] = [];

  if (session) {
    try {
      const revoke = async (token: string): Promise<void> => {
        await fetch(`${config.hydraPublicUrl}/oauth2/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(`${config.hydraClientId}:${config.hydraClientSecret}`),
          },
          body: new URLSearchParams({ token }),
        });
      };
      const revocations: Promise<void>[] = [revoke(session.accessToken)];
      if (session.refreshToken) revocations.push(revoke(session.refreshToken));
      await Promise.allSettled(revocations);
    } catch (err) {
      console.warn("Hydra revoke failed (best effort):", err);
    }
  }

  try {
    // ory_kratos_* cookie だけを Kratos へ転送 (CookieJar と同じ許可リスト)
    const filteredCookies = (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.startsWith("ory_kratos"))
      .join("; ");

    const kratosLogoutResp = await fetch(`${config.kratosPublicUrl}/self-service/logout/browser`, {
      headers: { Accept: "application/json", Cookie: filteredCookies },
    });
    if (kratosLogoutResp.ok) {
      const logoutFlow = await kratosLogoutResp.json() as { logout_url?: string };
      if (logoutFlow.logout_url) {
        const logoutResp = await fetch(logoutFlow.logout_url, { redirect: "manual" });
        for (const setCookie of logoutResp.headers.getSetCookie()) {
          const match = setCookie.match(/^([^=]+)=/);
          if (match && match[1].startsWith("ory_kratos")) kratosSetCookies.push(setCookie);
        }
      }
    }
  } catch (err) {
    console.warn("Kratos logout failed (best effort):", err);
  }

  return kratosSetCookies;
}
