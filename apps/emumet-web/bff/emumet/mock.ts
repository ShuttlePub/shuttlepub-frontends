// ============================================================
// MockEmumetClient — index.ts handleMockApi の移植 (ステートフル)
// DTO (camelCase) をそのまま保持するインメモリストア。
// バッチ契約: listProfiles / listMetadata は accountIds 配列を受け取る。
// ストアは createMockEmumetClient() 呼び出しごとに独立 (id カウンタも 100 にリセット)。
// ============================================================

import { checkProfileUsername } from "./profile-username.ts";
import {
  EmumetAccountRestrictedError,
  EmumetNotFoundError,
  EmumetUsernameAlreadySetError,
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
import {
  createMockRegistrationGate,
  type MockRegistrationGateControl,
  type MockRegistrationGateOptions,
} from "./registration-gate-mock.ts";

export type MockEmumetClientOptions = {
  readonly registrationGate?: MockRegistrationGateOptions;
};

/** テスト・fixture 専用の Profile identity 制御 (本番の API には存在しない操作) */
export type MockProfileIdentityControl = {
  /**
   * Profile を別の Account へ移管する (Emumet の Profile 移管の再現)。username・nanoid は変わらない。
   * 移管先は複数の Profile を持ちうる (組織 Account)。Account がどの Profile で記述されるかは作成順で最も古いもの
   * (実 API は最小 Profile id)。移管元は Profile を失うと profileId が null になる
   */
  transferProfile(profileId: string, toAccountId: string): void;
  /** Account の停止・BAN 状態を設定する (null で解除)。停止中の Account の Profile には username を設定できない (422) */
  setModeration(accountId: string, moderation: Moderation | null): void;
};

/** EmumetClient に、テスト・fixture 専用の登録ゲート制御 (観測入力・権限・障害注入) と Profile identity 制御を足したもの */
export type MockEmumetClient = EmumetClient & {
  readonly registrationGateControl: MockRegistrationGateControl;
  readonly profileIdentityControl: MockProfileIdentityControl;
};

type StoredAccount = Omit<Account, "profileId" | "profileUsername">;

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

  const accounts: StoredAccount[] = [
    { id: "acc_01", name: "alice", isBot: false, publicKey: "ed25519:AAAA", createdAt: "2025-01-15T09:00:00Z", moderation: null },
    { id: "acc_02", name: "bob", isBot: false, publicKey: "ed25519:BBBB", createdAt: "2025-02-20T14:30:00Z", moderation: null },
    { id: "acc_03", name: "bot-news", isBot: true, publicKey: "ed25519:CCCC", createdAt: "2025-03-10T00:00:00Z", moderation: null },
  ];

  const profiles: Profile[] = [
    { accountId: "acc_01", nanoid: "prof_01", displayName: "Alice Wonderland", summary: "Exploring the rabbit hole of federated social networks.", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=alice", bannerUrl: "https://picsum.photos/seed/alice/800/200", username: "alice" },
    { accountId: "acc_02", nanoid: "prof_02", displayName: "Bob Builder", summary: "Can we fix it? Yes we can!", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=bob", bannerUrl: null, username: null },
    { accountId: "acc_03", nanoid: "prof_03", displayName: "News Bot", summary: "Automated news aggregator.", iconUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=bot", bannerUrl: null, username: "bot-news" },
  ];

  const metadata: Metadata[] = [
    { accountId: "acc_01", nanoid: "meta_01", label: "Website", content: "https://alice.example.com" },
    { accountId: "acc_01", nanoid: "meta_02", label: "Pronouns", content: "she/her" },
    { accountId: "acc_02", nanoid: "meta_03", label: "GitHub", content: "https://github.com/bob" },
  ];

  /**
   * username は削除済み Profile を含めて再利用できない (Emumet は追記専用の event 列で一意を保証する)。
   * このストアは Profile を削除しないので、使用済み集合は縮まない。
   */
  const usedUsernames = new Set<string>(profiles.flatMap((p) => (p.username === null ? [] : [p.username])));

  /** Account の Profile 参照は Profile ストアから都度導出する (移管・設定が即座に反映される) */
  function withIdentity(account: StoredAccount): Account {
    const profile = profiles.find((p) => p.accountId === account.id);
    return { ...account, profileId: profile?.nanoid ?? null, profileUsername: profile?.username ?? null };
  }

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
    profileIdentityControl: {
      transferProfile(profileId: string, toAccountId: string): void {
        const profile = profiles.find((p) => p.nanoid === profileId);
        if (!profile) throw new EmumetNotFoundError(`profile not found: profileId=${profileId}`);
        if (!accounts.some((a) => a.id === toAccountId)) {
          throw new EmumetNotFoundError(`account not found: accountId=${toAccountId}`);
        }
        profiles[profiles.indexOf(profile)] = { ...profile, accountId: toAccountId };
      },
      setModeration(accountId: string, moderation: Moderation | null): void {
        const idx = accounts.findIndex((a) => a.id === accountId);
        if (idx < 0) throw new EmumetNotFoundError(`account not found: accountId=${accountId}`);
        accounts[idx] = { ...(accounts[idx] as StoredAccount), moderation };
      },
    },
    async listAccounts(): Promise<AccountConnection> {
      return { items: accounts.map(withIdentity), first: null, last: null };
    },

    async getAccount(id: string): Promise<Account | null> {
      const found = accounts.find((a) => a.id === id);
      return found ? withIdentity(found) : null;
    },

    async createAccount(input: CreateAccountInput): Promise<Account> {
      // 上流と同じく、副作用 (Account・Profile の作成) の前に username を拒否する
      if (input.username !== undefined) {
        const violation = checkProfileUsername(input.username);
        if (violation !== null) throw new EmumetUsernameInvalidError(violation);
        if (usedUsernames.has(input.username)) throw new EmumetUsernameTakenError();
      }
      const id = "acc_" + nextId();
      const account: StoredAccount = {
        id,
        name: input.name,
        isBot: input.isBot ?? false,
        publicKey: "ed25519:MOCK_" + id,
        createdAt: new Date().toISOString(),
        moderation: null,
      };
      accounts.push(account);
      // 実 API (create_account) は username の有無に関わらず Account と同時に Profile を作り、初期表示名は Account 名にする
      if (input.username !== undefined) usedUsernames.add(input.username);
      profiles.push({
        accountId: id,
        nanoid: "prof_" + nextId(),
        displayName: input.name,
        summary: null,
        iconUrl: null,
        bannerUrl: null,
        username: input.username ?? null,
      });
      return withIdentity(account);
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
          username: null,
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
        username: existing.username,
      };
      profiles[idx] = updated;
      return updated;
    },

    async setProfileUsername(profileId: string, username: string): Promise<Profile> {
      // 上流の検証順: 形式・予約語 (400) → 対象 (404) → 停止中 (422) → 設定済み・重複 (409)
      const violation = checkProfileUsername(username);
      if (violation !== null) throw new EmumetUsernameInvalidError(violation);
      const idx = profiles.findIndex((p) => p.nanoid === profileId);
      if (idx < 0) throw new EmumetNotFoundError(`profile not found: profileId=${profileId}`);
      const existing = profiles[idx] as Profile;
      const owner = accounts.find((a) => a.id === existing.accountId);
      if (owner?.moderation) throw new EmumetAccountRestrictedError();
      if (existing.username !== null) throw new EmumetUsernameAlreadySetError();
      if (usedUsernames.has(username)) throw new EmumetUsernameTakenError();
      usedUsernames.add(username);
      const updated: Profile = { ...existing, username };
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
