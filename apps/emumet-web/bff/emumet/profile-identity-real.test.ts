// ============================================================
// RealEmumetClient の Profile username 契約テスト (global fetch stub)
//  (a) 作成: profile_username を必ず (指定時) 送り、省略時は送らない。Account の profile_id / profile_username 変換
//  (b) 一回限り設定: POST /api/v1/profiles/{nanoid}/username の method/path/body・200 の契約検証・
//      エラー種別の写像 (400 形式/予約語・409 重複/設定済み/判別不能・422・404・401/403・一時障害・契約違反)
//  (d) リクエスト/レスポンス fixture が固定した OpenAPI に適合する
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { createRealEmumetClient } from "./real.ts";
import {
  EmumetAccountRestrictedError,
  EmumetApiError,
  EmumetNotFoundError,
  EmumetUsernameAlreadySetError,
  EmumetUsernameConflictError,
  EmumetUsernameInvalidError,
  EmumetUsernameTakenError,
  type EmumetClient,
} from "./client.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./registration-gate.ts";
import { violationsForSchema } from "../openapi/contract.ts";
import { jsonResponse, stubFetch } from "../test-utils.ts";

const BASE = "http://emumet.test";
const ACCOUNTS = `${BASE}/api/v1/accounts`;
const SET_PATH = "/api/v1/profiles/prof_01/username";

function makeClient(): EmumetClient {
  return createRealEmumetClient({ baseUrl: BASE }, "tok");
}

/** AccountResponse (OpenAPI を満たす最小形。契約に無い public_key は含めない) */
const wireAccount = {
  id: "acc_01",
  name: "alice",
  is_bot: false,
  fields: [],
  created_at: "2025-01-15T09:00:00Z",
  moderation: null,
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

function plain(status: number, body = ""): Response {
  return new Response(body, { status });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("(a) createAccount / Account の Profile 参照", () => {
  test("username 指定: profile_username を name・is_bot と同じ body で送り、成功 body を変換する", async () => {
    const { calls } = stubFetch(() => jsonResponse(201, { ...wireAccount, profile_id: "prof_01", profile_username: "alice" }));
    const account = await makeClient().createAccount({ name: "alice", username: "alice" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(ACCOUNTS);
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ name: "alice", is_bot: false, profile_username: "alice" });
    expect(account.profileId).toBe("prof_01");
    expect(account.profileUsername).toBe("alice");
  });

  test("username 省略: profile_username は body に含めない (null も送らない)", async () => {
    const { calls } = stubFetch(() => jsonResponse(201, wireAccount));
    await makeClient().createAccount({ name: "alice", isBot: true });
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ name: "alice", is_bot: true });
  });

  test("AccountResponse に profile_id / profile_username が無い (未実装の Emumet) → null (未取得) として扱う", async () => {
    stubFetch(() => jsonResponse(200, { items: [wireAccount], first: null, last: null }));
    const { items } = await makeClient().listAccounts();
    expect(items[0]?.profileId).toBeNull();
    expect(items[0]?.profileUsername).toBeNull();
  });

  test("profile_id あり・profile_username null → 未設定 (profileId だけ非 null)、値あり → そのまま", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        items: [
          { ...wireAccount, profile_id: "prof_01", profile_username: null },
          { ...wireAccount, id: "acc_02", profile_id: "prof_02", profile_username: "bob" },
        ],
        first: null,
        last: null,
      }),
    );
    const { items } = await makeClient().listAccounts();
    expect([items[0]?.profileId, items[0]?.profileUsername]).toEqual(["prof_01", null]);
    expect([items[1]?.profileId, items[1]?.profileUsername]).toEqual(["prof_02", "bob"]);
  });

  test("listProfiles: username 付き・無し (旧形式) のどちらも Profile.username に変換する", async () => {
    const wire = { account_id: "acc_01", nanoid: "prof_01", display_name: null, summary: null, icon_url: null, banner_url: null };
    stubFetch(() => jsonResponse(200, [{ ...wire, username: "alice" }, { ...wire, nanoid: "prof_02", account_id: "acc_02" }]));
    const profiles = await makeClient().listProfiles(["acc_01", "acc_02"]);
    expect(profiles.map((p) => p.username)).toEqual(["alice", null]);
  });

  test("baseUrl は origin: 末尾の / を除いて /api/v1 を連結する (作成・一回限り設定・409 再確認とも同じ設定で二重 prefix にならない)", async () => {
    const client = createRealEmumetClient({ baseUrl: `${BASE}/` }, "tok");
    const { calls } = stubFetch((call) =>
      call.url.endsWith("/username") ? plain(409) : call.method === "GET" ? jsonResponse(200, { items: [{ ...wireAccount, profile_id: "prof_01", profile_username: "alice" }], first: null, last: null }) : jsonResponse(201, wireAccount),
    );
    await client.createAccount({ name: "alice", username: "alice" });
    await rejection(client.setProfileUsername("prof_01", "bob"));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${ACCOUNTS}`,
      `POST ${BASE}/api/v1/profiles/prof_01/username`,
      `GET ${ACCOUNTS}`,
    ]);
  });

  test("作成の 400: 送った username が予約語なら Invalid(RESERVED)、形式違反なら Invalid(FORMAT)", async () => {
    stubFetch(() => plain(400, "username is reserved"));
    const reserved = await rejection(makeClient().createAccount({ name: "x", username: "admin" }));
    expect(reserved).toBeInstanceOf(EmumetUsernameInvalidError);
    expect((reserved as EmumetUsernameInvalidError).reason).toBe("RESERVED");
    const format = await rejection(makeClient().createAccount({ name: "x", username: "Alice" }));
    expect((format as EmumetUsernameInvalidError).reason).toBe("FORMAT");
  });

  test("作成の 400: username が規則上は有効なら種別を推測せず EmumetApiError(400)、username 無しの 400 も従来どおり", async () => {
    stubFetch(() => plain(400, "name too long"));
    const valid = await rejection(makeClient().createAccount({ name: "x", username: "alice" }));
    expect(valid).toBeInstanceOf(EmumetApiError);
    expect((valid as EmumetApiError).status).toBe(400);
    const legacy = await rejection(makeClient().createAccount({ name: "x" }));
    expect(legacy).toBeInstanceOf(EmumetApiError);
  });

  test("作成の 409 (username 指定) は Taken、401/403 は握りつぶさず EmumetApiError のまま", async () => {
    stubFetch(() => plain(409));
    expect(await rejection(makeClient().createAccount({ name: "x", username: "alice" }))).toBeInstanceOf(EmumetUsernameTakenError);
    for (const status of [401, 403]) {
      stubFetch(() => plain(status));
      const error = await rejection(makeClient().createAccount({ name: "x", username: "alice" }));
      expect(error).toBeInstanceOf(EmumetApiError);
      expect((error as EmumetApiError).status).toBe(status);
    }
  });
});

describe("(b) setProfileUsername — 一回限り設定", () => {
  const okBody = { account_id: "acc_01", id: "prof_01", display_name: null, summary: null, icon_url: null, banner_url: null, username: "alice" };

  test("POST /api/v1/profiles/{nanoid}/username に {username} だけを Bearer 付きで送り、ProfileResponse を Profile に変換する", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, okBody));
    const profile = await makeClient().setProfileUsername("prof_01", "alice");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(`${BASE}${SET_PATH}`);
    expect(calls[0]?.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ username: "alice" });
    expect(profile).toEqual({
      nanoid: "prof_01",
      accountId: "acc_01",
      displayName: null,
      summary: null,
      iconUrl: null,
      bannerUrl: null,
      username: "alice",
    });
  });

  test("nanoid は path 用にエンコードされ、PUT/PATCH/DELETE は使われない (変更 API を持たない)", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, okBody));
    await makeClient().setProfileUsername("a/b c", "alice");
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/profiles/a%2Fb%20c/username`);
    expect(calls.every((call) => call.method === "POST")).toBe(true);
  });

  test("ProfileResponse の任意フィールドが省略されても null に正規化される", async () => {
    stubFetch(() => jsonResponse(200, { account_id: "acc_01", id: "prof_01", username: "alice" }));
    const profile = await makeClient().setProfileUsername("prof_01", "alice");
    expect([profile.displayName, profile.summary, profile.iconUrl, profile.bannerUrl]).toEqual([null, null, null, null]);
  });

  test("400: 予約語 → Invalid(RESERVED) / 形式違反 → Invalid(FORMAT) / 規則上は有効な値の 400 は EmumetApiError(400)", async () => {
    stubFetch(() => plain(400, "username is reserved"));
    expect(((await rejection(makeClient().setProfileUsername("prof_01", "root"))) as EmumetUsernameInvalidError).reason).toBe("RESERVED");
    stubFetch(() => plain(400, "x"));
    expect(((await rejection(makeClient().setProfileUsername("prof_01", "ALICE"))) as EmumetUsernameInvalidError).reason).toBe("FORMAT");
    const other = await rejection(makeClient().setProfileUsername("prof_01", "alice"));
    expect(other).toBeInstanceOf(EmumetApiError);
    expect((other as EmumetApiError).status).toBe(400);
  });

  test("409: 自分の Account で設定済みと確認できれば AlreadySet、未設定なら Taken", async () => {
    const accounts = (username: string | null) => ({
      items: [{ ...wireAccount, profile_id: "prof_01", profile_username: username }],
      first: null,
      last: null,
    });
    for (const [existing, expected] of [
      ["alice", EmumetUsernameAlreadySetError],
      [null, EmumetUsernameTakenError],
    ] as const) {
      const { calls } = stubFetch((call) => (call.method === "POST" ? plain(409) : jsonResponse(200, accounts(existing))));
      const error = await rejection(makeClient().setProfileUsername("prof_01", "bob"));
      expect(error).toBeInstanceOf(expected);
      expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    }
  });

  test("409 の分類は「現在の状態」に基づく (原因の証明ではない): 競合で別で設定済みになっていても、自分が送った値と同じ値でも AlreadySet", async () => {
    const accounts = (username: string) => ({ items: [{ ...wireAccount, profile_id: "prof_01", profile_username: username }], first: null, last: null });
    // 競合: 自分の要求が負け、別のセッションが先に別の値で設定済み
    stubFetch((call) => (call.method === "POST" ? plain(409) : jsonResponse(200, accounts("other"))));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "bob"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
    // 応答失敗後の再送: 先の成功で既に同じ値が設定済み
    stubFetch((call) => (call.method === "POST" ? plain(409) : jsonResponse(200, accounts("bob"))));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "bob"))).toBeInstanceOf(EmumetUsernameAlreadySetError);
  });

  test("409: 原因を確定できない場合は Conflict のまま (後の状態から Taken を推測しない経路: Profile を特定できない・所有者が変わった)", async () => {
    // 認可後に所有者が変わった (移管): 自分の Account 一覧にその Profile がもう無い → 重複とも設定済みとも言えない
    stubFetch((call) => (call.method === "POST" ? plain(409) : jsonResponse(200, { items: [{ ...wireAccount, profile_id: "prof_other", profile_username: null }], first: null, last: null })));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "bob"))).toBeInstanceOf(EmumetUsernameConflictError);
  });

  test("409: Profile を特定できない・profile_id が来ない・再確認に失敗 → 推測せず Conflict", async () => {
    stubFetch((call) => (call.method === "POST" ? plain(409) : jsonResponse(200, { items: [wireAccount], first: null, last: null })));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "bob"))).toBeInstanceOf(EmumetUsernameConflictError);
    stubFetch((call) => (call.method === "POST" ? plain(409) : plain(500)));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "bob"))).toBeInstanceOf(EmumetUsernameConflictError);
  });

  test("404 → EmumetNotFoundError / 422 → AccountRestricted / 401・403・500 は EmumetApiError で status を保つ", async () => {
    stubFetch(() => plain(404));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "alice"))).toBeInstanceOf(EmumetNotFoundError);
    stubFetch(() => plain(422));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "alice"))).toBeInstanceOf(EmumetAccountRestrictedError);
    for (const status of [401, 403, 500]) {
      stubFetch(() => plain(status, "upstream body"));
      const error = await rejection(makeClient().setProfileUsername("prof_01", "alice"));
      expect(error).toBeInstanceOf(EmumetApiError);
      expect((error as EmumetApiError).status).toBe(status);
    }
  });

  test("接続失敗は EmumetUnavailableError、200 の本文が契約違反・非 JSON は EmumetInvalidResponseError (成功扱いにしない)", async () => {
    Object.assign(globalThis, { fetch: () => Promise.reject(new TypeError("connection refused")) });
    expect(await rejection(makeClient().setProfileUsername("prof_01", "alice"))).toBeInstanceOf(EmumetUnavailableError);
    stubFetch(() => jsonResponse(200, { account_id: "acc_01", username: "alice" }));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "alice"))).toBeInstanceOf(EmumetInvalidResponseError);
    stubFetch(() => plain(200, "not json"));
    expect(await rejection(makeClient().setProfileUsername("prof_01", "alice"))).toBeInstanceOf(EmumetInvalidResponseError);
  });
});

describe("(d) 送受信 fixture は固定した OpenAPI 契約に適合する", () => {
  test("成功応答 fixture: AccountResponse (profile_id / profile_username あり・無し)・AccountsResponse が契約に適合する", () => {
    expect(violationsForSchema("AccountResponse", wireAccount)).toEqual([]);
    expect(violationsForSchema("AccountResponse", { ...wireAccount, profile_id: "prof_01", profile_username: null })).toEqual([]);
    expect(violationsForSchema("AccountsResponse", { items: [wireAccount], first: null, last: null })).toEqual([]);
    // 契約にある必須 (fields) が無い応答は不適合と判定される (fixture が緩いとこのテスト自体が無意味になるため)
    const { fields: _fields, ...withoutFields } = wireAccount;
    expect(violationsForSchema("AccountResponse", withoutFields)).not.toEqual([]);
  });

  test("リクエスト body: CreateAccountRequest (profile_username あり/なし)・SetProfileUsernameRequest", async () => {
    const { calls } = stubFetch((call) => (call.url.endsWith("/username") ? jsonResponse(200, { account_id: "a", id: "p", username: "alice" }) : jsonResponse(201, wireAccount)));
    await makeClient().createAccount({ name: "alice", username: "alice" });
    await makeClient().createAccount({ name: "alice" });
    await makeClient().setProfileUsername("prof_01", "alice");
    const [withUsername, without, set] = calls.map((call) => JSON.parse(call.body ?? "null"));
    expect(violationsForSchema("CreateAccountRequest", withUsername)).toEqual([]);
    expect(violationsForSchema("CreateAccountRequest", without)).toEqual([]);
    expect(violationsForSchema("SetProfileUsernameRequest", set)).toEqual([]);
  });

  test("規則に反する username は契約 (pattern・予約語以外) でも不正と判定される", () => {
    expect(violationsForSchema("SetProfileUsernameRequest", { username: "Alice" })).not.toEqual([]);
    expect(violationsForSchema("SetProfileUsernameRequest", { username: "a".repeat(65) })).not.toEqual([]);
    expect(violationsForSchema("SetProfileUsernameRequest", { username: "" })).not.toEqual([]);
  });

  test("ProfileResponse: username あり・null (未設定) のどちらも契約に適合する", () => {
    expect(violationsForSchema("ProfileResponse", { account_id: "a", id: "p", username: "alice" })).toEqual([]);
    expect(violationsForSchema("ProfileResponse", { account_id: "a", id: "p", username: null })).toEqual([]);
  });
});
