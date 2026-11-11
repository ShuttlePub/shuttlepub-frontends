// ============================================================
// MockEmumetClient の Profile username (stateful) — E8/P1 契約との照合
//  重複 (削除済み含め再利用不可)・予約語・形式・一回限り・設定済み表示・Profile 移管後の不変・停止中 Account
// ============================================================

import { describe, expect, test } from "bun:test";
import { createMockEmumetClient } from "./mock.ts";
import {
  EmumetAccountRestrictedError,
  EmumetNotFoundError,
  EmumetUsernameAlreadySetError,
  EmumetUsernameInvalidError,
  EmumetUsernameTakenError,
} from "./client.ts";
import { RESERVED_PROFILE_USERNAMES } from "./profile-username.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("fixture の初期状態", () => {
  test("設定済み (alice / bot-news) と未設定 (bob = 既存 Profile) が両方ある。Account の Profile 参照は Profile から導出される", async () => {
    const mock = createMockEmumetClient();
    const { items } = await mock.listAccounts();
    expect(items.map((a) => [a.id, a.profileId, a.profileUsername])).toEqual([
      ["acc_01", "prof_01", "alice"],
      ["acc_02", "prof_02", null],
      ["acc_03", "prof_03", "bot-news"],
    ]);
    expect((await mock.getProfile("acc_02"))?.username).toBeNull();
    expect((await mock.getAccount("acc_01"))?.profileUsername).toBe("alice");
  });
});

describe("一回限りの設定", () => {
  test("未設定の Profile に設定でき、以後は Account・Profile のどちらからも設定済みとして見える", async () => {
    const mock = createMockEmumetClient();
    const profile = await mock.setProfileUsername("prof_02", "bob");
    expect(profile.username).toBe("bob");
    expect((await mock.getProfile("acc_02"))?.username).toBe("bob");
    expect((await mock.getAccount("acc_02"))?.profileUsername).toBe("bob");
  });

  test("設定済みの Profile への再設定は (同じ値でも別の値でも) AlreadySet で、値は変わらない", async () => {
    const mock = createMockEmumetClient();
    await mock.setProfileUsername("prof_02", "bob");
    expect(await rejection(mock.setProfileUsername("prof_02", "robert"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
    expect(await rejection(mock.setProfileUsername("prof_02", "bob"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
    expect(await rejection(mock.setProfileUsername("prof_01", "other"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
    expect((await mock.getProfile("acc_02"))?.username).toBe("bob");
    expect((await mock.getProfile("acc_01"))?.username).toBe("alice");
  });

  test("他の Profile が使用中の値は Taken (未設定のままで、別の値で後から設定できる)", async () => {
    const mock = createMockEmumetClient();
    expect(await rejection(mock.setProfileUsername("prof_02", "alice"))).toBeInstanceOf(EmumetUsernameTakenError);
    expect((await mock.getProfile("acc_02"))?.username).toBeNull();
    expect((await mock.setProfileUsername("prof_02", "bob")).username).toBe("bob");
  });

  test("形式違反は FORMAT、予約語 17 語は RESERVED。暗黙の trim・小文字化をしない。状態は変わらない", async () => {
    const mock = createMockEmumetClient();
    for (const value of ["Alice", " bob", "bob ", "", "a".repeat(65)]) {
      const error = await rejection(mock.setProfileUsername("prof_02", value));
      expect(error, JSON.stringify(value)).toBeInstanceOf(EmumetUsernameInvalidError);
      expect((error as EmumetUsernameInvalidError).reason).toBe("FORMAT");
    }
    for (const word of RESERVED_PROFILE_USERNAMES) {
      const error = await rejection(mock.setProfileUsername("prof_02", word));
      expect((error as EmumetUsernameInvalidError).reason, word).toBe("RESERVED");
    }
    expect((await mock.getProfile("acc_02"))?.username).toBeNull();
  });

  test("存在しない Profile は NotFound。検証 (400) は対象の存在確認 (404) より先", async () => {
    const mock = createMockEmumetClient();
    expect(await rejection(mock.setProfileUsername("prof_missing", "bob"))).toBeInstanceOf(EmumetNotFoundError);
    expect(await rejection(mock.setProfileUsername("prof_missing", "Bob"))).toBeInstanceOf(EmumetUsernameInvalidError);
  });

  test("停止中・BAN 中の Account の Profile には設定できない (AccountRestricted)。解除後は設定できる", async () => {
    const mock = createMockEmumetClient();
    mock.profileIdentityControl.setModeration("acc_02", {
      type: "SUSPENDED",
      reason: "spam",
      suspendedAt: "2025-06-01T00:00:00Z",
      expiresAt: null,
      bannedAt: null,
    });
    expect(await rejection(mock.setProfileUsername("prof_02", "bob"))).toBeInstanceOf(EmumetAccountRestrictedError);
    mock.profileIdentityControl.setModeration("acc_02", null);
    expect((await mock.setProfileUsername("prof_02", "bob")).username).toBe("bob");
  });
});

describe("作成時の username", () => {
  test("username 付きの作成は Account と Profile を一緒に作り、username は Account 名と独立している", async () => {
    const mock = createMockEmumetClient();
    const account = await mock.createAccount({ name: "Carol Display", username: "carol" });
    expect(account.name).toBe("Carol Display");
    expect(account.profileUsername).toBe("carol");
    expect(account.profileId).not.toBeNull();
    const profile = await mock.getProfile(account.id);
    expect(profile?.username).toBe("carol");
    expect(profile?.nanoid).toBe(account.profileId as string);
  });

  test("username 省略の作成 (旧経路) は Profile を作らず、Profile 参照は null", async () => {
    const mock = createMockEmumetClient();
    const account = await mock.createAccount({ name: "carol" });
    expect([account.profileId, account.profileUsername]).toEqual([null, null]);
    expect(await mock.getProfile(account.id)).toBeNull();
  });

  test("重複・予約語・形式違反は副作用前に拒否され、Account は増えない", async () => {
    const mock = createMockEmumetClient();
    const before = (await mock.listAccounts()).items.length;
    expect(await rejection(mock.createAccount({ name: "x", username: "alice" }))).toBeInstanceOf(EmumetUsernameTakenError);
    expect(((await rejection(mock.createAccount({ name: "x", username: "admin" }))) as EmumetUsernameInvalidError).reason).toBe("RESERVED");
    expect(((await rejection(mock.createAccount({ name: "x", username: "Carol" }))) as EmumetUsernameInvalidError).reason).toBe("FORMAT");
    expect((await mock.listAccounts()).items).toHaveLength(before);
  });

  test("作成で使った username は、同じ値を後から別 Profile に設定できない (一意)", async () => {
    const mock = createMockEmumetClient();
    await mock.createAccount({ name: "carol", username: "carol" });
    expect(await rejection(mock.setProfileUsername("prof_02", "carol"))).toBeInstanceOf(EmumetUsernameTakenError);
  });
});

describe("Profile 移管でも username は変わらない", () => {
  test("移管先の Account 名・移管元に依存せず、Profile の username・nanoid が維持される", async () => {
    const mock = createMockEmumetClient();
    const org = await mock.createAccount({ name: "Org Account" });
    mock.profileIdentityControl.transferProfile("prof_01", org.id);
    const moved = await mock.getProfile(org.id);
    expect(moved).toMatchObject({ nanoid: "prof_01", username: "alice", accountId: org.id });
    expect((await mock.getAccount(org.id))?.profileUsername).toBe("alice");
    expect(moved?.username).not.toBe(org.name);
    expect(await mock.getProfile("acc_01")).toBeNull();
    expect([(await mock.getAccount("acc_01"))?.profileId, (await mock.getAccount("acc_01"))?.profileUsername]).toEqual([null, null]);
  });

  test("移管後も username は変更できず、他の Profile へも移らない (AlreadySet / Taken)", async () => {
    const mock = createMockEmumetClient();
    const org = await mock.createAccount({ name: "Org Account" });
    mock.profileIdentityControl.transferProfile("prof_01", org.id);
    expect(await rejection(mock.setProfileUsername("prof_01", "renamed"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
    expect(await rejection(mock.setProfileUsername("prof_02", "alice"))).toBeInstanceOf(EmumetUsernameTakenError);
  });

  test("移管先に既に Profile がある・対象が無い場合は拒否する", async () => {
    const mock = createMockEmumetClient();
    expect(() => mock.profileIdentityControl.transferProfile("prof_01", "acc_02")).toThrow();
    expect(() => mock.profileIdentityControl.transferProfile("prof_missing", "acc_02")).toThrow(EmumetNotFoundError);
    expect(() => mock.profileIdentityControl.transferProfile("prof_01", "acc_missing")).toThrow(EmumetNotFoundError);
  });
});
