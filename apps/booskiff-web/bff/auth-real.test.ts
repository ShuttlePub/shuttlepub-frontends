import "./test-setup.ts";
import { afterAll, expect, test } from "bun:test";
import { handleAuthRequest, type RealAuthConfig } from "./routes.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";

// ============================================================
// Kratos ログイン用スタブ
// ============================================================

let credentialsAccepted = true;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/self-service/login/browser" && url.searchParams.get("refresh") === "true") {
      return Response.json({
        id: "flow-1", ui: { nodes: [{ attributes: { name: "csrf_token", value: "csrf-token-1" } }] },
      }, { headers: { "Set-Cookie": "ory_kratos_flow=flow-cookie; Path=/; HttpOnly" } });
    }
    if (req.method === "POST" && url.pathname === "/self-service/login" && url.searchParams.get("flow") === "flow-1") {
      if (!credentialsAccepted) return Response.json({
        ui: { messages: [{ text: "The provided credentials are invalid" }] },
      }, { status: 400 });
      return Response.json({
        session: { identity: { traits: { email: "alice@example.test" } } },
      }, { headers: { "Set-Cookie": "ory_kratos_session=kratos-session-cookie; Path=/; HttpOnly" } });
    }
    return new Response(null, { status: 404 });
  },
});
afterAll(() => server.stop(true));
const config: RealAuthConfig = {
  kind: "real", kratosPublicUrl: server.url.origin, hydraPublicUrl: "http://hydra.test", hydraClientId: "client",
  hydraClientSecret: "secret", hydraRedirectUri: "http://localhost:3000/auth/callback",
  hydraScopes: "openid", hydraAudience: "account", oauthStateTtlSeconds: 300,
};
const adapter = createTestSessionAdapter({
  cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
  isSecureOrigin: false, hydraPublicUrl: "http://hydra.test", hydraClientId: "client", hydraClientSecret: "secret", refreshSkewSeconds: 60,
});

function loginRequest(identifier: string, password: string): Request {
  return new Request("http://localhost:3000/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ identifier, password }),
  });
}

// ============================================================
// real ログインの OAuth ハンドオフ
// ============================================================

test("returns OAuth next URL and Kratos cookies without an app session when login succeeds", async () => {
  // Given: Kratos が credential を受理する。
  credentialsAccepted = true;
  // When: ブラウザが BFF にログインする。
  const response = await handleAuthRequest(loginRequest("alice@example.test", "password"), { adapter, mode: config });
  // Then: OAuth 開始 URL と Kratos cookie のみを返す。
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({
    authenticated: true, username: "alice@example.test", next: "/auth/oauth/start?return_to=/login",
  });
  expect(response?.headers.getSetCookie().some((cookie) => cookie.startsWith("ory_kratos_session="))).toBe(true);
  expect(response?.headers.getSetCookie().some((cookie) => cookie.startsWith("booskiff_session="))).toBe(false);
});

test("returns an error without next when Kratos rejects credentials", async () => {
  // Given: Kratos が credential を拒否する。
  credentialsAccepted = false;
  // When: ブラウザが BFF にログインする。
  const response = await handleAuthRequest(loginRequest("alice@example.test", "wrong-password"), { adapter, mode: config });
  // Then: OAuth に進まず、認証エラーを返す。
  expect(response?.status).toBe(401);
  const body: unknown = await response?.json();
  expect(body).toEqual({ error: "The provided credentials are invalid" });
  expect(body).not.toHaveProperty("next");
});
