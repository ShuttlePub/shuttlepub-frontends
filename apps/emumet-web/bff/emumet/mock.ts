// ============================================================
// MockEmumetClient — index.ts handleMockApi の移植 (ステートフル)
// DTO (camelCase) をそのまま保持するインメモリストア。
// バッチ契約: listProfiles / listMetadata は accountIds 配列を受け取る。
// ストアは createMockEmumetClient() 呼び出しごとに独立 (id カウンタも 100 にリセット)。
// ============================================================

import {
  EmumetNotFoundError,
  type Account,
  type AccountConnection,
  type CreateAccountInput,
  type EmumetClient,
  type Metadata,
  type MetadataInput,
  type Profile,
  type ProfileFields,
} from "./client.ts";
import {
  createMockRegistrationGate,
  type MockRegistrationGateControl,
  type MockRegistrationGateOptions,
} from "./registration-gate-mock.ts";

export type MockEmumetClientOptions = {
  readonly registrationGate?: MockRegistrationGateOptions;
};

/** EmumetClient に、テスト・fixture 専用の登録ゲート制御 (観測入力・権限・障害注入) を足したもの */
export type MockEmumetClient = EmumetClient & {
  readonly registrationGateControl: MockRegistrationGateControl;
};

/** Tristate 更新解決 (resolveTristateUpdate 相当): undefined → 既存維持 / null → null / 値 → 値 */
function resolveUpdate(value: string | null | undefined, existing: string | null): string | null {
  return value !== undefined ? value : existing;
}

export function createMockEmumetClient(options: MockEmumetClientOptions = {}): MockEmumetClient {
  const registrationGate = createMockRegistrationGate(options.registrationGate);
  let idCounter = 100;
  function nextId(): string {
    return String(idCounter++);
  }

  const accounts: Account[] = [
    { id: "acc_01", name: "alice", isBot: false, publicKey: "ed25519:AAAA", createdAt: "2025-01-15T09:00:00Z", moderation: null },
    { id: "acc_02", name: "bob", isBot: false, publicKey: "ed25519:BBBB", createdAt: "2025-02-20T14:30:00Z", moderation: null },
    { id: "acc_03", name: "bot-news", isBot: true, publicKey: "ed25519:CCCC", createdAt: "2025-03-10T00:00:00Z", moderation: null },
  ];

  const profiles: Profile[] = [
    { accountId: "acc_01", nanoid: "prof_01", displayName: "Alice Wonderland", summary: "Exploring the rabbit hole of federated social networks.", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=alice", bannerUrl: "https://picsum.photos/seed/alice/800/200" },
    { accountId: "acc_02", nanoid: "prof_02", displayName: "Bob Builder", summary: "Can we fix it? Yes we can!", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=bob", bannerUrl: null },
    { accountId: "acc_03", nanoid: "prof_03", displayName: "News Bot", summary: "Automated news aggregator.", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=bot", bannerUrl: null },
  ];

  const metadata: Metadata[] = [
    { accountId: "acc_01", nanoid: "meta_01", label: "Website", content: "https://alice.example.com" },
    { accountId: "acc_01", nanoid: "meta_02", label: "Pronouns", content: "she/her" },
    { accountId: "acc_02", nanoid: "meta_03", label: "GitHub", content: "https://github.com/bob" },
  ];

  async function listProfiles(accountIds: readonly string[]): Promise<readonly Profile[]> {
    return profiles.filter((p) => accountIds.includes(p.accountId));
  }

  async function getProfile(accountId: string): Promise<Profile | null> {
    const found = await listProfiles([accountId]);
    return found[0] ?? null;
  }

  async function listMetadata(accountIds: readonly string[]): Promise<readonly Metadata[]> {
    return metadata.filter((m) => accountIds.includes(m.accountId));
  }

  return {
    ...registrationGate.client,
    registrationGateControl: registrationGate.control,
    async listAccounts(): Promise<AccountConnection> {
      return { items: accounts, first: null, last: null };
    },

    async getAccount(id: string): Promise<Account | null> {
      return accounts.find((a) => a.id === id) ?? null;
    },

    async createAccount(input: CreateAccountInput): Promise<Account> {
      const id = "acc_" + nextId();
      const account: Account = {
        id,
        name: input.name,
        isBot: input.isBot ?? false,
        publicKey: "ed25519:MOCK_" + id,
        createdAt: new Date().toISOString(),
        moderation: null,
      };
      accounts.push(account);
      return account;
    },

    listProfiles,
    getProfile,

    async upsertProfile(accountId: string, fields: ProfileFields): Promise<Profile> {
      const idx = profiles.findIndex((p) => p.accountId === accountId);
      if (idx < 0) {
        // 未存在 → 作成 (mock POST 相当): 未指定フィールドは null
        const created: Profile = {
          accountId,
          nanoid: "prof_" + nextId(),
          displayName: fields.displayName ?? null,
          summary: fields.summary ?? null,
          iconUrl: fields.iconUrl ?? null,
          bannerUrl: fields.bannerUrl ?? null,
        };
        profiles.push(created);
        return created;
      }
      // 存在 → 更新 (mock PUT 相当): undefined → 既存維持 / null → null / 値 → 値
      const existing = profiles[idx];
      const updated: Profile = {
        accountId: existing.accountId,
        nanoid: existing.nanoid,
        displayName: resolveUpdate(fields.displayName, existing.displayName),
        summary: resolveUpdate(fields.summary, existing.summary),
        iconUrl: resolveUpdate(fields.iconUrl, existing.iconUrl),
        bannerUrl: resolveUpdate(fields.bannerUrl, existing.bannerUrl),
      };
      profiles[idx] = updated;
      return updated;
    },

    listMetadata,

    async createMetadata(accountId: string, input: MetadataInput): Promise<Metadata> {
      const meta: Metadata = {
        accountId,
        nanoid: "meta_" + nextId(),
        label: input.label,
        content: input.content,
      };
      metadata.push(meta);
      return meta;
    },

    async updateMetadata(accountId: string, nanoid: string, input: MetadataInput): Promise<Metadata> {
      const idx = metadata.findIndex((m) => m.accountId === accountId && m.nanoid === nanoid);
      if (idx < 0) {
        throw new EmumetNotFoundError(`metadata not found: accountId=${accountId} nanoid=${nanoid}`);
      }
      const updated: Metadata = { accountId, nanoid, label: input.label, content: input.content };
      metadata[idx] = updated;
      return updated;
    },

    async deleteMetadata(accountId: string, nanoid: string): Promise<void> {
      const idx = metadata.findIndex((m) => m.accountId === accountId && m.nanoid === nanoid);
      if (idx < 0) {
        throw new EmumetNotFoundError(`metadata not found: accountId=${accountId} nanoid=${nanoid}`);
      }
      metadata.splice(idx, 1);
    },
  };
}
