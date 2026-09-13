import "./test-setup.ts";
import { expect, test } from "bun:test";
import { handleAuthRequest, type AuthDeps } from "./routes.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64, TEST_KEYS } from "./test-setup.ts";

const deps: AuthDeps = {
  adapter: createTestSessionAdapter({
    cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
    isSecureOrigin: false, hydraPublicUrl: "http://hydra.test", hydraClientId: "test",
    hydraClientSecret: "test", refreshSkewSeconds: 60,
  }),
  mode: { kind: "mock", testJwt: { privateKeyPemBase64: TEST_KEYS.privateKeyPemBase64,
    issuer: "http://localhost:3000", ttlSeconds: 3600 } },
};

test.each(["login", "logout"])("rejects GET when auth endpoint requires POST: %s", async (path) => {
  const req = new Request(`http://localhost:3000/auth/${path}`, { headers: { origin: "http://localhost:3000" } });
  const response = await handleAuthRequest(req, deps);
  expect(response?.status).toBe(405);
  expect(response?.headers.get("allow")).toBe("POST");
  expect(response?.headers.getSetCookie()).toEqual([]);
});

test.each(["oauth/start", "callback", "session"])("rejects POST when auth endpoint requires GET: %s", async (path) => {
  const response = await handleAuthRequest(new Request(`http://localhost:3000/auth/${path}`, { method: "POST" }), deps);
  expect(response?.status).toBe(405);
  expect(response?.headers.get("allow")).toBe("GET");
});
