// ============================================================
// (e) DataLoader batch 契約テスト
// バッチ応答を keys と逆順 + 欠損キー混在で返す fake client に対し:
//   - 各キーに正しい値が対応する
//   - 返却配列が keys と同長
//   - 欠損キーは profile → null / metadata → []
//   - listProfiles/listMetadata は keys 全件で 1 回だけ呼ばれる (バッチング)
// ============================================================

import { describe, expect, test } from "bun:test";
import { makeLoaders } from "./loaders.ts";
import type { EmumetClient, Metadata, Profile } from "./emumet/client.ts";

function notUsed(name: string): never {
  throw new Error(`${name} must not be called by loaders`);
}

type BatchOverrides = {
  listProfiles: (ids: readonly string[]) => Promise<readonly Profile[]>;
  listMetadata: (ids: readonly string[]) => Promise<readonly Metadata[]>;
};

// loaders が使う 2 メソッド以外は呼ばれたら即失敗する fake
function fakeEmumetClient(overrides: BatchOverrides): EmumetClient {
  return {
    listAccounts: () => notUsed("listAccounts"),
    getAccount: () => notUsed("getAccount"),
    createAccount: () => notUsed("createAccount"),
    getProfile: () => notUsed("getProfile"),
    upsertProfile: () => notUsed("upsertProfile"),
    setProfileUsername: () => notUsed("setProfileUsername"),
    createMetadata: () => notUsed("createMetadata"),
    updateMetadata: () => notUsed("updateMetadata"),
    deleteMetadata: () => notUsed("deleteMetadata"),
    getRegistrationGate: () => notUsed("getRegistrationGate"),
    openRegistrationGate: () => notUsed("openRegistrationGate"),
    closeRegistrationGate: () => notUsed("closeRegistrationGate"),
    enableRegistrationGateOverride: () => notUsed("enableRegistrationGateOverride"),
    revokeRegistrationGateOverride: () => notUsed("revokeRegistrationGateOverride"),
    listRegistrationGateNotifications: () => notUsed("listRegistrationGateNotifications"),
    countUnreadRegistrationGateNotifications: () => notUsed("countUnreadRegistrationGateNotifications"),
    markRegistrationGateNotificationsRead: () => notUsed("markRegistrationGateNotificationsRead"),
    markAllRegistrationGateNotificationsRead: () => notUsed("markAllRegistrationGateNotificationsRead"),
    ...overrides,
  };
}

const profile1: Profile = {
  nanoid: "prof_k1",
  accountId: "k1",
  displayName: "One",
  summary: null,
  iconUrl: null,
  bannerUrl: null,
  username: null,
};
const profile2: Profile = {
  nanoid: "prof_k2",
  accountId: "k2",
  displayName: "Two",
  summary: "s2",
  iconUrl: null,
  bannerUrl: null,
  username: null,
};
const meta1: Metadata = { nanoid: "m1", accountId: "k1", label: "l1", content: "c1" };
const meta2a: Metadata = { nanoid: "m2a", accountId: "k2", label: "l2a", content: "c2a" };
const meta2b: Metadata = { nanoid: "m2b", accountId: "k2", label: "l2b", content: "c2b" };

function makeReversedBatchClient(calls: { profile: string[][]; metadata: string[][] }): EmumetClient {
  return fakeEmumetClient({
    listProfiles: (ids) => {
      calls.profile.push([...ids]);
      // keys [k1,k2,k3] に対し逆順 + k3 欠損で返す
      return Promise.resolve([profile2, profile1]);
    },
    listMetadata: (ids) => {
      calls.metadata.push([...ids]);
      // 逆順・グループ混在 + k3 欠損で返す
      return Promise.resolve([meta2b, meta1, meta2a]);
    },
  });
}

describe("(e) DataLoader batch contract", () => {
  test("profile loader realigns reversed batch response and maps missing key to null", async () => {
    // Given: keys [k1,k2,k3]、応答は逆順 [k2,k1] で k3 欠損
    const calls = { profile: [] as string[][], metadata: [] as string[][] };
    const loaders = makeLoaders(makeReversedBatchClient(calls));
    // When: 3 キーを一括 load
    const results = await loaders.profile.loadMany(["k1", "k2", "k3"]);
    // Then: keys と同長、各キーに正しい値、欠損は該当位置が null
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual(profile1);
    expect(results[1]).toEqual(profile2);
    expect(results[2]).toBeNull();
    // And: バッチは keys 全件でちょうど 1 回
    expect(calls.profile).toEqual([["k1", "k2", "k3"]]);
  });

  test("metadata loader realigns reversed batch response and maps missing key to []", async () => {
    // Given: 同上 (k2 に 2 件、k1 に 1 件、k3 欠損)
    const calls = { profile: [] as string[][], metadata: [] as string[][] };
    const loaders = makeLoaders(makeReversedBatchClient(calls));
    // When
    const results = await loaders.metadata.loadMany(["k1", "k2", "k3"]);
    // Then: keys と同長、グルーピング正対応、欠損は []
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual([meta1]);
    // グループ内順序は応答の出現順 (meta2b が先) を維持する
    expect(results[1]).toEqual([meta2b, meta2a]);
    expect(results[2]).toEqual([]);
    expect(calls.metadata).toEqual([["k1", "k2", "k3"]]);
  });

  test("separate load() calls in the same tick are batched into one listProfiles call", async () => {
    // Given: 同一 loader インスタンス
    const calls = { profile: [] as string[][], metadata: [] as string[][] };
    const loaders = makeLoaders(makeReversedBatchClient(calls));
    // When: 同一 tick で個別 load
    const [r1, r2] = await Promise.all([loaders.profile.load("k1"), loaders.profile.load("k2")]);
    // Then: 1 回のバッチにまとまり各キーに正対応
    expect(r1).toEqual(profile1);
    expect(r2).toEqual(profile2);
    expect(calls.profile).toEqual([["k1", "k2"]]);
  });
});
