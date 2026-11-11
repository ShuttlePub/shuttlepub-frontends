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
import { EmumetNotFoundError, type EmumetClient } from "./client.ts";
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
  public_key: "ed25519:AAAA",
  created_at: "2025-01-15T09:00:00Z",
  moderation: null,
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
const wireProfile1 = {
  account_id: "acc_01",
  nanoid: "prof_01",
  display_name: "Alice",
  summary: "hello",
  icon_url: "https://icon.example.com/a",
  banner_url: null,
};
const wireMeta1 = { account_id: "acc_01", nanoid: "meta_01", label: "Website", content: "https://alice.example.com" };

function unexpected(call: FetchCall): never {
  throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

describe("(f) REST contract — method/path/query/body/Authorization", () => {
  test("listAccounts: GET /accounts with Bearer token, converts snake_case → camelCase incl. moderation", async () => {
    // Given: 3 アカウント (moderation: null / suspended / banned)
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(`${BASE}/accounts`);
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
      publicKey: "ed25519:AAAA",
      createdAt: "2025-01-15T09:00:00Z",
      moderation: null,
      profileId: null,
      profileUsername: null,
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

  test("getAccount: GET /accounts?ids=<id> returns first item converted", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      return jsonResponse(200, { items: [wireAccount1], first: null, last: null });
    });
    // When
    const result = await makeClient().getAccount("acc_01");
    // Then: ids クエリで 1 件取得
    expect(calls[0]?.url).toBe(`${BASE}/accounts?ids=acc_01`);
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

  test("createAccount: POST /accounts with snake_case body, isBot omitted → is_bot false", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("POST");
      expect(call.url).toBe(`${BASE}/accounts`);
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

  test("listProfiles: GET /profiles?account_ids=a,b batch param, converts to camelCase", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("GET");
      return jsonResponse(200, [wireProfile1]);
    });
    // When
    const result = await makeClient().listProfiles(["acc_01", "acc_02"]);
    // Then: バッチパラメータ (カンマ連結)
    expect(calls[0]?.url).toBe(`${BASE}/profiles?account_ids=acc_01,acc_02`);
    expect(result).toEqual([
      {
        nanoid: "prof_01",
        accountId: "acc_01",
        displayName: "Alice",
        summary: "hello",
        iconUrl: "https://icon.example.com/a",
        bannerUrl: null,
        username: null,
      },
    ]);
  });

  test("listProfiles: empty ids → no fetch, empty result", async () => {
    // Given
    const { calls } = stubFetch(unexpected);
    // When
    const result = await makeClient().listProfiles([]);
    // Then: fetch 自体が呼ばれない
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("getProfile: returns first profile, null when absent", async () => {
    // Given: 存在するケース
    stubFetch(() => jsonResponse(200, [wireProfile1]));
    // When / Then
    expect((await makeClient().getProfile("acc_01"))?.nanoid).toBe("prof_01");
  });

  test("getProfile: absent → null", async () => {
    // Given / When
    stubFetch(() => jsonResponse(200, []));
    // Then
    expect(await makeClient().getProfile("nope")).toBeNull();
  });

  test("listMetadata: GET /metadata?account_ids=a,b batch param", async () => {
    // Given
    const { calls } = stubFetch(() => jsonResponse(200, [wireMeta1]));
    // When
    const result = await makeClient().listMetadata(["acc_01", "acc_02"]);
    // Then
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(`${BASE}/metadata?account_ids=acc_01,acc_02`);
    expect(result).toEqual([{ nanoid: "meta_01", accountId: "acc_01", label: "Website", content: "https://alice.example.com" }]);
  });

  test("listMetadata: empty ids → no fetch, empty result", async () => {
    // Given / When
    const { calls } = stubFetch(unexpected);
    const result = await makeClient().listMetadata([]);
    // Then
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("createMetadata: POST /accounts/{id}/metadata with label/content body", async () => {
    // Given
    const { calls } = stubFetch((call) => {
      expect(call.method).toBe("POST");
      return jsonResponse(201, wireMeta1);
    });
    // When
    const result = await makeClient().createMetadata("acc_01", { label: "Website", content: "https://alice.example.com" });
    // Then
    expect(calls[0]?.url).toBe(`${BASE}/accounts/acc_01/metadata`);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ label: "Website", content: "https://alice.example.com" });
    expect(result.nanoid).toBe("meta_01");
    expect(result.accountId).toBe("acc_01");
  });

  test("deleteMetadata: DELETE 204 succeeds", async () => {
    // Given
    const { calls } = stubFetch(() => new Response(null, { status: 204 }));
    // When / Then: throw しない
    await makeClient().deleteMetadata("acc_01", "meta_01");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(`${BASE}/accounts/acc_01/metadata/meta_01`);
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("deleteMetadata: 404 → EmumetNotFoundError", async () => {
    // Given / When / Then
    stubFetch(() => new Response("not found", { status: 404 }));
    await expect(makeClient().deleteMetadata("acc_01", "meta_xx")).rejects.toBeInstanceOf(EmumetNotFoundError);
  });
});

describe("(c)(d) upsertProfile — Tristate 変換 + 204→再フェッチ", () => {
  test("existing profile: GET → PUT 204 (tristate body) → GET refetch", async () => {
    // Given: 既存 profile あり
    const updatedWire = { ...wireProfile1, display_name: "Alicia", summary: null };
    const { calls } = stubFetch((call) => {
      const url = new URL(call.url);
      if (call.method === "GET" && url.pathname === "/profiles") {
        // 1 回目 (存在確認) は旧値、2 回目 (再フェッチ) は更新後を返す
        // (stub は handler 呼出前に calls へ push するため、自分を含め 2 件目以降が再フェッチ)
        const isRefetch = calls.filter((c) => c.method === "GET").length > 1;
        return jsonResponse(200, [isRefetch ? updatedWire : wireProfile1]);
      }
      if (call.method === "PUT") return new Response(null, { status: 204 });
      return unexpected(call);
    });
    // When: displayName=値, summary=null (クリア), iconUrl/bannerUrl=undefined (省略)
    const result = await makeClient().upsertProfile("acc_01", { displayName: "Alicia", summary: null });
    // Then: 呼出順序は GET → PUT → GET (204 のあと再フェッチ)
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /profiles",
      "PUT /accounts/acc_01/profile",
      "GET /profiles",
    ]);
    // And: (c) Tristate — undefined の icon_url/banner_url は body に存在せず、summary は JSON null
    const putBody = JSON.parse(calls[1]?.body ?? "") as Record<string, unknown>;
    expect(putBody).toEqual({ display_name: "Alicia", summary: null });
    expect(Object.keys(putBody).sort()).toEqual(["display_name", "summary"]);
    expect("icon_url" in putBody).toBe(false);
    expect("banner_url" in putBody).toBe(false);
    // And: 戻り値は再フェッチ結果
    expect(result.displayName).toBe("Alicia");
    expect(result.summary).toBeNull();
  });

  test("absent profile: GET → POST 201 → GET refetch", async () => {
    // Given: profile 未存在
    const createdWire = { ...wireProfile1, display_name: "New", summary: null, icon_url: null };
    const { calls } = stubFetch((call) => {
      const url = new URL(call.url);
      if (call.method === "GET" && url.pathname === "/profiles") {
        const isRefetch = calls.filter((c) => c.method === "GET").length > 1;
        return jsonResponse(200, isRefetch ? [createdWire] : []);
      }
      if (call.method === "POST") return new Response(null, { status: 201 });
      return unexpected(call);
    });
    // When
    const result = await makeClient().upsertProfile("acc_01", { displayName: "New" });
    // Then: 未存在時は POST が選ばれ、そのあと再フェッチ
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /profiles",
      "POST /accounts/acc_01/profile",
      "GET /profiles",
    ]);
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ display_name: "New" });
    expect(result.displayName).toBe("New");
  });
});

describe("(d) updateMetadata — PUT 204 → listMetadata 再フェッチ", () => {
  test("PUT 204 is followed by GET refetch, result is the matching nanoid", async () => {
    // Given: 再フェッチ応答に対象 nanoid を含む
    const updatedWire = { ...wireMeta1, content: "https://new.example.com" };
    const { calls } = stubFetch((call) => {
      const url = new URL(call.url);
      if (call.method === "PUT") return new Response(null, { status: 204 });
      if (call.method === "GET" && url.pathname === "/metadata") return jsonResponse(200, [updatedWire]);
      return unexpected(call);
    });
    // When
    const result = await makeClient().updateMetadata("acc_01", "meta_01", { label: "Website", content: "https://new.example.com" });
    // Then: PUT → GET の順、PUT body は label/content
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "PUT /accounts/acc_01/metadata/meta_01",
      "GET /metadata",
    ]);
    expect(new URL(calls[1]?.url ?? "").search).toBe("?account_ids=acc_01");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ label: "Website", content: "https://new.example.com" });
    expect(result.content).toBe("https://new.example.com");
  });

  test("refetch missing the nanoid → EmumetNotFoundError", async () => {
    // Given: 再フェッチ応答に対象 nanoid が無い
    stubFetch((call) => {
      if (call.method === "PUT") return new Response(null, { status: 204 });
      return jsonResponse(200, [{ ...wireMeta1, nanoid: "meta_other" }]);
    });
    // When / Then
    await expect(
      makeClient().updateMetadata("acc_01", "meta_01", { label: "L", content: "C" }),
    ).rejects.toBeInstanceOf(EmumetNotFoundError);
  });
});
