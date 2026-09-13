// ============================================================
// /api/* ハンドラ統合テスト — handleApiRequest を Bun.serve 無しで直接呼ぶ。
// test-setup.ts が最初の import であること。
// - 未認証ゲート (401 unauthorized, core 未呼出)
// - files list / upload (streaming) / download / delete
// - folders CRUD / billing の snake_case → camelCase マッピング
// - refresh 成功・失敗時の Set-Cookie 伝播
// ============================================================

import "./test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import type { AppSession, SessionAdapterConfig } from "@shuttlepub/auth-bun";
import { handleApiRequest, type ApiDeps } from "./routes.ts";
import { createBooskiffClient } from "./booskiff/real.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";
import { jsonResponse, jsonBody, stubFetch } from "./test-utils.ts";

const CORE = "http://core.test";

const adapterConfig: SessionAdapterConfig = {
  cookieSecretBase64: TEST_COOKIE_SECRET_BASE64,
  sessionCookieName: "booskiff_session",
  isSecureOrigin: false,
  hydraPublicUrl: "http://hydra.test",
  hydraClientId: "test-client",
  hydraClientSecret: "test-secret",
  refreshSkewSeconds: 60,
};

const adapter = createTestSessionAdapter(adapterConfig);

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    adapter,
    createClient: (accessToken) => createBooskiffClient({ coreApiUrl: CORE }, accessToken),
    ...overrides,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    v: 1,
    sub: "user-1",
    accessToken: "core-access-token",
    tokenType: "Bearer",
    scope: "",
    expiresAt: nowSeconds() + 3600,
    ...overrides,
  };
}

async function cookieFor(session: AppSession): Promise<string> {
  const header = await adapter.sealSessionCookie(session);
  return header.split(";")[0];
}

async function api(req: Request, deps: ApiDeps = makeDeps()): Promise<Response> {
  req.headers.set("origin", "http://localhost:3000");
  const res = await handleApiRequest(req, deps);
  if (!res) throw new Error(`not an API path: ${new URL(req.url).pathname}`);
  return res;
}

function findSetCookie(res: Response, prefix: string): string {
  const found = res.headers.getSetCookie().find((c) => c.startsWith(prefix));
  if (!found) {
    throw new Error(`Set-Cookie "${prefix}…" not found in: ${JSON.stringify(res.headers.getSetCookie())}`);
  }
  return found;
}

function uploadRequest(overrides: { query?: string; headers?: Record<string, string>; body?: string } = {}): Request {
  return new Request(`http://localhost:3000/api/files${overrides.query ?? "?name=a.txt&mime=text/plain"}`, {
    method: "POST",
    headers: { cookie: "", "content-type": "text/plain", "content-length": "5", ...overrides.headers },
    body: overrides.body ?? "hello",
  });
}

const wireFile = {
  id: "file_1",
  name: "a.txt",
  mime_type: "text/plain",
  size_bytes: 5,
  folder_id: "f1",
  is_public: false,
  created_at: "2026-01-01T00:00:00Z",
};
const camelFile = {
  id: "file_1",
  name: "a.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  folderId: "f1",
  isPublic: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

describe("authentication gate", () => {
  test("no session → 401 unauthorized for every /api route, core not called", async () => {
    stubFetch(() => {
      throw new Error("core must not be called without a session");
    });
    for (const path of ["/api/files", "/api/folders", "/api/billing/status"]) {
      const res = await api(new Request(`http://localhost:3000${path}`));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "authentication required" } });
    }
  });

  test("non-/api path → null (not handled)", async () => {
    const res = await handleApiRequest(new Request("http://localhost:3000/other"), makeDeps());
    expect(res).toBeNull();
  });
});

describe("GET /api/files", () => {
  test("forwards folder_id, Bearer token, maps snake_case → camelCase", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/files?folder_id=f1`);
      expect(call.headers.Authorization).toBe("Bearer core-access-token");
      return jsonResponse(200, { items: [wireFile] });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files?folder_id=f1", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [camelFile] });
    expect(calls).toHaveLength(1);
  });

  test("no folder_id → no query param; null folder_id maps to null", async () => {
    stubFetch((call) => {
      expect(call.url).toBe(`${CORE}/v1/files`);
      return jsonResponse(200, { items: [{ ...wireFile, folder_id: null }] });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files", { headers: { cookie } }));
    expect(await res.json()).toEqual({ items: [{ ...camelFile, folderId: null }] });
  });
});

describe("POST /api/files (streaming upload)", () => {
  test("streams body to core: duplex half, ReadableStream body, verbatim content-length, encoded query → 201 camelCase", async () => {
    const { calls } = stubFetch(() => jsonResponse(201, wireFile));
    const cookie = await cookieFor(makeSession());
    const req = new Request("http://localhost:3000/api/files?name=a%20b.txt&mime=text%2Fplain&folder_id=f%2F1", {
      method: "POST",
      headers: { cookie, "content-type": "text/plain", "content-length": "5" },
      body: "hello",
    });
    const res = await api(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(camelFile);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("POST");
    const upstream = new URL(call.url);
    expect(upstream.origin + upstream.pathname).toBe(`${CORE}/v1/files`);
    expect(upstream.searchParams.get("name")).toBe("a b.txt");
    expect(upstream.searchParams.get("mime")).toBe("text/plain");
    expect(upstream.searchParams.get("folder_id")).toBe("f/1");
    expect(call.url).toContain("%2F");
    expect(call.headers.Authorization).toBe("Bearer core-access-token");
    expect(call.headers["Content-Type"]).toBe("text/plain");
    expect(call.headers["Content-Length"]).toBe("5");
    expect(call.duplex).toBe("half");
    expect(call.body).toBeInstanceOf(ReadableStream);
  });

  test("missing content-length → 411 length_required, core not called", async () => {
    const { calls } = stubFetch(() => {
      throw new Error("core must not be called without content-length");
    });
    const cookie = await cookieFor(makeSession());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });
    const req = new Request("http://localhost:3000/api/files?name=a.txt", {
      method: "POST",
      headers: { cookie, "content-type": "text/plain" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const res = await api(req);
    expect(res.status).toBe(411);
    expect(await res.json()).toEqual({ error: { code: "length_required", message: "content-length header is required" } });
    expect(calls).toHaveLength(0);
  });

  test("core 413 error body passes through with same status and shape", async () => {
    stubFetch(() => jsonResponse(413, { error: { code: "file_too_large", message: "too big" } }));
    const cookie = await cookieFor(makeSession());
    const res = await api(uploadRequest({ headers: { cookie } }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: "file_too_large", message: "too big" } });
  });

  test("core 507 error body passes through with same status and shape", async () => {
    stubFetch(() => jsonResponse(507, { error: { code: "insufficient_storage", message: "quota" } }));
    const cookie = await cookieFor(makeSession());
    const res = await api(uploadRequest({ headers: { cookie } }));
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ error: { code: "insufficient_storage", message: "quota" } });
  });
});

describe("file download / delete", () => {
  test("GET file detail fetches a folder-contained file directly", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, wireFile));
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files/file_1", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(camelFile);
    expect(calls.map((call) => call.url)).toEqual([`${CORE}/v1/files/file_1`]);
  });

  test("GET /api/files/:id/download → 302 Location to core-provided URL", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/files/file_1/download-url`);
      return jsonResponse(200, { url: "http://minio:9000/b/k?sig=abc" });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files/file_1/download", { headers: { cookie } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://minio:9000/b/k?sig=abc");
    expect(calls).toHaveLength(1);
  });

  test("download when core 404 → 404 core error shape", async () => {
    stubFetch(() => jsonResponse(404, { error: { code: "not_found", message: "no such file" } }));
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files/missing/download", { headers: { cookie } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "no such file" } });
  });

  test("DELETE /api/files/:id → core DELETE → 204 passthrough", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("DELETE");
      expect(call.url).toBe(`${CORE}/v1/files/file_1`);
      return new Response(null, { status: 204 });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/files/file_1", { method: "DELETE", headers: { cookie } }));
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(1);
  });
});

describe("folders CRUD", () => {
  const wireFolder = { id: "f1", name: "docs", created_at: "2026-01-01T00:00:00Z" };
  const camelFolder = { id: "f1", name: "docs", createdAt: "2026-01-01T00:00:00Z" };

  test("GET /api/folders → {items:[camelCase]}", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/folders`);
      return jsonResponse(200, { items: [wireFolder] });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [camelFolder] });
  });

  test("POST /api/folders {name} → core POST {name} → 201 camelCase", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("POST");
      expect(call.url).toBe(`${CORE}/v1/folders`);
      expect(jsonBody(call)).toEqual({ name: "docs" });
      return jsonResponse(201, wireFolder);
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "docs" }),
    }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(camelFolder);
    expect(calls).toHaveLength(1);
  });

  test("POST /api/folders duplicate → 409 passthrough", async () => {
    stubFetch(() => jsonResponse(409, { error: { code: "folder_already_exists", message: "exists" } }));
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "docs" }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "folder_already_exists", message: "exists" } });
  });

  test("GET /api/folders/:id → 200 camelCase", async () => {
    stubFetch((call) => {
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      return jsonResponse(200, wireFolder);
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders/f1", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(camelFolder);
  });

  test("PATCH /api/folders/:id {name} → core PATCH → 200 camelCase", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("PATCH");
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      expect(jsonBody(call)).toEqual({ name: "renamed" });
      return jsonResponse(200, { ...wireFolder, name: "renamed" });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders/f1", {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...camelFolder, name: "renamed" });
  });

  test("DELETE /api/folders/:id → core DELETE → 204", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("DELETE");
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      return new Response(null, { status: 204 });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders/f1", { method: "DELETE", headers: { cookie } }));
    expect(res.status).toBe(204);
  });

  test("POST /api/folders with invalid body → 400, core not called", async () => {
    const { calls } = stubFetch(() => {
      throw new Error("core must not be called for an invalid body");
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/folders", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: "not json",
    }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /api/billing/status", () => {
  test("maps snake_case → camelCase", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/billing/status`);
      return jsonResponse(200, { used_bytes: 10, storage_quota_bytes: 100, max_file_bytes: 50, rate_limit_rpm: 60 });
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/billing/status", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 10, storageQuotaBytes: 100, maxFileBytes: 50, rateLimitRpm: 60 });
  });
});

describe("Set-Cookie propagation on /api responses", () => {
  test("expiring session with refreshToken → refreshed Set-Cookie + new token used", async () => {
    const { calls } = stubFetch((call) => {
      if (call.url === "http://hydra.test/oauth2/token") {
        return jsonResponse(200, {
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
          scope: "",
          token_type: "Bearer",
        });
      }
      return jsonResponse(200, { items: [] });
    });
    const cookie = await cookieFor(makeSession({ refreshToken: "refresh-1", expiresAt: nowSeconds() + 10 }));
    const res = await api(new Request("http://localhost:3000/api/files", { headers: { cookie } }));
    expect(res.status).toBe(200);
    const setCookie = findSetCookie(res, "booskiff_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("Max-Age=0");
    const coreCall = calls.find((c) => c.url.startsWith(CORE));
    expect(coreCall?.headers.Authorization).toBe("Bearer access-2");
  });

  test("refresh failed + expired → 401 unauthorized + clear-cookie Set-Cookie", async () => {
    stubFetch(() => new Response("invalid_grant", { status: 400 }));
    const cookie = await cookieFor(makeSession({ refreshToken: "refresh-1", expiresAt: nowSeconds() - 10 }));
    const res = await api(new Request("http://localhost:3000/api/files", { headers: { cookie } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "authentication required" } });
    const setCookie = findSetCookie(res, "booskiff_session=");
    expect(setCookie).toContain("Max-Age=0");
  });

  test("unknown /api route with session → 404 not_found", async () => {
    stubFetch(() => {
      throw new Error("core must not be called for unknown routes");
    });
    const cookie = await cookieFor(makeSession());
    const res = await api(new Request("http://localhost:3000/api/unknown", { headers: { cookie } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "no such API route: GET /api/unknown" } });
  });
});
