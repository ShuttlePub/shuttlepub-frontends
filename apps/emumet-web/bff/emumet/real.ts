// ============================================================
// RealEmumetClient — Emumet REST API 実装 (REST 契約に準拠)
// ワイヤ形式は snake_case、DTO (client.ts) は camelCase。境界で相互変換する。
// ============================================================

import { createRealRegistrationGateClient } from "./registration-gate-real.ts";
import {
  EmumetApiError,
  EmumetNotFoundError,
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
  readonly baseUrl: string;
  /** 登録ゲート API の接続・応答待ち上限 (ms)。省略時は registration-gate-real.ts の既定値 */
  readonly registrationGateTimeoutMs?: number;
};

// --- ワイヤ型 (snake_case) ---

type WireModeration =
  | { type: "suspended"; reason: string; suspended_at: string; expires_at: string | null }
  | { type: "banned"; reason: string; banned_at: string };

type WireAccount = {
  id: string;
  name: string;
  is_bot: boolean;
  public_key: string;
  created_at: string;
  moderation?: WireModeration | null;
};

type WireAccounts = {
  items: WireAccount[];
  first: string | null;
  last: string | null;
};

type WireProfile = {
  account_id: string;
  nanoid: string;
  display_name: string | null;
  summary: string | null;
  icon_url: string | null;
  banner_url: string | null;
};

type WireMetadata = {
  account_id: string;
  nanoid: string;
  label: string;
  content: string;
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
    publicKey: wire.public_key,
    createdAt: wire.created_at,
    moderation: wire.moderation ? toModeration(wire.moderation) : null,
  };
}

function toProfile(wire: WireProfile): Profile {
  return {
    nanoid: wire.nanoid,
    accountId: wire.account_id,
    displayName: wire.display_name,
    summary: wire.summary,
    iconUrl: wire.icon_url,
    bannerUrl: wire.banner_url,
  };
}

function toMetadata(wire: WireMetadata): Metadata {
  return {
    nanoid: wire.nanoid,
    accountId: wire.account_id,
    label: wire.label,
    content: wire.content,
  };
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
    return fetch(`${config.baseUrl}${path}`, {
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

  async function expectStatus(resp: Response, okStatuses: readonly number[]): Promise<void> {
    if (!okStatuses.includes(resp.status)) {
      throw new EmumetApiError(resp.status, await resp.text());
    }
  }

  async function listProfiles(accountIds: readonly string[]): Promise<readonly Profile[]> {
    if (accountIds.length === 0) return [];
    const resp = await request("GET", `/profiles?account_ids=${accountIds.join(",")}`);
    const wires = await expectJson<WireProfile[]>(resp, [200]);
    return wires.map(toProfile);
  }

  async function getProfile(accountId: string): Promise<Profile | null> {
    const profiles = await listProfiles([accountId]);
    return profiles[0] ?? null;
  }

  async function listMetadata(accountIds: readonly string[]): Promise<readonly Metadata[]> {
    if (accountIds.length === 0) return [];
    const resp = await request("GET", `/metadata?account_ids=${accountIds.join(",")}`);
    const wires = await expectJson<WireMetadata[]>(resp, [200]);
    return wires.map(toMetadata);
  }

  const registrationGate = createRealRegistrationGateClient(
    { request },
    config.registrationGateTimeoutMs === undefined ? {} : { timeoutMs: config.registrationGateTimeoutMs },
  );

  return {
    ...registrationGate,
    async listAccounts(): Promise<AccountConnection> {
      const resp = await request("GET", "/accounts");
      if (resp.status === 404) {
        // Emumet は 0 件時に 404 "No accounts found" を返す → 空 connection に正規化
        return { items: [], first: null, last: null };
      }
      const wire = await expectJson<WireAccounts>(resp, [200]);
      return { items: wire.items.map(toAccount), first: wire.first, last: wire.last };
    },

    async getAccount(id: string): Promise<Account | null> {
      const resp = await request("GET", `/accounts?ids=${encodeURIComponent(id)}`);
      if (resp.status === 404) return null;
      const wire = await expectJson<WireAccounts>(resp, [200]);
      const account = wire.items[0];
      return account ? toAccount(account) : null;
    },

    async createAccount(input: CreateAccountInput): Promise<Account> {
      const resp = await request("POST", "/accounts", { name: input.name, is_bot: input.isBot ?? false });
      const wire = await expectJson<WireAccount>(resp, [201]);
      return toAccount(wire);
    },

    listProfiles,
    getProfile,

    async upsertProfile(accountId: string, fields: ProfileFields): Promise<Profile> {
      const existing = await getProfile(accountId);
      const body = profileFieldsToWire(fields);
      if (existing) {
        await expectStatus(await request("PUT", `/accounts/${encodeURIComponent(accountId)}/profile`, body), [204]);
      } else {
        await expectStatus(await request("POST", `/accounts/${encodeURIComponent(accountId)}/profile`, body), [201]);
      }
      const updated = await getProfile(accountId);
      if (!updated) throw new EmumetApiError(500, `profile missing after upsert: accountId=${accountId}`);
      return updated;
    },

    listMetadata,

    async createMetadata(accountId: string, input: MetadataInput): Promise<Metadata> {
      const resp = await request("POST", `/accounts/${encodeURIComponent(accountId)}/metadata`, {
        label: input.label,
        content: input.content,
      });
      const wire = await expectJson<WireMetadata>(resp, [201]);
      return toMetadata(wire);
    },

    async updateMetadata(accountId: string, nanoid: string, input: MetadataInput): Promise<Metadata> {
      await expectStatus(
        await request("PUT", `/accounts/${encodeURIComponent(accountId)}/metadata/${encodeURIComponent(nanoid)}`, {
          label: input.label,
          content: input.content,
        }),
        [204],
      );
      // PUT は 204 (ボディなし) のため再フェッチして対象 nanoid を返す
      const metas = await listMetadata([accountId]);
      const updated = metas.find((m) => m.nanoid === nanoid);
      if (!updated) throw new EmumetNotFoundError(`metadata not found after update: accountId=${accountId} nanoid=${nanoid}`);
      return updated;
    },

    async deleteMetadata(accountId: string, nanoid: string): Promise<void> {
      const resp = await request("DELETE", `/accounts/${encodeURIComponent(accountId)}/metadata/${encodeURIComponent(nanoid)}`);
      if (resp.status === 404) {
        throw new EmumetNotFoundError(`metadata not found: accountId=${accountId} nanoid=${nanoid}`);
      }
      await expectStatus(resp, [204]);
    },
  };
}
