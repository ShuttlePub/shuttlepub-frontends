import "./test-setup.ts";
import { afterEach, expect, test } from "bun:test";
import { handleApiRequest } from "./api.ts";
import { createBooskiffClient } from "./booskiff/real.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";
import { stubFetch, jsonResponse, jsonBody } from "./test-utils.ts";

const originalFetch = globalThis.fetch;
afterEach(() => Object.assign(globalThis, { fetch: originalFetch }));

const adapter = createTestSessionAdapter({
  cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
  isSecureOrigin: false, hydraPublicUrl: "http://hydra.test", hydraClientId: "test",
  hydraClientSecret: "test", refreshSkewSeconds: 60,
});

async function request(path: string, method = "GET", body?: unknown): Promise<Response> {
  const cookie = await adapter.sealSessionCookie({ v: 1, accessToken: "owner-access", tokenType: "Bearer",
    scope: "", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  const result = await handleApiRequest(new Request(`http://localhost:3000/api/${path}`, {
    method, headers: { cookie: cookie.split(";")[0] ?? "", origin: "http://localhost:3000", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), { adapter, createClient: (token) => createBooskiffClient({ coreApiUrl: "http://core.test" }, token) });
  if (!result) throw new Error("missing API response");
  return result;
}

test.each([
  ["files?root=true", "root", "true"],
  ["folders?root=true", "root", "true"],
  ["folders?parent_id=parent%2F1", "parent_id", "parent/1"],
])("passes hierarchy filter %s with the session owner", async (path, key, value) => {
  const { calls } = stubFetch(() => jsonResponse(200, { items: [] }));
  expect((await request(path)).status).toBe(200);
  expect(new URL(calls[0].url).searchParams.get(key)).toBe(value);
  expect(calls[0].headers.Authorization).toBe("Bearer owner-access");
});

test.each([
  "files?root=true&folder_id=f1", "folders?root=true&parent_id=p1",
  "files?root=bad", "folders?root=", "folders/f1?require_empty=1",
])("rejects invalid hierarchy query before upstream: %s", async (path) => {
  const { calls } = stubFetch(() => { throw new Error("must not call core"); });
  expect((await request(path, path.includes("require_empty") ? "DELETE" : "GET")).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test.each([null, "parent-1"])("creates a folder with parent_id %s and returns parentId", async (parentId) => {
  stubFetch((call) => {
    expect(jsonBody(call)).toEqual({ name: "docs", parent_id: parentId });
    return jsonResponse(201, { id: "f1", name: "docs", parent_id: parentId, created_at: "2026-10-04T00:00:00Z" });
  });
  const response = await request("folders", "POST", { name: "docs", parent_id: parentId });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: "f1", name: "docs", parentId, createdAt: "2026-10-04T00:00:00Z" });
});

test.each([null, [], { name: "docs", parent_id: 123 }, { name: "docs", parent_id: "" }].map((body) => ({ body })))(
  "rejects malformed create body without upstream mutation: %j", async ({ body }) => {
    const { calls } = stubFetch(() => { throw new Error("must not call core"); });
    expect((await request("folders", "POST", body)).status).toBe(400);
    expect(calls).toHaveLength(0);
  },
);

test("safe folder delete forwards require_empty and preserves conflict body", async () => {
  const error = { error: { code: "folder_not_empty", message: "folder contains files" } };
  const { calls } = stubFetch(() => jsonResponse(409, error));
  const response = await request("folders/f1?require_empty=true", "DELETE");
  expect(calls[0].url).toBe("http://core.test/v1/folders/f1?require_empty=true");
  expect(calls[0].method).toBe("DELETE");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual(error);
});

test.each(["folders?parent_id=other-owner", "files?folder_id=other-owner"])(
  "passes through upstream ownership errors: %s", async (path) => {
    const error = { error: { code: "not_found", message: "folder not found" } };
    stubFetch(() => jsonResponse(404, error));
    const response = await request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(error);
  },
);

test("later file page errors return an error without a partial listing", async () => {
  const files = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, name: "a", mime_type: "text/plain",
    size_bytes: 1, folder_id: null, is_public: false, created_at: "2026-10-04T00:00:00Z" }));
  const error = { error: { code: "rate_limited", message: "retry later" } };
  stubFetch((call) => !new URL(call.url).searchParams.has("before_id")
    ? jsonResponse(200, { items: files }) : jsonResponse(429, error));
  const response = await request("files?root=true");
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual(error);
});
