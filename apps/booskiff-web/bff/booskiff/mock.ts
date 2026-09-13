// ============================================================
// MockBooskiffClient — 単体テスト専用のインメモリ実装。
// USE_MOCK とは無関係 (USE_MOCK は auth モードのみを切替え、data 呼出は
// 常に CORE_API_URL へ流れる設計)。このクライアントは bun test から直接
// import されて使う。クォータ会計: maxFileBytes (既定 100MiB, env
// MOCK_MAX_FILE_BYTES) / storageQuotaBytes (既定 1GiB,
// MOCK_STORAGE_QUOTA_BYTES)。エラーは core と同じ
// {"error":{code,message}} 形状で BooskiffApiError として投げる。
// ============================================================

import {
  BooskiffApiError,
  type BillingStatus,
  type BooskiffClient,
  type FileItem,
  type Folder,
  type UploadInput,
} from "./client.ts";

export type MockBooskiffConfig = {
  readonly maxFileBytes?: number;
  readonly storageQuotaBytes?: number;
};

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MiB
const DEFAULT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024; // 1GiB

function apiError(status: number, code: string, message: string): BooskiffApiError {
  return new BooskiffApiError(status, JSON.stringify({ error: { code, message } }));
}

export function createMockBooskiffClient(config: MockBooskiffConfig = {}): BooskiffClient {
  const maxFileBytes = config.maxFileBytes ?? (Number(process.env.MOCK_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES);
  const storageQuotaBytes = config.storageQuotaBytes ?? (Number(process.env.MOCK_STORAGE_QUOTA_BYTES) || DEFAULT_STORAGE_QUOTA_BYTES);

  const folders: Folder[] = [];
  const files: FileItem[] = [];
  let idCounter = 0;
  const nextId = (prefix: string): string => `${prefix}_${++idCounter}`;

  function usedBytes(): number {
    return files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }

  function requireFolder(id: string): Folder {
    const folder = folders.find((f) => f.id === id);
    if (!folder) throw apiError(404, "not_found", `folder not found: ${id}`);
    return folder;
  }

  function requireFile(id: string): FileItem {
    const file = files.find((f) => f.id === id);
    if (!file) throw apiError(404, "not_found", `file not found: ${id}`);
    return file;
  }

  return {
    async getFile(id): Promise<FileItem> {
      return requireFile(id);
    },

    async listFiles(folderId): Promise<readonly FileItem[]> {
      return folderId === undefined ? [...files] : files.filter((f) => f.folderId === folderId);
    },

    async uploadFile(input: UploadInput): Promise<FileItem> {
      const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
      if (bytes.byteLength > maxFileBytes) {
        throw apiError(413, "file_too_large", `file exceeds maxFileBytes: ${bytes.byteLength} > ${maxFileBytes}`);
      }
      const total = usedBytes() + bytes.byteLength;
      if (total > storageQuotaBytes) {
        throw apiError(507, "insufficient_storage", `storage quota exceeded: ${total} > ${storageQuotaBytes}`);
      }
      const file: FileItem = {
        id: nextId("file"),
        name: input.name,
        mimeType: input.mime ?? "application/octet-stream",
        sizeBytes: bytes.byteLength,
        folderId: input.folderId,
        isPublic: false,
        createdAt: new Date().toISOString(),
      };
      files.push(file);
      return file;
    },

    async deleteFile(id): Promise<void> {
      requireFile(id);
      files.splice(files.findIndex((f) => f.id === id), 1);
    },

    async getDownloadUrl(id): Promise<string> {
      requireFile(id);
      return `http://mock-storage.local/booskiff/${id}?sig=mock`;
    },

    async listFolders(): Promise<readonly Folder[]> {
      return [...folders];
    },

    async getFolder(id): Promise<Folder> {
      return requireFolder(id);
    },

    async createFolder(name): Promise<Folder> {
      if (folders.some((f) => f.name === name)) {
        throw apiError(409, "folder_already_exists", `folder already exists: ${name}`);
      }
      const folder: Folder = { id: nextId("folder"), name, createdAt: new Date().toISOString() };
      folders.push(folder);
      return folder;
    },

    async renameFolder(id, name): Promise<Folder> {
      const folder = requireFolder(id);
      const renamed: Folder = { ...folder, name };
      folders[folders.indexOf(folder)] = renamed;
      return renamed;
    },

    async deleteFolder(id): Promise<void> {
      const folder = requireFolder(id);
      folders.splice(folders.indexOf(folder), 1);
      // フォルダ削除で file の folderId は detach (null) される
      for (const [index, file] of files.entries()) {
        if (file.folderId === folder.id) files[index] = { ...file, folderId: null };
      }
    },

    async billingStatus(): Promise<BillingStatus> {
      return {
        usedBytes: usedBytes(),
        storageQuotaBytes,
        maxFileBytes,
        rateLimitRpm: 60,
      };
    },
  };
}
