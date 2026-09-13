import "./test-setup.ts";
import { afterEach, expect, test } from "bun:test";
import { handleApiRequest } from "./api.ts";
import { createBooskiffClient } from "./booskiff/real.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";
import { stubFetch, jsonResponse } from "./test-utils.ts";

const originalFetch = globalThis.fetch;
afterEach(() => Object.assign(globalThis, { fetch: originalFetch }));

test.each(["GET", "POST"])("omits empty folder_id upstream for %s", async (method) => {
  const adapter = createTestSessionAdapter({
    cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
    isSecureOrigin: false, hydraPublicUrl: "http://hydra.test", hydraClientId: "test",
    hydraClientSecret: "test", refreshSkewSeconds: 60,
  });
  const cookie = await adapter.sealSessionCookie({ v: 1, accessToken: "access", tokenType: "Bearer",
    scope: "", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  const { calls } = stubFetch(() => method === "GET" ? jsonResponse(200, { items: [] }) : jsonResponse(201, {
    id: "f1", name: "a.txt", mime_type: "text/plain", size_bytes: 1, folder_id: null,
    is_public: false, created_at: "2026-01-01T00:00:00Z",
  }));
  const response = await handleApiRequest(new Request("http://localhost:3000/api/files?folder_id=&name=a.txt", {
    method, headers: { cookie: cookie.split(";")[0] ?? "", origin: "http://localhost:3000", "content-length": "1" },
    ...(method === "POST" ? { body: "a" } : {}),
  }), { adapter, createClient: (token) => createBooskiffClient({ coreApiUrl: "http://core.test" }, token) });
  expect(response?.status).toBe(method === "GET" ? 200 : 201);
  expect(calls).toHaveLength(1);
  expect(calls.every((call) => !new URL(call.url).searchParams.has("folder_id"))).toBe(true);
});
