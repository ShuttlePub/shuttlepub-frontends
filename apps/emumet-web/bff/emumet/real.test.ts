// ============================================================
// (f) RealEmumetClient REST 契約テスト — global fetch を stub し、
//     全メソッドの HTTP method/path/query/body/Authorization と
//     snake_case → camelCase 変換を検証する
// (c) Tristate 変換 — undefined → フィールド省略 / null → JSON null / 値 → 値
// (d) 204 → 再フェッチ — upsertProfile (PUT/POST) / updateMetadata で
//     書込み後に GET が続くことを呼出順序で検証する
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { createRealEmumetClient } from "./real.ts";
import { EmumetApiError, EmumetNotFoundError, EmumetUnsupportedError, type EmumetClient } from "./client.ts";
import { violationsForSchema } from "../openapi/contract.ts";
import { jsonResponse, stubFetch, type FetchCall } from "../test-utils.ts";

const BASE = "http://emumet.test";
const TOKEN = "test-access-token";

function makeClient(): EmumetClient {
  return createRealEmumetClient({ baseUrl: BASE }, TOKEN);
}

// ワイヤ fixture (snake_case)
const wireAccount1 = {
  id: "acc_01",
  name: "alice",
  is_bot: false,
  created_at: "2025-01-15T09:00:00Z",
  moderation: null,
  profile_id: "prof_01",
  profile_username: "alice",
  display_name: "Alice",
  summary: "hello",
  icon_url: "https://icon.example.com/a",
  banner_url: null,
  fields: [
    { label: "Website", content: "https://alice.example.com" },
    { label: "Pronouns", content: "she/her" },
  ],
};
const wireAccountSuspended = {
  ...wireAccount1,
  id: "acc_s",
  moderation: { type: "suspended", reason: "spam", suspended_at: "2025-06-01T00:00:00Z", expires_at: "2025-07-01T00:00:00Z" },
};
const wireAccountBanned = {
  ...wireAccount1,
  id: "acc_b",
  moderation: { type: "banned", reason: "tos", banned_at: "2025-06-02T00:00:00Z" },
};
function unexpected(call: FetchCall): never {
  throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

describe("(f) REST contract — method/path/query/body/Authorization", () => {
  test("listAccounts: GET /api/v1/accounts with Bearer token, converts snake_case → camelCase incl. moderation", async () => {
    // Given: 3 アカウント (moderation: null / suspended / banned)
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${BASE}/api/v1/accounts`);
      return jsonResponse(200, { items: [wireAccount1, wireAccountSuspended, wireAccountBanned], first: "acc_01", last: "acc_b" });
    });
    // When
    const result = await makeClient().listAccounts();
    // Then: connection shape + camelCase 変換 + moderation マッピング
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers["Content-Type"]).toBeUndefined();
    expect(calls[0]?.body).toBeUndefined();
    expect(result.first).toBe("acc_01");
    expect(result.last).toBe("acc_b");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual({
      id: "acc_01",
      name: "alice",
      isBot: false,
      publicKey: "",
      createdAt: "2025-01-15T09:00:00Z",
      moderation: null,
      profileId: "prof_01",
      profileUsername: "alice",
    });
    expect(result.items[1]?.moderation).toEqual({
      type: "SUSPENDED",
      reason: "spam",
      suspendedAt: "2025-06-01T00:00:00Z",
      expiresAt: "2025-07-01T00:00:00Z",
      bannedAt: null,
    });
    expect(result.items[2]?.moderation).toEqual({
      type: "BANNED",
      reason: "tos",
      suspendedAt: null,
      expiresAt: null,
      bannedAt: "2025-06-02T00:00:00Z",
    });
  });

  test("listAccounts: 404 \"No accounts found\" is normalized to empty connection", async () => {
    // Given: Emumet は 0 件時に 404 を返す
    stubFetch(() => new Response("No accounts found", { status: 404 }));
    // When
    const result = await makeClient().listAccounts();
    // Then: 空 connection に正規化 (throw しない)
    expect(result).toEqual({ items: [], first: null, last: null });
  });

  test("getAccount: GET /api/v1/accounts?ids=<id> returns first item converted", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      return jsonResponse(200, { items: [wireAccount1], first: null, last: null });
    });
    // When
    const result = await makeClient().getAccount("acc_01");
    // Then: ids クエリで 1 件取得
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/accounts?ids=acc_01`);
    expect(result?.id).toBe("acc_01");
    expect(result?.isBot).toBe(false);
  });

  test("getAccount: 404 → null", async () => {
    // Given / When
    stubFetch(() => new Response("not found", { status: 404 }));
    const result = await makeClient().getAccount("nope");
    // Then
    expect(result).toBeNull();
  });

  test("getAccount: 200 with empty items → null", async () => {
    // Given / When
    stubFetch(() => jsonResponse(200, { items: [], first: null, last: null }));
    const result = await makeClient().getAccount("nope");
    // Then
    expect(result).toBeNull();
  });

  test("createAccount: POST /api/v1/accounts with snake_case body, isBot omitted → is_bot false", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("POST");
      expect(call.url).toBe(`${BASE}/api/v1/accounts`);
      return jsonResponse(201, wireAccount1);
    });
    // When
    const result = await makeClient().createAccount({ name: "alice" });
    // Then: body は snake_case、is_bot デフォルト false、Content-Type 付き
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ name: "alice", is_bot: false });
    expect(result.id).toBe("acc_01");
  });

  test("createAccount: isBot true is sent as is_bot true", async () => {
    // Given / When
    const { calls } = stubFetch(() => jsonResponse(201, wireAccountBanned));
    await makeClient().createAccount({ name: "bot", isBot: true });
    // Then
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ name: "bot", is_bot: true });
  });

  test("listProfiles: GET /api/v1/accounts?ids=a,b — Profile は AccountResponse の profile_id・display_name・summary・icon_url・banner_url・profile_username から作る", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      return jsonResponse(200, { items: [wireAccount1], first: null, last: null });
    });
    // When
    const result = await makeClient().listProfiles(["acc_01", "acc_02"]);
    // Then: バッチパラメータ (カンマ連結)。旧 /profiles は呼ばない
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/accounts?ids=acc_01,acc_02`);
    expect(result).toEqual([
      {
        nanoid: "prof_01",
        accountId: "acc_01",
        displayName: "Alice",
        summary: "hello",
        iconUrl: "https://icon.example.com/a",
        bannerUrl: null,
        username: "alice",
      },
    ]);
  });

  test("listProfiles: 404 \"No accounts found\" → []、empty ids → no fetch", async () => {
    stubFetch(() => new Response("No accounts found", { status: 404 }));
    expect(await makeClient().listProfiles(["acc_01"])).toEqual([]);
    const { calls } = stubFetch(unexpected);
    expect(await makeClient().listProfiles([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("getProfile: 先頭の Profile / 無ければ null", async () => {
    stubFetch(() => jsonResponse(200, { items: [wireAccount1], first: null, last: null }));
    expect((await makeClient().getProfile("acc_01"))?.nanoid).toBe("prof_01");
    stubFetch(() => jsonResponse(200, { items: [], first: null, last: null }));
    expect(await makeClient().getProfile("nope")).toBeNull();
  });

  test("Profile の username は profile_username (未設定は null)。Account 名からは導出しない", async () => {
    stubFetch(() => jsonResponse(200, { items: [{ ...wireAccount1, profile_username: null }], first: null, last: null }));
    const profile = await makeClient().getProfile("acc_01");
    expect(profile?.username).toBeNull();
    expect(profile?.displayName).toBe("Alice");
  });

  test("listMetadata: GET /api/v1/accounts?ids=a,b — fields[index] を {nanoid: index, label, content} にする", async () => {
    // Given
    const { calls } = stubFetch(() => jsonResponse(200, { items: [wireAccount1, wireAccountSuspended], first: null, last: null }));
    // When
    const result = await makeClient().listMetadata(["acc_01", "acc_s"]);
    // Then
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/accounts?ids=acc_01,acc_s`);
    expect(result).toEqual([
      { nanoid: "0", accountId: "acc_01", label: "Website", content: "https://alice.example.com" },
      { nanoid: "1", accountId: "acc_01", label: "Pronouns", content: "she/her" },
      { nanoid: "0", accountId: "acc_s", label: "Website", content: "https://alice.example.com" },
      { nanoid: "1", accountId: "acc_s", label: "Pronouns", content: "she/her" },
    ]);
  });

  test("listMetadata: empty ids → no fetch、fields が空なら []", async () => {
    const { calls } = stubFetch(unexpected);
    expect(await makeClient().listMetadata([])).toEqual([]);
    expect(calls).toHaveLength(0);
    stubFetch(() => jsonResponse(200, { items: [{ ...wireAccount1, fields: [] }], first: null, last: null }));
    expect(await makeClient().listMetadata(["acc_01"])).toEqual([]);
  });
});

// 書込みは PATCH /api/v1/accounts/{id} だけ。fields は配列ごと置換、Profile 属性は Tristate (省略=変更なし / null=クリア)
describe("(c) upsertProfile — Tristate 変換 (PATCH)", () => {
  test("PATCH /api/v1/accounts/{id}: 値はそのまま、null は JSON null、undefined は省略。戻り値は応答の Profile", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("PATCH");
      return jsonResponse(200, { ...wireAccount1, display_name: "Alicia", summary: null });
    });
    // When: displayName=値, summary=null (クリア), iconUrl/bannerUrl=undefined (省略)
    const result = await makeClient().upsertProfile("acc_01", { displayName: "Alicia", summary: null });
    // Then: 1 回の PATCH だけ (旧 GET → PUT/POST → GET は無い)
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/accounts/acc_01`);
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(calls[0]?.body ?? "") as Record<string, unknown>;
    expect(body).toEqual({ display_name: "Alicia", summary: null });
    expect("icon_url" in body).toBe(false);
    expect("banner_url" in body).toBe(false);
    expect(result.nanoid).toBe("prof_01");
    expect(result.displayName).toBe("Alicia");
    expect(result.summary).toBeNull();
  });

  test("icon_url / banner_url も同じ規則で送る。404 → EmumetNotFoundError、400 は EmumetApiError", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, wireAccount1));
    await makeClient().upsertProfile("acc_01", { iconUrl: "https://i.example.com/x", bannerUrl: null });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ icon_url: "https://i.example.com/x", banner_url: null });
    stubFetch(() => new Response("", { status: 404 }));
    await expect(makeClient().upsertProfile("nope", { summary: "x" })).rejects.toBeInstanceOf(EmumetNotFoundError);
    stubFetch(() => new Response("bad", { status: 400 }));
    await expect(makeClient().upsertProfile("acc_01", { summary: "x" })).rejects.toBeInstanceOf(EmumetApiError);
  });
});

describe("(d) Metadata の書込み — fields の読み出し → 加工 → PATCH (配列ごと置換)", () => {
  const twoFields = [
    { label: "Website", content: "https://alice.example.com" },
    { label: "Pronouns", content: "she/her" },
  ];

  /** GET は現在の fields、PATCH は送られた fields を反映した AccountResponse を返す */
  function stubAccountWithFields(current: { label: string; content: string }[]): { calls: FetchCall[] } {
    return stubFetch((call) => {
      if (call.method === "GET") return jsonResponse(200, { items: [{ ...wireAccount1, fields: current }], first: null, last: null });
      if (call.method === "PATCH") return jsonResponse(200, { ...wireAccount1, fields: (JSON.parse(call.body ?? "{}") as { fields: unknown }).fields });
      return unexpected(call);
    });
  }

  test("createMetadata: 末尾に追加した fields を PATCH し、追加した 1 件 (nanoid = 末尾の index) を返す", async () => {
    const { calls } = stubAccountWithFields(twoFields);
    const result = await makeClient().createMetadata("acc_01", { label: "Blog", content: "https://blog.example.com" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["GET /api/v1/accounts", "PATCH /api/v1/accounts/acc_01"]);
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ fields: [...twoFields, { label: "Blog", content: "https://blog.example.com" }] });
    expect(result).toEqual({ nanoid: "2", accountId: "acc_01", label: "Blog", content: "https://blog.example.com" });
  });

  test("updateMetadata: 指定 index だけ置換した fields を PATCH し、同じ nanoid で返す (他の項目は不変)", async () => {
    const { calls } = stubAccountWithFields(twoFields);
    const result = await makeClient().updateMetadata("acc_01", "1", { label: "Pronouns", content: "they/them" });
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ fields: [twoFields[0], { label: "Pronouns", content: "they/them" }] });
    expect(result).toEqual({ nanoid: "1", accountId: "acc_01", label: "Pronouns", content: "they/them" });
  });

  test("deleteMetadata は未対応 (EmumetUnsupportedError)。位置 ID が繰り上がり別の項目を書き換えうるため、何も送らない", async () => {
    const { calls } = stubAccountWithFields(twoFields);
    await expect(makeClient().deleteMetadata("acc_01", "0")).rejects.toBeInstanceOf(EmumetUnsupportedError);
    expect(calls).toHaveLength(0);
  });

  test("範囲外・非整数の nanoid (旧形式 meta_xx を含む) は書込みせず EmumetNotFoundError", async () => {
    for (const nanoid of ["2", "-1", "01", "1.5", "meta_01", ""]) {
      const { calls } = stubAccountWithFields(twoFields);
      await expect(makeClient().updateMetadata("acc_01", nanoid, { label: "L", content: "C" })).rejects.toBeInstanceOf(EmumetNotFoundError);
      expect(calls.every((c) => c.method === "GET"), JSON.stringify(nanoid)).toBe(true);
    }
  });

  test("Account が見えない (一覧に無い) 場合の書込みは EmumetNotFoundError で PATCH しない", async () => {
    const { calls } = stubFetch(() => new Response("No accounts found", { status: 404 }));
    await expect(makeClient().createMetadata("nope", { label: "L", content: "C" })).rejects.toBeInstanceOf(EmumetNotFoundError);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("PATCH が 400 なら EmumetApiError (握りつぶさない)", async () => {
    stubFetch((call) => (call.method === "GET" ? jsonResponse(200, { items: [wireAccount1], first: null, last: null }) : new Response("bad", { status: 400 })));
    await expect(makeClient().createMetadata("acc_01", { label: "L", content: "C" })).rejects.toBeInstanceOf(EmumetApiError);
  });
});

describe("固定した OpenAPI 契約への適合 (fixture は AccountResponse を満たす)", () => {
  test("AccountResponse fixture と AccountsResponse が契約に適合し、PATCH body は UpdateAccountRequest に適合する", () => {
    expect(violationsForSchema("AccountResponse", wireAccount1)).toEqual([]);
    expect(violationsForSchema("AccountResponse", wireAccountSuspended)).toEqual([]);
    expect(violationsForSchema("AccountResponse", wireAccountBanned)).toEqual([]);
    expect(violationsForSchema("AccountsResponse", { items: [wireAccount1], first: null, last: null })).toEqual([]);
    expect(violationsForSchema("UpdateAccountRequest", { display_name: "A", summary: null, fields: [{ label: "L", content: "C" }] })).toEqual([]);
  });
});
