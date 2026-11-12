import "./test-setup.ts";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { setOAuthCookie } from "@shuttlepub/auth-bun";
import { handleAuthRequest, type RealAuthConfig } from "./routes.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";

// Kratos スタブ: login flow 作成 / logout 開始で受け取った Cookie ヘッダを記録する。
let flowCookie: string | null = null;
let logoutCookie: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/self-service/login/browser") {
      flowCookie = req.headers.get("cookie");
      return Response.json({ id: "flow-1", ui: { nodes: [] } }, { status: 500 });
    }
    if (url.pathname === "/self-service/logout/browser") {
      logoutCookie = req.headers.get("cookie");
      return Response.json({ logout_url: `${url.origin}/self-service/logout?token=t` });
    }
    if (url.pathname === "/self-service/logout") {
      return new Response(null, { status: 303, headers: { "Set-Cookie": "ory_kratos_session=; Path=/; Max-Age=0" } });
    }
    return new Response(null, { status: 404 });
  },
});
afterAll(() => server.stop(true));
beforeEach(() => {
  flowCookie = null;
  logoutCookie = null;
});

const config: RealAuthConfig = {
  kind: "real", kratosPublicUrl: server.url.origin, hydraPublicUrl: "http://hydra.test", hydraClientId: "client",
  hydraClientSecret: "secret", hydraRedirectUri: "http://localhost:3000/auth/callback",
  hydraScopes: "openid offline_access", hydraAudience: "account", oauthStateTtlSeconds: 300,
};
const adapter = createTestSessionAdapter({
  cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
  isSecureOrigin: false, hydraPublicUrl: "http://hydra.test", hydraClientId: "client", hydraClientSecret: "secret", refreshSkewSeconds: 60,
});
const deps = { adapter, mode: config };

async function oauthCookiePair(state: string): Promise<string> {
  const headers = new Headers();
  await setOAuthCookie(headers, {
    v: 1, state, codeVerifier: "verifier", returnTo: "/drive", expiresAt: Math.floor(Date.now() / 1000) + 300,
  });
  return headers.getSetCookie()[0]!.split(";")[0]!;
}

test("authorization request always asks Hydra to re-authenticate (prompt=login)", async () => {
  // Given: Hydra が前ユーザーの login を remember している構成でも、
  // When: ブラウザが OAuth 開始を要求する。
  const response = await handleAuthRequest(new Request("http://localhost:3000/auth/oauth/start"), deps);
  // Then: 認可 URL は prompt=login を含み、他の PKCE パラメータも維持される。
  expect(response?.status).toBe(302);
  const authorize = new URL(response?.headers.get("location") ?? "");
  expect(authorize.origin + authorize.pathname).toBe("http://hydra.test/oauth2/auth");
  expect(authorize.searchParams.getAll("prompt")).toEqual(["login"]);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("state")).toBeTruthy();
  expect(authorize.searchParams.get("client_id")).toBe("client");
});

test("callback rejects a pending OAuth cookie that is duplicated by an injected cookie", async () => {
  // Given: 正規の state と、同名で注入された別の pending OAuth cookie。
  const legitimate = await oauthCookiePair("legit-state");
  const injected = await oauthCookiePair("attacker-state");
  for (const cookie of [`${legitimate}; ${injected}`, `${injected}; ${legitimate}`]) {
    for (const state of ["legit-state", "attacker-state"]) {
      // When: どちらの state でも callback が到達する。
      const response = await handleAuthRequest(new Request(`http://localhost:3000/auth/callback?code=code&state=${state}`, {
        headers: { cookie },
      }), deps);
      // Then: どちらの cookie も採用されず、token 交換に進まない。
      expect(response?.headers.get("location")).toBe("/login?error=invalid_state");
      expect(response?.headers.getSetCookie().some((value) => value.startsWith("booskiff_session="))).toBe(false);
    }
  }
});

test("login does not forward an ory_kratos cookie that appears twice", async () => {
  // Given: 同名の ory_kratos_csrf_token_x が 2 つ (注入) と、一意な ory_kratos_session。
  const request = new Request("http://localhost:3000/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      cookie: "ory_kratos_csrf_token_x=attacker; ory_kratos_session=s1; booskiff_session=app-secret; ory_kratos_csrf_token_x=victim",
    },
    body: JSON.stringify({ identifier: "alice@example.test", password: "password" }),
  });
  // When: BFF が Kratos の login flow を作る。
  await handleAuthRequest(request, deps);
  // Then: 曖昧な cookie とアプリ cookie は Kratos へ渡らない。
  expect(flowCookie).toBe("ory_kratos_session=s1");
});

test("logout forwards only unambiguous ory_kratos cookies to Kratos and still clears the app session", async () => {
  // Given: 重複した ory_kratos_session (注入) と一意な ory_kratos_csrf_token_x。
  const request = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      cookie: "ory_kratos_session=attacker; ory_kratos_csrf_token_x=c1; booskiff_session=app-secret; ory_kratos_session=victim",
    },
  });
  // When: ログアウトする。
  const response = await handleAuthRequest(request, deps);
  // Then: アプリ cookie と重複 cookie は Kratos に渡らず、アプリの session cookie は失効する。
  expect(response?.status).toBe(200);
  expect(logoutCookie).toBe("ory_kratos_csrf_token_x=c1");
  expect(response?.headers.getSetCookie().some((value) => value.startsWith("booskiff_session=;") && value.includes("Max-Age=0"))).toBe(true);
});
