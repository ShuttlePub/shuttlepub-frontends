// ============================================================
// BooskiffClient — Booskiff core REST API への抽象インターフェース
// DTO は camelCase。Real (real.ts) と Mock (mock.ts, 単体テスト専用) が
// 同一契約で実装する。エラーは BooskiffApiError (status + core のエラー
// ボディ原文) として routes 側へそのまま伝播し、パススルーされる。
// ============================================================

export type FileItem = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly folderId: string | null;
  readonly isPublic: boolean;
  readonly createdAt: string;
};

export type Folder = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
};

export type BillingStatus = {
  readonly usedBytes: number;
  readonly storageQuotaBytes: number;
  readonly maxFileBytes: number;
  readonly rateLimitRpm: number;
};

export type UploadInput = {
  readonly name: string;
  /** core へそのまま渡す mime。null ならクエリから省略 */
  readonly mime: string | null;
  readonly folderId: string | null;
  readonly contentType: string;
  /** incoming request の Content-Length (411 済み) を verbatim でコピーする */
  readonly contentLength: string;
  readonly body: ReadableStream<Uint8Array>;
};

/** core がエラーステータスを返した場合のエラー。body は原文 (JSON) */
export class BooskiffApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Booskiff core API error: status=${status} body=${body}`);
    this.name = "BooskiffApiError";
    this.status = status;
    this.body = body;
  }
}

export interface BooskiffClient {
  getFile(id: string): Promise<FileItem>;
  listFiles(folderId?: string): Promise<readonly FileItem[]>;
  uploadFile(input: UploadInput): Promise<FileItem>;
  deleteFile(id: string): Promise<void>;
  getDownloadUrl(id: string): Promise<string>;
  listFolders(): Promise<readonly Folder[]>;
  getFolder(id: string): Promise<Folder>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  billingStatus(): Promise<BillingStatus>;
}
