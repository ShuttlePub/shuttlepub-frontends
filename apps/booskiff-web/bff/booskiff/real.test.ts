// ============================================================
// RealBooskiffClient REST 契約テスト — global fetch を stub し、
// 全メソッドの HTTP method/path/query/Authorization と
// snake_case → camelCase 変換を検証する。
// streaming upload は duplex:"half" + ReadableStream body + verbatim
// Content-Length を呼出側で検証する。
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { createBooskiffClient } from "./real.ts";
import { BooskiffApiError, type BooskiffClient, type UploadInput } from "./client.ts";
import { jsonResponse, jsonBody, stubFetch } from "../test-utils.ts";

const CORE = "http://core.test";
const TOKEN = "test-access-token";

function makeClient(): BooskiffClient {
  return createBooskiffClient({ coreApiUrl: CORE }, TOKEN);
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function uploadInput(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    name: "a.txt",
    mime: "text/plain",
    folderId: null,
    contentType: "text/plain",
    contentLength: "3",
    body: streamOf("abc"),
    ...overrides,
  };
}

const wireFile = {
  id: "file_1",
  name: "a.txt",
  mime_type: "text/plain",
  size_bytes: 3,
  folder_id: null,
  is_public: false,
  created_at: "2026-01-01T00:00:00Z",
};
const camelFile = {
  id: "file_1",
  name: "a.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
  folderId: null,
  isPublic: false,
  createdAt: "2026-01-01T00:00:00Z",
};
const wireFolder = { id: "f1", name: "docs", parent_id: null, created_at: "2026-01-01T00:00:00Z" };
const camelFolder = { id: "f1", name: "docs", parentId: null, createdAt: "2026-01-01T00:00:00Z" };

const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

describe("files", () => {
  test("listFiles: GET /v1/files?folder_id= with Bearer, maps to camelCase", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/files?folder_id=f1&limit=200`);
      return jsonResponse(200, { items: [{ ...wireFile, folder_id: "f1" }] });
    });
    const result = await makeClient().listFiles("f1");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual([{ ...camelFile, folderId: "f1" }]);
  });

  test("listFiles without folderId → unfiltered /v1/files", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { items: [wireFile] }));
    const result = await makeClient().listFiles();
    expect(calls[0]?.url).toBe(`${CORE}/v1/files?limit=200`);
    expect(result).toEqual([camelFile]);
  });

  test.each([undefined, "f1"])("listFiles fetches every page with the same filter: %s", async (folderId) => {
    const records = Array.from({ length: 405 }, (_, index) => ({ ...wireFile, id: `file_${index}`, folder_id: folderId ?? null }));
    const { calls } = stubFetch((call) => {
      const query = new URL(call.url).searchParams;
      expect(query.get("limit")).toBe("200");
      expect(query.get("folder_id")).toBe(folderId ?? null);
      expect(query.get("root")).toBe(folderId === undefined ? "true" : null);
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(query.has("offset")).toBe(false);
      const cursorId = query.get("before_id");
      const offset = cursorId === null ? 0 : records.findIndex((record) => record.id === cursorId) + 1;
      expect(query.get("before_created_at")).toBe(cursorId === null ? null : wireFile.created_at);
      return jsonResponse(200, { items: records.slice(offset, offset + 200) });
    });
    const result = await makeClient().listFiles(folderId, folderId === undefined);
    expect(result).toHaveLength(405);
    expect(result[404]?.id).toBe("file_404");
    expect(calls.map((call) => new URL(call.url).searchParams.get("before_id"))).toEqual([null, "file_199", "file_399"]);
  });

  test("listFiles does not skip surviving rows when a previous page's row is deleted", async () => {
    let records = Array.from({ length: 401 }, (_, index) => ({
      ...wireFile, id: `file_${String(401 - index).padStart(3, "0")}`,
      created_at: "2026-10-04T00:00:00.123456Z",
    }));
    stubFetch((call) => {
      const query = new URL(call.url).searchParams;
      expect(query.has("offset")).toBe(false);
      const beforeId = query.get("before_id");
      if (beforeId !== null) expect(query.get("before_created_at")).toBe("2026-10-04T00:00:00.123456Z");
      const page = records.filter((record) => beforeId === null || record.id < beforeId).slice(0, 200);
      if (beforeId === null) records = records.slice(1);
      return jsonResponse(200, { items: page });
    });
    const result = new Set((await makeClient().listFiles(undefined, true)).map((file) => file.id));
    for (const survivor of records) expect(result.has(survivor.id)).toBe(true);
  });

  test("listFiles removes duplicate IDs across pages", async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ ...wireFile, id: `file_${index}` }));
    stubFetch((call) => jsonResponse(200, { items: !new URL(call.url).searchParams.has("before_id")
      ? records : [records[199], { ...wireFile, id: "last" }] }));
    expect(await makeClient().listFiles()).toHaveLength(201);
  });

  test("listFiles rejects an upstream that endlessly repeats a full page", async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ ...wireFile, id: `file_${index}` }));
    const { calls } = stubFetch(() => jsonResponse(200, { items: records }));
    await expect(makeClient().listFiles()).rejects.toThrow("pagination made no progress");
    expect(calls).toHaveLength(2);
  });

  test("listFiles rejects a later page error instead of returning partial results", async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ ...wireFile, id: `file_${index}` }));
    stubFetch((call) => !new URL(call.url).searchParams.has("before_id")
      ? jsonResponse(200, { items: records }) : jsonResponse(403, { error: { code: "forbidden", message: "owner mismatch" } }));
    const error = await makeClient().listFiles("f1").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(BooskiffApiError);
    expect((error as BooskiffApiError).status).toBe(403);
  });

  test("uploadFile: POST /v1/files with stream body, duplex half, verbatim Content-Length, encoded query", async () => {
    const { calls } = stubFetch(() => jsonResponse(201, { ...wireFile, folder_id: "f1" }));
    const input = uploadInput({
      name: "my file.txt",
      mime: "image/png",
      contentType: "image/png",
      folderId: "f/1",
      contentLength: "999",
      body: streamOf("abc"),
    });
    const result = await makeClient().uploadFile(input);

    const call = calls[0];
    expect(call.method).toBe("POST");
    const upstream = new URL(call.url);
    expect(upstream.origin + upstream.pathname).toBe(`${CORE}/v1/files`);
    expect(upstream.searchParams.get("name")).toBe("my file.txt");
    expect(upstream.searchParams.get("mime")).toBe("image/png");
    expect(upstream.searchParams.get("folder_id")).toBe("f/1");
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers["Content-Type"]).toBe("image/png");
    expect(call.headers["Content-Length"]).toBe("999");
    expect(call.duplex).toBe("half");
    expect(call.body).toBeInstanceOf(ReadableStream);
    expect(result).toEqual({ ...camelFile, folderId: "f1" });
  });

  test("uploadFile: null mime/folderId are omitted from the query", async () => {
    const { calls } = stubFetch(() => jsonResponse(201, wireFile));
    await makeClient().uploadFile(uploadInput({ mime: null, folderId: null }));
    expect(calls[0]?.url).toBe(`${CORE}/v1/files?name=a.txt`);
  });

  test("uploadFile: core 413 → BooskiffApiError with status + raw body", async () => {
    stubFetch(() => jsonResponse(413, { error: { code: "file_too_large", message: "too big" } }));
    const err = await makeClient().uploadFile(uploadInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BooskiffApiError);
    const apiErr = err as BooskiffApiError;
    expect(apiErr.status).toBe(413);
    expect(apiErr.body).toBe(JSON.stringify({ error: { code: "file_too_large", message: "too big" } }));
  });

  test("deleteFile: DELETE /v1/files/:id → 204", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("DELETE");
      expect(call.url).toBe(`${CORE}/v1/files/file_1`);
      return new Response(null, { status: 204 });
    });
    await makeClient().deleteFile("file_1");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("deleteFile: core 404 → BooskiffApiError", async () => {
    stubFetch(() => jsonResponse(404, { error: { code: "not_found", message: "no such file" } }));
    await expect(makeClient().deleteFile("missing")).rejects.toBeInstanceOf(BooskiffApiError);
  });

  test("getDownloadUrl: GET /v1/files/:id/download-url → returns url string", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/files/file_1/download-url`);
      return jsonResponse(200, { url: "http://minio:9000/b/k?sig=abc" });
    });
    const url = await makeClient().getDownloadUrl("file_1");
    expect(url).toBe("http://minio:9000/b/k?sig=abc");
    expect(calls).toHaveLength(1);
  });

  test("getDownloadUrl: core 404 → BooskiffApiError", async () => {
    stubFetch(() => jsonResponse(404, { error: { code: "not_found", message: "no such file" } }));
    await expect(makeClient().getDownloadUrl("missing")).rejects.toBeInstanceOf(BooskiffApiError);
  });
});

describe("folders", () => {
  test.each([undefined, "parent/1"])("listFolders passes its root or parent filter: %s", async (parentId) => {
    const { calls } = stubFetch(() => jsonResponse(200, { items: [{ ...wireFolder, parent_id: parentId ?? null }] }));
    expect(await makeClient().listFolders(parentId, parentId === undefined)).toEqual([{ ...camelFolder, parentId: parentId ?? null }]);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("parent_id")).toBe(parentId ?? null);
    expect(query.get("root")).toBe(parentId === undefined ? "true" : null);
  });

  test.each([null, "parent-1"])("createFolder sends an explicit parent: %s", async (parentId) => {
    stubFetch((call) => {
      expect(jsonBody(call)).toEqual({ name: "docs", parent_id: parentId });
      return jsonResponse(201, { ...wireFolder, parent_id: parentId });
    });
    expect((await makeClient().createFolder("docs", parentId)).parentId).toBe(parentId);
  });

  test("deleteFolder passes the safe-delete option and core conflict", async () => {
    const { calls } = stubFetch(() => jsonResponse(409, { error: { code: "folder_not_empty", message: "not empty" } }));
    const error = await makeClient().deleteFolder("f/1", true).catch((err: unknown) => err);
    expect(calls[0].url).toBe(`${CORE}/v1/folders/f%2F1?require_empty=true`);
    expect((error as BooskiffApiError).status).toBe(409);
  });
  test("listFolders: GET /v1/folders → camelCase items", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/folders`);
      return jsonResponse(200, { items: [wireFolder] });
    });
    expect(await makeClient().listFolders()).toEqual([camelFolder]);
  });

  test("getFolder: GET /v1/folders/:id → camelCase", async () => {
    stubFetch((call) => {
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      return jsonResponse(200, wireFolder);
    });
    expect(await makeClient().getFolder("f1")).toEqual(camelFolder);
  });

  test("createFolder: POST /v1/folders {name} → 201 camelCase", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("POST");
      expect(jsonBody(call)).toEqual({ name: "docs" });
      return jsonResponse(201, wireFolder);
    });
    expect(await makeClient().createFolder("docs")).toEqual(camelFolder);
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
  });

  test("createFolder: 409 → BooskiffApiError", async () => {
    stubFetch(() => jsonResponse(409, { error: { code: "folder_already_exists", message: "exists" } }));
    await expect(makeClient().createFolder("docs")).rejects.toBeInstanceOf(BooskiffApiError);
  });

  test("renameFolder: PATCH /v1/folders/:id {name} → 200 camelCase", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("PATCH");
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      expect(jsonBody(call)).toEqual({ name: "renamed" });
      return jsonResponse(200, { ...wireFolder, name: "renamed" });
    });
    expect(await makeClient().renameFolder("f1", "renamed")).toEqual({ ...camelFolder, name: "renamed" });
  });

  test("deleteFolder: DELETE /v1/folders/:id → 204", async () => {
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("DELETE");
      expect(call.url).toBe(`${CORE}/v1/folders/f1`);
      return new Response(null, { status: 204 });
    });
    await makeClient().deleteFolder("f1");
    expect(calls).toHaveLength(1);
  });
});

describe("billing", () => {
  test("billingStatus: GET /v1/billing/status → camelCase mapping", async () => {
    stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${CORE}/v1/billing/status`);
      return jsonResponse(200, { used_bytes: 10, storage_quota_bytes: 100, max_file_bytes: 50, rate_limit_rpm: 60 });
    });
    expect(await makeClient().billingStatus()).toEqual({
      usedBytes: 10,
      storageQuotaBytes: 100,
      maxFileBytes: 50,
      rateLimitRpm: 60,
    });
  });
});
