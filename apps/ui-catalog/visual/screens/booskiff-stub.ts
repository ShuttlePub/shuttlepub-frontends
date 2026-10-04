import type { FileItem, Folder } from "../../../booskiff-web/bff/booskiff/client.ts";
import type { DataState } from "./cases.ts";
import { BILLING, FILES, FOLDERS } from "./fixtures.ts";

function wireFile(file: FileItem) {
  return {
    id: file.id, name: file.name, mime_type: file.mimeType, size_bytes: file.sizeBytes,
    folder_id: file.folderId, is_public: file.isPublic, created_at: file.createdAt,
  };
}

function wireFolder(folder: Folder) {
  return { id: folder.id, name: folder.name, parent_id: folder.parentId, created_at: folder.createdAt };
}

/** Test-only HTTP boundary: app SSR, auth, REST mapping and hydration remain real. */
export function startBooskiffStub() {
  let state: DataState = "populated";
  const unexpectedRequests: string[] = [];
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const requestLabel = `${request.method} ${url.pathname}${url.search}`;
      requests.push(requestLabel);
      if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
        unexpectedRequests.push(`Missing bearer token: ${requestLabel}`);
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const files = state === "empty" ? [] : FILES;
      const folders = state === "empty" ? [] : FOLDERS;
      if (request.method === "GET") {
        if (url.pathname === "/v1/files") {
          const folderId = url.searchParams.get("folder_id");
          const root = url.searchParams.get("root") === "true";
          let selected = root ? files.filter((file) => file.folderId === null)
            : folderId === null ? files : files.filter((file) => file.folderId === folderId);
          const beforeAt = url.searchParams.get("before_created_at");
          const beforeId = url.searchParams.get("before_id");
          if (beforeAt !== null && beforeId !== null) selected = selected.filter((file) =>
            file.createdAt < beforeAt || (file.createdAt === beforeAt && file.id < beforeId));
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return Response.json({ items: selected.slice(offset, offset + limit).map(wireFile) });
        }
        if (url.pathname === "/v1/folders") {
          const parentId = url.searchParams.get("parent_id");
          const selected = url.searchParams.get("root") === "true"
            ? folders.filter((folder) => folder.parentId === null)
            : parentId === null ? folders : folders.filter((folder) => folder.parentId === parentId);
          return Response.json({ items: selected.map(wireFolder) });
        }
        if (url.pathname === "/v1/billing/status") return Response.json({
          used_bytes: state === "empty" ? 0 : BILLING.usedBytes,
          storage_quota_bytes: BILLING.storageQuotaBytes,
          max_file_bytes: BILLING.maxFileBytes,
          rate_limit_rpm: BILLING.rateLimitRpm,
        });
        const file = files.find((entry) => url.pathname === `/v1/files/${entry.id}`);
        if (file) return Response.json(wireFile(file));
        const folder = folders.find((entry) => url.pathname === `/v1/folders/${entry.id}`);
        if (folder) return Response.json(wireFolder(folder));
      }
      // Fail closed: a new API dependency or mutation needs an explicit fixture.
      unexpectedRequests.push(requestLabel);
      return Response.json({ error: `Unimplemented visual fixture: ${requestLabel}` }, { status: 501 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    unexpectedRequests,
    setState(next: DataState) { state = next; },
    stop() { server.stop(true); },
  };
}
