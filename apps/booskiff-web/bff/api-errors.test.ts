import "./test-setup.ts";
import { afterEach, expect, test } from "bun:test";
import { handleApiRequest } from "./api.ts";
import { createBooskiffClient } from "./booskiff/real.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";
import { stubFetch } from "./test-utils.ts";

const originalFetch = globalThis.fetch;
afterEach(() => Object.assign(globalThis, { fetch: originalFetch }));

test.each(["GET", "POST", "PATCH", "DELETE"])("returns JSON 502 when upstream fetch fails for %s", async (method) => {
  // Given: an authenticated request and an unreachable upstream.
  const adapter = createTestSessionAdapter({
    cookieSecretBase64: TEST_COOKIE_SECRET_BASE64,
    sessionCookieName: "booskiff_session",
    isSecureOrigin: false,
    hydraPublicUrl: "http://hydra.test",
    hydraClientId: "test-client",
    hydraClientSecret: "test-secret",
    refreshSkewSeconds: 60,
  });
  const cookie = await adapter.sealSessionCookie({
    v: 1, sub: "user-1", accessToken: "access", tokenType: "Bearer", scope: "",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  stubFetch(() => { throw new TypeError("fetch failed: private upstream address"); });

  // When: the BFF requests files.
  const path = method === "GET" ? "/api/files" : method === "POST" ? "/api/folders" : "/api/folders/f1";
  const response = await handleApiRequest(new Request(`http://localhost:3000${path}`, {
    method,
    headers: { cookie: cookie.split(";")[0] ?? "", origin: "http://localhost:3000" },
    ...(method === "POST" || method === "PATCH" ? { body: JSON.stringify({ name: "docs" }) } : {}),
  }), { adapter, createClient: (token) => createBooskiffClient({ coreApiUrl: "http://core.test" }, token) });

  // Then: clients receive the public JSON contract, not the transport exception.
  expect(response?.status).toBe(502);
  expect(await response?.json()).toEqual({
    error: { code: "bad_gateway", message: "upstream request failed" },
  });
});
