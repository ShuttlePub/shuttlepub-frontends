// ============================================================
// RealEmumetClient — Emumet REST API 実装 (固定した OpenAPI 契約に準拠)
// ワイヤ形式は snake_case、DTO (client.ts) は camelCase。境界で相互変換する。
//
// Account / Profile / Metadata はすべて AccountResponse (`/api/v1/accounts`) から作る:
//   Account   id / name / is_bot / created_at / moderation (Account 単位の鍵は返らないため publicKey は常に空文字)
//   Profile   profile_id (= nanoid)・display_name・summary・icon_url・banner_url・profile_username
//   Metadata  fields (label / content の配列。nanoid は無いため配列内の位置 (0 始まりの index) を nanoid にする。読取のみ)
// 書込みは Profile 属性の PATCH /api/v1/accounts/{id} だけ (fields は送らない)。Metadata の書込みは未対応 (項目 ID・revision が無く安全に書けない)。
// 旧 /profiles・/metadata・/accounts/{id}/profile 系は実 Emumet に存在しないため使わない。
// ============================================================

import { describeViolations, violationsForResponse } from "../openapi/contract.ts";
import { checkProfileUsername } from "./profile-username.ts";
import { createRealRegistrationGateClient } from "./registration-gate-real.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./registration-gate.ts";
import {
  EmumetAccountRestrictedError,
  EmumetApiError,
  EmumetNotFoundError,
  EmumetUnsupportedError,
  EmumetUsernameAlreadySetError,
  EmumetUsernameConflictError,
  EmumetUsernameInvalidError,
  EmumetUsernameTakenError,
  type Account,
  type AccountConnection,
  type CreateAccountInput,
  type EmumetClient,
  type Metadata,
  type MetadataInput,
  type Moderation,
  type Profile,
  type ProfileFields,
} from "./client.ts";

export type RealEmumetConfig = {
  /**
   * Emumet の origin (例: http://localhost:8080)。パスは含めない: すべての API path は `/api/v1/...` を
   * この値に連結する (登録ゲート・OAuth2 consent (`{origin}/oauth2/consent`)・shuttlepub-web も同じ規約)。
   * 末尾の `/` は無視する。EMUMET_API_URL にそのまま渡す値
   */
  readonly baseUrl: string;
  /** 登録ゲート API の接続・応答待ち上限 (ms)。省略時は registration-gate-real.ts の既定値 */
  readonly registrationGateTimeoutMs?: number;
};

const METADATA_WRITE_UNSUPPORTED = "writing metadata is not supported: Emumet has no per-field id or revision to make it safe";

/** Account の list / get / create / update (OpenAPI: `/api/v1/accounts`)。Profile の一回限り設定は `/api/v1/profiles/...` */
const ACCOUNTS_PATH = "/api/v1/accounts";

// --- ワイヤ型 (snake_case) ---

type WireModeration =
  | { type: "suspended"; reason: string; suspended_at: string; expires_at: string | null }
  | { type: "banned"; reason: string; banned_at: string };

type WireField = { label: string; content: string };

/** AccountResponse (OpenAPI)。任意フィールドは省略されうる */
type WireAccount = {
  id: string;
  name: string;
  is_bot: boolean;
  created_at: string;
  moderation?: WireModeration | null;
  /** この Account を記述する Profile の nanoid (OpenAPI では必須。組織 Account は最小 id の Profile) */
  profile_id: string;
  /** 未設定は null */
  profile_username?: string | null;
  display_name?: string | null;
  summary?: string | null;
  icon_url?: string | null;
  banner_url?: string | null;
  fields: WireField[];
};

type WireAccounts = {
  items: WireAccount[];
  first: string | null;
  last: string | null;
};

/** ProfileResponse (OpenAPI): Profile の nanoid は `id`、任意フィールドは省略されうる */
type WireProfileResponse = {
  account_id: string;
  id: string;
  display_name?: string | null;
  summary?: string | null;
  icon_url?: string | null;
  banner_url?: string | null;
  username?: string | null;
};

// --- snake_case → camelCase 変換 ---

function toModeration(wire: WireModeration): Moderation {
  switch (wire.type) {
    case "suspended":
      return {
        type: "SUSPENDED",
        reason: wire.reason,
        suspendedAt: wire.suspended_at,
        expiresAt: wire.expires_at,
        bannedAt: null,
      };
    case "banned":
      return {
        type: "BANNED",
        reason: wire.reason,
        suspendedAt: null,
        expiresAt: null,
        bannedAt: wire.banned_at,
      };
  }
}

function toAccount(wire: WireAccount): Account {
  return {
    id: wire.id,
    name: wire.name,
    isBot: wire.is_bot,
    // AccountResponse に Account 単位の公開鍵は無い (Profile モデル移行で廃止予定)。値は持たず空文字を返す
    publicKey: "",
    createdAt: wire.created_at,
    moderation: wire.moderation ? toModeration(wire.moderation) : null,
    profileId: wire.profile_id,
    profileUsername: wire.profile_username ?? null,
  };
}

/** Account を記述する Profile (AccountResponse の Profile 部分)。Account 名や所有者からは導出しない */
function toProfileFromAccount(wire: WireAccount): Profile {
  return {
    nanoid: wire.profile_id,
    accountId: wire.id,
    displayName: wire.display_name ?? null,
    summary: wire.summary ?? null,
    iconUrl: wire.icon_url ?? null,
    bannerUrl: wire.banner_url ?? null,
    username: wire.profile_username ?? null,
  };
}

function toProfileFromResponse(wire: WireProfileResponse): Profile {
  return {
    nanoid: wire.id,
    accountId: wire.account_id,
    displayName: wire.display_name ?? null,
    summary: wire.summary ?? null,
    iconUrl: wire.icon_url ?? null,
    bannerUrl: wire.banner_url ?? null,
    username: wire.username ?? null,
  };
}

/** fields[index] → Metadata。nanoid は配列内の位置 (0 始まり)。削除すると後続の位置が繰り上がる */
function toMetadata(accountId: string, field: WireField, index: number): Metadata {
  return { nanoid: String(index), accountId, label: field.label, content: field.content };
}

function toMetadataList(wire: WireAccount): Metadata[] {
  return wire.fields.map((field, index) => toMetadata(wire.id, field, index));
}

/** Tristate → JSON body: undefined → フィールド省略 / null → JSON null / 値 → 値 */
function profileFieldsToWire(fields: ProfileFields): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  if (fields.displayName !== undefined) body.display_name = fields.displayName;
  if (fields.summary !== undefined) body.summary = fields.summary;
  if (fields.iconUrl !== undefined) body.icon_url = fields.iconUrl;
  if (fields.bannerUrl !== undefined) body.banner_url = fields.bannerUrl;
  return body;
}

export function createRealEmumetClient(config: RealEmumetConfig, accessToken: string): EmumetClient {
  async function request(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(timeoutMs !== undefined ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  }

  async function expectJson<T>(resp: Response, okStatuses: readonly number[]): Promise<T> {
    if (!okStatuses.includes(resp.status)) {
      throw new EmumetApiError(resp.status, await resp.text());
    }
    return await resp.json() as T;
  }

  /** GET /api/v1/accounts[?ids=a,b]。0 件のとき Emumet は 404 "No accounts found" を返す → 空に正規化 */
  async function fetchWireAccounts(ids?: readonly string[]): Promise<WireAccounts> {
    const query = ids === undefined ? "" : `?ids=${ids.map(encodeURIComponent).join(",")}`;
    const resp = await request("GET", `${ACCOUNTS_PATH}${query}`);
    if (resp.status === 404) return { items: [], first: null, last: null };
    return await expectJson<WireAccounts>(resp, [200]);
  }

  async function fetchWireAccount(accountId: string): Promise<WireAccount | null> {
    const wire = await fetchWireAccounts([accountId]);
    return wire.items.find((account) => account.id === accountId) ?? null;
  }

  /** 書込み (PATCH) の対象が無ければ NotFound。400 等は EmumetApiError のまま */
  async function patchAccount(accountId: string, body: Record<string, unknown>): Promise<WireAccount> {
    const resp = await request("PATCH", `${ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`, body);
    if (resp.status === 404) throw new EmumetNotFoundError(`account not found: accountId=${accountId}`);
    return await expectJson<WireAccount>(resp, [200]);
  }

  async function listProfiles(accountIds: readonly string[]): Promise<readonly Profile[]> {
    if (accountIds.length === 0) return [];
    const wire = await fetchWireAccounts(accountIds);
    return wire.items.map(toProfileFromAccount);
  }

  async function getProfile(accountId: string): Promise<Profile | null> {
    const profiles = await listProfiles([accountId]);
    return profiles[0] ?? null;
  }

  async function listMetadata(accountIds: readonly string[]): Promise<readonly Metadata[]> {
    if (accountIds.length === 0) return [];
    const wire = await fetchWireAccounts(accountIds);
    return wire.items.flatMap(toMetadataList);
  }

  /** 200 本文を契約 (ProfileResponse) で検証してから変換する。違反は成功扱いにしない */
  async function readSetUsernameResponse(resp: Response, path: string): Promise<Profile> {
    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      throw new EmumetInvalidResponseError(`Emumet API POST ${path}: 200 body is not valid JSON`);
    }
    const violations = violationsForResponse(
      { path: "/api/v1/profiles/{profile_nanoid}/username", method: "post", status: "200" },
      json,
    );
    if (violations.length > 0) {
      throw new EmumetInvalidResponseError(
        `Emumet API POST ${path}: 200 body violates the pinned OpenAPI contract: ${describeViolations(violations)}`,
      );
    }
    return toProfileFromResponse(json as WireProfileResponse);
  }

  /**
   * 409 は「設定済み」と「他で使用中」を本文で区別しない (空本文)。契約は次のとおり:
   *   - 再確認は 409 後の「現在の状態」であり、409 の原因そのものの証明ではない
   *   - 現在設定済み (競合で別セッションが先に設定した場合、送信応答失敗後の再送で同じ値が設定済みの場合を含む) → AlreadySet
   *   - 現在未設定で、自分の Account 一覧にその Profile がある → Taken (文書化された 409 の残りの原因は重複と、認可後の所有者変更だけ。
   *     所有者変更は一覧から消えるためここには来ない)
   *   - 確認できない (フィールドが来ない・対象が見つからない・取得失敗) → 推測せず Conflict
   */
  async function classifyUsernameConflict(profileId: string): Promise<Error> {
    try {
      const connection = await listAccounts();
      const owner = connection.items.find((account) => account.profileId === profileId);
      if (owner === undefined) return new EmumetUsernameConflictError();
      return owner.profileUsername === null ? new EmumetUsernameTakenError() : new EmumetUsernameAlreadySetError();
    } catch {
      return new EmumetUsernameConflictError();
    }
  }

  async function listAccounts(): Promise<AccountConnection> {
    const wire = await fetchWireAccounts();
    return { items: wire.items.map(toAccount), first: wire.first, last: wire.last };
  }

  const registrationGate = createRealRegistrationGateClient(
    { request },
    config.registrationGateTimeoutMs === undefined ? {} : { timeoutMs: config.registrationGateTimeoutMs },
  );

  return {
    ...registrationGate,
    listAccounts,

    async getAccount(id: string): Promise<Account | null> {
      const wire = await fetchWireAccount(id);
      return wire ? toAccount(wire) : null;
    },

    async createAccount(input: CreateAccountInput): Promise<Account> {
      const body: Record<string, unknown> = { name: input.name, is_bot: input.isBot ?? false };
      if (input.username !== undefined) body.profile_username = input.username;
      const resp = await request("POST", ACCOUNTS_PATH, body);
      if (input.username !== undefined) {
        // username を送った作成だけ、400/409 を username の拒否として区別する (作成は副作用前に拒否される)
        if (resp.status === 400) {
          const violation = checkProfileUsername(input.username);
          if (violation !== null) throw new EmumetUsernameInvalidError(violation);
        }
        if (resp.status === 409) throw new EmumetUsernameTakenError();
      }
      const wire = await expectJson<WireAccount>(resp, [201]);
      return toAccount(wire);
    },

    listProfiles,
    getProfile,

    /** Profile は Account 作成時に必ず作られるため作成 (POST) は無く、PATCH だけ。未指定フィールドは変更しない */
    async upsertProfile(accountId: string, fields: ProfileFields): Promise<Profile> {
      return toProfileFromAccount(await patchAccount(accountId, profileFieldsToWire(fields)));
    },

    async setProfileUsername(profileId: string, username: string): Promise<Profile> {
      const path = `/api/v1/profiles/${encodeURIComponent(profileId)}/username`;
      let resp: Response;
      try {
        resp = await request("POST", path, { username });
      } catch (cause) {
        throw new EmumetUnavailableError(`Emumet API request failed: POST ${path}`, { cause });
      }
      switch (resp.status) {
        case 200:
          return await readSetUsernameResponse(resp, path);
        case 400: {
          const violation = checkProfileUsername(username);
          if (violation !== null) throw new EmumetUsernameInvalidError(violation);
          throw new EmumetApiError(400, await resp.text());
        }
        case 404:
          throw new EmumetNotFoundError(`profile not found: profileId=${profileId}`);
        case 409:
          throw await classifyUsernameConflict(profileId);
        case 422:
          throw new EmumetAccountRestrictedError();
        default:
          throw new EmumetApiError(resp.status, await resp.text());
      }
    },

    listMetadata,

    /**
     * Metadata の書込み (作成・更新・削除) はすべて未対応で、何も送らない。上流の PATCH /api/v1/accounts/{id} は
     * fields を配列ごと置換するだけで、項目 ID も revision (CAS) も無い。位置指定の読み出し → 置換では
     * 並行する 2 更新の lost update や、他クライアントが fields を置換した後の古い画面からの誤更新
     * (位置のずれ) を防げない。安全な書込みには Emumet 側の項目 ID または fields の revision が必要 (後続課題)
     */
    async createMetadata(accountId: string, input: MetadataInput): Promise<Metadata> {
      void accountId;
      void input;
      throw new EmumetUnsupportedError(METADATA_WRITE_UNSUPPORTED);
    },

    async updateMetadata(accountId: string, nanoid: string, input: MetadataInput): Promise<Metadata> {
      void accountId;
      void nanoid;
      void input;
      throw new EmumetUnsupportedError(METADATA_WRITE_UNSUPPORTED);
    },

    async deleteMetadata(accountId: string, nanoid: string): Promise<void> {
      void accountId;
      void nanoid;
      throw new EmumetUnsupportedError(METADATA_WRITE_UNSUPPORTED);
    },
  };
}
