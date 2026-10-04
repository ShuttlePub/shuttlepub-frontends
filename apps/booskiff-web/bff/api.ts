// ============================================================
// /api/* ルーティング — Bun.serve に依存しない純粋ハンドラ。
// セッション解決 → adapter.refreshSessionIfNeeded → BooskiffClient へ委譲。
// refreshed / refresh-failed-expired の Set-Cookie は全 /api レスポンスへ
// 伝播する。core のエラー (BooskiffApiError) は status + ボディ原文を
// そのままパススルーする。
// ============================================================

import { csrfCheck, type SessionAdapter } from "@shuttlepub/auth-bun";
import { BooskiffApiError, type BooskiffClient } from "./booskiff/client.ts";

export type ApiDeps = {
  readonly adapter: SessionAdapter;
  readonly createClient: (accessToken: string) => BooskiffClient;
};

function withCookie(headers: Headers, setCookie: string | null): Headers {
  if (setCookie !== null) headers.append("Set-Cookie", setCookie);
  return headers;
}

function jsonError(status: number, code: string, message: string, setCookie: string | null): Response {
  const headers = withCookie(new Headers({ "Content-Type": "application/json" }), setCookie);
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}

function jsonResponse(body: unknown, setCookie: string | null, status = 200): Response {
  const headers = withCookie(new Headers({ "Content-Type": "application/json" }), setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(status: number, setCookie: string | null): Response {
  return new Response(null, { status, headers: withCookie(new Headers(), setCookie) });
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
}

export async function handleApiRequest(req: Request, deps: ApiDeps): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/api/")) return null;

  const session = await deps.adapter.getSession(req);
  if (!session) return jsonError(401, "unauthorized", "authentication required", null);

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const reject = csrfCheck(req);
    if (reject) return jsonError(403, "forbidden", "CSRF check failed", null);
  }

  const outcome = await deps.adapter.refreshSessionIfNeeded(session);
  if (outcome.kind === "refresh-failed-expired") {
    return jsonError(401, "unauthorized", "authentication required", outcome.sessionCookieHeader);
  }
  const refreshedCookie = outcome.kind === "refreshed" ? outcome.sessionCookieHeader : null;

  const client = deps.createClient(outcome.accessToken);
  try {
    return await dispatch(req, pathname, client, refreshedCookie);
  } catch (err) {
    if (err instanceof BooskiffApiError) {
      const headers = withCookie(new Headers({ "Content-Type": "application/json" }), refreshedCookie);
      return new Response(err.body, { status: err.status, headers });
    }
    return jsonError(502, "bad_gateway", "upstream request failed", refreshedCookie);
  }
}

async function dispatch(req: Request, pathname: string, client: BooskiffClient, setCookie: string | null): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;

  if (pathname === "/api/files") {
    if (method === "GET") {
      const folderId = url.searchParams.get("folder_id") || undefined;
      const root = booleanQuery(url, "root");
      if (root === null || (root && folderId !== undefined)) {
        return jsonError(400, "bad_request", "root must be a boolean and cannot be true with folder_id", setCookie);
      }
      return jsonResponse({ items: await client.listFiles(folderId, root) }, setCookie);
    }
    if (method === "POST") return upload(req, url, client, setCookie);
  }

  const downloadMatch = /^\/api\/files\/([^/]+)\/download$/.exec(pathname);
  if (downloadMatch && method === "GET") {
    const location = await client.getDownloadUrl(decodeURIComponent(downloadMatch[1]));
    return new Response(null, { status: 302, headers: withCookie(new Headers({ Location: location }), setCookie) });
  }

  const fileMatch = /^\/api\/files\/([^/]+)$/.exec(pathname);
  if (fileMatch && method === "GET") {
    return jsonResponse(await client.getFile(decodeURIComponent(fileMatch[1])), setCookie);
  }
  if (fileMatch && method === "DELETE") {
    await client.deleteFile(decodeURIComponent(fileMatch[1]));
    return emptyResponse(204, setCookie);
  }

  if (pathname === "/api/folders") {
    if (method === "GET") {
      const parentId = url.searchParams.get("parent_id") || undefined;
      const root = booleanQuery(url, "root");
      if (root === null || (root && parentId !== undefined)) {
        return jsonError(400, "bad_request", "root must be a boolean and cannot be true with parent_id", setCookie);
      }
      return jsonResponse({ items: await client.listFolders(parentId, root) }, setCookie);
    }
    if (method === "POST") {
      const body = await readFolderBody(req);
      if (body === null) return jsonError(400, "bad_request", `JSON body with non-empty "name" and optional "parent_id" is required`, setCookie);
      return jsonResponse(await client.createFolder(body.name, body.parentId), setCookie, 201);
    }
  }

  const folderMatch = /^\/api\/folders\/([^/]+)$/.exec(pathname);
  if (folderMatch) {
    const id = decodeURIComponent(folderMatch[1]);
    if (method === "GET") return jsonResponse(await client.getFolder(id), setCookie);
    if (method === "PATCH") {
      const name = await readName(req);
      if (name === null) return jsonError(400, "bad_request", `JSON body with non-empty "name" is required`, setCookie);
      return jsonResponse(await client.renameFolder(id, name), setCookie);
    }
    if (method === "DELETE") {
      const requireEmpty = booleanQuery(url, "require_empty");
      if (requireEmpty === null) return jsonError(400, "bad_request", "require_empty must be a boolean", setCookie);
      await client.deleteFolder(id, requireEmpty);
      return emptyResponse(204, setCookie);
    }
  }

  if (pathname === "/api/billing/status" && method === "GET") {
    return jsonResponse(await client.billingStatus(), setCookie);
  }

  return jsonError(404, "not_found", `no such API route: ${method} ${pathname}`, setCookie);
}

async function upload(req: Request, url: URL, client: BooskiffClient, setCookie: string | null): Promise<Response> {
  const contentLength = req.headers.get("content-length");
  if (contentLength === null) {
    return jsonError(411, "length_required", "content-length header is required", setCookie);
  }
  const name = url.searchParams.get("name");
  if (name === null) {
    return jsonError(400, "bad_request", "name query parameter is required", setCookie);
  }
  const file = await client.uploadFile({
    name,
    mime: url.searchParams.get("mime"),
    folderId: url.searchParams.get("folder_id") || null,
    contentType: req.headers.get("content-type") ?? "application/octet-stream",
    contentLength,
    body: req.body ?? emptyStream(),
  });
  return jsonResponse(file, setCookie, 201);
}

async function readName(req: Request): Promise<string | null> {
  const body = await readFolderBody(req);
  return body?.name ?? null;
}

function booleanQuery(url: URL, key: string): boolean | undefined | null {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

async function readFolderBody(req: Request): Promise<{ name: string; parentId?: string | null } | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { name, parent_id: parentId } = body as { name?: unknown; parent_id?: unknown };
  if (typeof name !== "string" || name.length === 0) return null;
  if (parentId !== undefined && parentId !== null && (typeof parentId !== "string" || parentId.length === 0)) return null;
  return { name, ...(parentId !== undefined ? { parentId: parentId as string | null } : {}) };
}
