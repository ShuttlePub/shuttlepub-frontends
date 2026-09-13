// ============================================================
// RealBooskiffClient — Booskiff core REST API 実装
// ワイヤ形式は snake_case、DTO は camelCase。境界で相互変換する。
//
// streaming upload (uploadFile): incoming request の body を
// ReadableStream のまま core へ流す (バッファリングしない)。
// fetch に stream body を渡すには duplex: "half" が必須 (undici/Bun の
// streaming upload 契約)。Content-Length は incoming request から検証済み
// の値を verbatim でコピーする (再計算しない — core が期待するのは元
// リクエストの長さ)。
// ============================================================

import {
  BooskiffApiError,
  type BillingStatus,
  type BooskiffClient,
  type FileItem,
  type Folder,
  type UploadInput,
} from "./client.ts";

export type RealBooskiffConfig = {
  readonly coreApiUrl: string;
};

type WireFile = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  folder_id: string | null;
  is_public: boolean;
  created_at: string;
};

type WireFileList = { items: WireFile[] };

type WireFolder = { id: string; name: string; created_at: string };

type WireFolderList = { items: WireFolder[] };

type WireBilling = {
  used_bytes: number;
  storage_quota_bytes: number;
  max_file_bytes: number;
  rate_limit_rpm: number;
};

function toFile(wire: WireFile): FileItem {
  return {
    id: wire.id,
    name: wire.name,
    mimeType: wire.mime_type,
    sizeBytes: wire.size_bytes,
    folderId: wire.folder_id,
    isPublic: wire.is_public,
    createdAt: wire.created_at,
  };
}

function toFolder(wire: WireFolder): Folder {
  return { id: wire.id, name: wire.name, createdAt: wire.created_at };
}

function toBilling(wire: WireBilling): BillingStatus {
  return {
    usedBytes: wire.used_bytes,
    storageQuotaBytes: wire.storage_quota_bytes,
    maxFileBytes: wire.max_file_bytes,
    rateLimitRpm: wire.rate_limit_rpm,
  };
}

export function createBooskiffClient(config: RealBooskiffConfig, accessToken: string): BooskiffClient {
  const base = config.coreApiUrl;

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  async function expectJson<T>(resp: Response, okStatuses: readonly number[]): Promise<T> {
    if (!okStatuses.includes(resp.status)) {
      throw new BooskiffApiError(resp.status, await resp.text());
    }
    return await resp.json() as T;
  }

  async function expectStatus(resp: Response, okStatuses: readonly number[]): Promise<void> {
    if (!okStatuses.includes(resp.status)) {
      throw new BooskiffApiError(resp.status, await resp.text());
    }
  }

  return {
    async getFile(id): Promise<FileItem> {
      const resp = await fetch(`${base}/v1/files/${encodeURIComponent(id)}`, { headers: authHeaders() });
      return toFile(await expectJson<WireFile>(resp, [200]));
    },

    async listFiles(folderId): Promise<readonly FileItem[]> {
      const query = new URLSearchParams();
      if (folderId !== undefined) query.set("folder_id", folderId);
      const qs = query.toString();
      const resp = await fetch(`${base}/v1/files${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
      const wire = await expectJson<WireFileList>(resp, [200]);
      return wire.items.map(toFile);
    },

    async uploadFile(input: UploadInput): Promise<FileItem> {
      const query = new URLSearchParams();
      query.set("name", input.name);
      if (input.mime !== null) query.set("mime", input.mime);
      if (input.folderId !== null) query.set("folder_id", input.folderId);
      const resp = await fetch(`${base}/v1/files?${query.toString()}`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": input.contentType,
          "Content-Length": input.contentLength,
        }),
        body: input.body,
        // stream body を fetch するための契約 (標準 RequestInit 型に無い拡張)
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const wire = await expectJson<WireFile>(resp, [201]);
      return toFile(wire);
    },

    async deleteFile(id): Promise<void> {
      const resp = await fetch(`${base}/v1/files/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      await expectStatus(resp, [204]);
    },

    async getDownloadUrl(id): Promise<string> {
      const resp = await fetch(`${base}/v1/files/${encodeURIComponent(id)}/download-url`, {
        headers: authHeaders(),
      });
      const wire = await expectJson<{ url: string }>(resp, [200]);
      return wire.url;
    },

    async listFolders(): Promise<readonly Folder[]> {
      const resp = await fetch(`${base}/v1/folders`, { headers: authHeaders() });
      const wire = await expectJson<WireFolderList>(resp, [200]);
      return wire.items.map(toFolder);
    },

    async getFolder(id): Promise<Folder> {
      const resp = await fetch(`${base}/v1/folders/${encodeURIComponent(id)}`, { headers: authHeaders() });
      return toFolder(await expectJson<WireFolder>(resp, [200]));
    },

    async createFolder(name): Promise<Folder> {
      const resp = await fetch(`${base}/v1/folders`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name }),
      });
      return toFolder(await expectJson<WireFolder>(resp, [201]));
    },

    async renameFolder(id, name): Promise<Folder> {
      const resp = await fetch(`${base}/v1/folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name }),
      });
      return toFolder(await expectJson<WireFolder>(resp, [200]));
    },

    async deleteFolder(id): Promise<void> {
      const resp = await fetch(`${base}/v1/folders/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      await expectStatus(resp, [204]);
    },

    async billingStatus(): Promise<BillingStatus> {
      const resp = await fetch(`${base}/v1/billing/status`, { headers: authHeaders() });
      return toBilling(await expectJson<WireBilling>(resp, [200]));
    },
  };
}
