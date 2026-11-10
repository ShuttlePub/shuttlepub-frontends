import type { RegistrationGateClient } from "./registration-gate.ts";

// ============================================================
// EmumetClient — Emumet REST API への抽象インターフェース
// DTO は bff/schema.graphql と同じ camelCase 形状。
// Real (real.ts) と Mock (mock.ts, T6) が同一契約で実装する。
// ============================================================

export type ModerationType = "SUSPENDED" | "BANNED";

export type Moderation = {
  readonly type: ModerationType;
  readonly reason: string;
  readonly suspendedAt: string | null;
  readonly expiresAt: string | null;
  readonly bannedAt: string | null;
};

export type Account = {
  readonly id: string;
  readonly name: string;
  readonly isBot: boolean;
  readonly publicKey: string;
  readonly createdAt: string;
  readonly moderation: Moderation | null;
};

export type AccountConnection = {
  readonly items: readonly Account[];
  readonly first: string | null;
  readonly last: string | null;
};

export type Profile = {
  readonly nanoid: string;
  readonly accountId: string;
  readonly displayName: string | null;
  readonly summary: string | null;
  readonly iconUrl: string | null;
  readonly bannerUrl: string | null;
};

export type Metadata = {
  readonly nanoid: string;
  readonly accountId: string;
  readonly label: string;
  readonly content: string;
};

export type CreateAccountInput = {
  readonly name: string;
  readonly isBot?: boolean;
};

/**
 * Tristate 更新フィールド: undefined → JSON フィールド省略 (変更なし) /
 * null → JSON null (クリア) / 値 → 値をセット
 */
export type ProfileFields = {
  readonly displayName?: string | null;
  readonly summary?: string | null;
  readonly iconUrl?: string | null;
  readonly bannerUrl?: string | null;
};

export type MetadataInput = {
  readonly label: string;
  readonly content: string;
};

/** Emumet API が想定外のステータスを返した場合のエラー */
export class EmumetApiError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Emumet API error: status=${status} body=${body}`);
    this.name = "EmumetApiError";
    this.status = status;
  }
}

/** 対象リソースが存在しない (updateMetadata の再フェッチ欠損、deleteMetadata の 404 等) */
export class EmumetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmumetNotFoundError";
  }
}

/**
 * バッチ契約: listProfiles / listMetadata は複数 accountId を 1 リクエストで取得する
 * 基本操作 (DataLoader の batchFn からそのまま呼ばれる)。getProfile は
 * listProfiles([id]) の薄いラッパとして各実装が提供する。
 */
export interface EmumetClient extends RegistrationGateClient {
  listAccounts(): Promise<AccountConnection>;
  getAccount(id: string): Promise<Account | null>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  listProfiles(accountIds: readonly string[]): Promise<readonly Profile[]>;
  getProfile(accountId: string): Promise<Profile | null>;
  /** プロフィール未存在なら作成 (POST)、存在すれば更新 (PUT)。戻り値は更新後の Profile */
  upsertProfile(accountId: string, fields: ProfileFields): Promise<Profile>;
  listMetadata(accountIds: readonly string[]): Promise<readonly Metadata[]>;
  createMetadata(accountId: string, input: MetadataInput): Promise<Metadata>;
  updateMetadata(accountId: string, nanoid: string, input: MetadataInput): Promise<Metadata>;
  deleteMetadata(accountId: string, nanoid: string): Promise<void>;
}
