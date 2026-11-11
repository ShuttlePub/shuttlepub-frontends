import type { ProfileUsernameViolation } from "./profile-username.ts";
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
  /**
   * Account 単位の公開鍵。Emumet の AccountResponse には無く (Profile モデル移行で Account 単位の鍵が無くなる。
   * 旧鍵 API は P4 で廃止)、real は値を持たず常に空文字を返す。画面側の Maybe 化・非表示は画面 PR で行う
   */
  readonly publicKey: string;
  readonly createdAt: string;
  readonly moderation: Moderation | null;
  /**
   * この Account を記述する Profile の nanoid と username (AccountResponse.profile_id / profile_username)。
   * 個人 Account は Profile が 1 つ、組織 Account は複数ありうるが最小 id のもの。
   * profileId が非 null で profileUsername が null のとき「username 未設定」。
   * profileId が null になるのは Profile を持たない Account (mock の移管元) だけ。
   */
  readonly profileId: string | null;
  readonly profileUsername: string | null;
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
  /** 一度だけ設定でき、以後変更できない。未設定 (既存 Profile) は null。Account 名や所有者から導出しない */
  readonly username: string | null;
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
  /** Profile username。指定すれば profile_username として送る。省略時は送らない (旧経路。新 UI は必ず指定する) */
  readonly username?: string;
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

/** BFF がまだ対応していない操作 (安全に実装できる契約が揃っていない) */
export class EmumetUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmumetUnsupportedError";
  }
}

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
 * Profile username に関する上流の拒否。HTTP ステータスの写しではなく、UI が別々に扱う種別:
 *   Invalid        400 形式違反 / 予約語 (reason で区別)
 *   Taken          409 他の Profile (削除済みを含む) が使用中
 *   AlreadySet     409 この Profile は設定済みで変更できない (一回限り)
 *   Conflict       409 だが Taken / AlreadySet を判別できない (上流本文が空のため)
 *   AccountRestricted 422 所有 Account が停止中
 */
export class EmumetUsernameInvalidError extends Error {
  readonly reason: ProfileUsernameViolation;
  constructor(reason: ProfileUsernameViolation) {
    super(`profile username rejected: ${reason}`);
    this.name = "EmumetUsernameInvalidError";
    this.reason = reason;
  }
}

export class EmumetUsernameTakenError extends Error {
  constructor() {
    super("profile username is already taken");
    this.name = "EmumetUsernameTakenError";
  }
}

export class EmumetUsernameAlreadySetError extends Error {
  constructor() {
    super("profile already has a username");
    this.name = "EmumetUsernameAlreadySetError";
  }
}

export class EmumetUsernameConflictError extends Error {
  constructor() {
    super("profile username conflict (taken or already set)");
    this.name = "EmumetUsernameConflictError";
  }
}

export class EmumetAccountRestrictedError extends Error {
  constructor() {
    super("owning account is suspended or banned");
    this.name = "EmumetAccountRestrictedError";
  }
}

/**
 * Metadata (Account の fields) の nanoid は配列内の位置 (0 始まりの index の文字列)。Emumet の fields には
 * 識別子が無く、書込みは配列ごとの置換のため、削除すると後続の位置が繰り上がる。画面側が位置を振り直すまで
 * 安全に削除できないため、real の deleteMetadata は EmumetUnsupportedError を投げる。
 *
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
  /**
   * username が未設定の Profile に一度だけ設定する (POST /api/v1/profiles/{profile_nanoid}/username)。
   * 変更する API・mutation は存在しない。失敗は EmumetUsername*Error / EmumetAccountRestrictedError /
   * EmumetNotFoundError / EmumetApiError (401・403 等) のいずれか。
   */
  setProfileUsername(profileId: string, username: string): Promise<Profile>;
  listMetadata(accountIds: readonly string[]): Promise<readonly Metadata[]>;
  createMetadata(accountId: string, input: MetadataInput): Promise<Metadata>;
  updateMetadata(accountId: string, nanoid: string, input: MetadataInput): Promise<Metadata>;
  deleteMetadata(accountId: string, nanoid: string): Promise<void>;
}
