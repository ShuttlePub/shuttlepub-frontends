// ============================================================
// Profile username の GraphQL 統合テスト
//  (a) 読取: Account.profileId / profileUsername、Profile.username / usernameState (未設定は状態でありエラーではない)
//  (b) createAccount: username を送る・省略 (旧経路) の両方。拒否は種別ごとの extensions.code
//  (c) setProfileUsername: 一回限り。重複・予約語・形式・設定済み・停止中・未認証・権限なしが別コード
//  (d) checkProfileUsername: 規則だけの判定 (Emumet 非接触)
//  (e) HTTP 経路 (createYogaHandler) でも分類が保たれ、上流の本文が漏れない。変更 mutation は存在しない
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { graphql, isObjectType, type GraphQLSchema } from "graphql";
import { createMockSessionAdapter, encodeMockCookie, type SessionAdapter } from "@shuttlepub/auth-bun";
import { buildContext, type GraphQLContext } from "./context.ts";
import { createYogaHandler } from "./server.ts";
import { makeSchema } from "./schema.ts";
import { resolvers } from "./resolvers.ts";
import { createMockEmumetClient } from "./emumet/mock.ts";
import { createRealEmumetClient } from "./emumet/real.ts";
import { jsonResponse, stubFetch } from "./test-utils.ts";
import {
  EmumetAccountRestrictedError,
  EmumetApiError,
  EmumetNotFoundError,
  EmumetUsernameAlreadySetError,
  EmumetUsernameConflictError,
  EmumetUsernameInvalidError,
  EmumetUsernameTakenError,
  type EmumetClient,
} from "./emumet/client.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./emumet/registration-gate.ts";

const schema: GraphQLSchema = makeSchema(resolvers);

const stubAdapter: SessionAdapter = {
  getSession: () => Promise.resolve({ accessToken: "test-token" }),
  refreshSessionIfNeeded: (session) => Promise.resolve({ kind: "fresh", accessToken: session.accessToken }),
  sealSessionCookie: () => Promise.resolve(""),
  clearSessionCookie: () => "",
};
const nullSessionAdapter: SessionAdapter = { ...stubAdapter, getSession: () => Promise.resolve(null) };

function authenticated(emumet: EmumetClient): Promise<GraphQLContext> {
  return buildContext(new Request("http://localhost/graphql"), { adapter: stubAdapter, createEmumetClient: () => emumet });
}

function run(source: string, context: GraphQLContext, variableValues?: Record<string, unknown>) {
  return graphql({ schema, source, contextValue: context, variableValues });
}

function code(result: Awaited<ReturnType<typeof run>>): string {
  const error = result.errors?.[0];
  expect(error, "expected a GraphQL error").toBeDefined();
  return String(error?.extensions?.["code"]);
}

const SET = "mutation Set($id: ID!, $u: String!) { setProfileUsername(profileId: $id, username: $u) { nanoid accountId username usernameState } }";
const CREATE = "mutation Create($input: CreateAccountInput!) { createAccount(input: $input) { id name profileId profileUsername } }";

describe("(a) 読取と未設定の表現", () => {
  test("Account.profileId / profileUsername と Profile.username / usernameState (SET / UNSET)", async () => {
    const context = await authenticated(createMockEmumetClient());
    const result = await run(
      "{ accounts { items { id name profileId profileUsername profile { nanoid username usernameState } } } }",
      context,
    );
    expect(result.errors).toBeUndefined();
    const items = (result.data?.["accounts"] as { items: unknown[] }).items;
    expect(items).toEqual([
      { id: "acc_01", name: "alice", profileId: "prof_01", profileUsername: "alice", profile: { nanoid: "prof_01", username: "alice", usernameState: "SET" } },
      { id: "acc_02", name: "bob", profileId: "prof_02", profileUsername: null, profile: { nanoid: "prof_02", username: null, usernameState: "UNSET" } },
      { id: "acc_03", name: "bot-news", profileId: "prof_03", profileUsername: "bot-news", profile: { nanoid: "prof_03", username: "bot-news", usernameState: "SET" } },
    ]);
  });

  test("Profile を移管で失った Account は profileId・profile とも null で、エラーにならない", async () => {
    const emumet = createMockEmumetClient();
    const org = await emumet.createAccount({ name: "org" });
    const personal = await emumet.createAccount({ name: "moved-away", username: "moved-away" });
    emumet.profileIdentityControl.transferProfile(personal.profileId as string, org.id);
    const created = personal;
    const result = await run("query($id: ID!) { account(id: $id) { profileId profileUsername profile { nanoid } } }", await authenticated(emumet), { id: created.id });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["account"]).toEqual({ profileId: null, profileUsername: null, profile: null });
  });
});

describe("(b) createAccount と username", () => {
  test("username を送ると Account と Profile が作られ、username は name と別の値になる", async () => {
    const context = await authenticated(createMockEmumetClient());
    const result = await run(CREATE, context, { input: { name: "Carol Display", username: "carol" } });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["createAccount"]).toMatchObject({ name: "Carol Display", profileUsername: "carol" });
    expect((result.data?.["createAccount"] as { profileId: string | null }).profileId).not.toBeNull();
  });

  test("username は必須: 省略・null は GraphQL の検証エラーで、Emumet には何も送らない", async () => {
    const emumet = createMockEmumetClient();
    const before = (await emumet.listAccounts()).items.length;
    const context = await authenticated(emumet);
    for (const input of [{ name: "legacy" }, { name: "legacy", username: null }]) {
      const result = await run(CREATE, context, { input });
      expect(result.data ?? null).toBeNull();
      expect(result.errors?.[0]?.message).toContain("username");
    }
    expect((await emumet.listAccounts()).items).toHaveLength(before);
  });

  test("拒否は種別ごとのコード: 形式 / 予約語 / 重複。何も作られない", async () => {
    const emumet = createMockEmumetClient();
    const context = await authenticated(emumet);
    const before = (await emumet.listAccounts()).items.length;
    const codes = [];
    for (const username of ["Carol", "admin", "alice"]) {
      codes.push(code(await run(CREATE, context, { input: { name: "x", username } })));
    }
    expect(codes).toEqual(["USERNAME_INVALID_FORMAT", "USERNAME_RESERVED", "USERNAME_TAKEN"]);
    expect((await emumet.listAccounts()).items).toHaveLength(before);
  });
});

describe("(c) setProfileUsername — 一回限り", () => {
  test("未設定の Profile に設定でき、戻りは設定済み (SET)、以後の読取にも反映される", async () => {
    const emumet = createMockEmumetClient();
    const context = await authenticated(emumet);
    const result = await run(SET, context, { id: "prof_02", u: "bob" });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["setProfileUsername"]).toEqual({ nanoid: "prof_02", accountId: "acc_02", username: "bob", usernameState: "SET" });
    const read = await run("{ account(id: \"acc_02\") { profileUsername } }", await authenticated(emumet));
    expect(read.data?.["account"]).toEqual({ profileUsername: "bob" });
  });

  test("コードが混同されない: 形式 / 予約語 / 重複 / 設定済み / 対象なし", async () => {
    const context = await authenticated(createMockEmumetClient());
    const attempts: [string, string][] = [
      ["prof_02", "Bob"],
      ["prof_02", "root"],
      ["prof_02", "alice"],
      ["prof_01", "alice2"],
      ["prof_missing", "bob"],
    ];
    const codes = [];
    for (const [id, u] of attempts) codes.push(code(await run(SET, context, { id, u })));
    expect(codes).toEqual(["USERNAME_INVALID_FORMAT", "USERNAME_RESERVED", "USERNAME_TAKEN", "USERNAME_ALREADY_SET", "NOT_FOUND"]);
  });

  test("設定後の再設定は USERNAME_ALREADY_SET で値は変わらない。変更用の mutation は存在しない", async () => {
    const context = await authenticated(createMockEmumetClient());
    await run(SET, context, { id: "prof_02", u: "bob" });
    expect(code(await run(SET, context, { id: "prof_02", u: "robert" }))).toBe("USERNAME_ALREADY_SET");
    const read = await run('{ account(id: "acc_02") { profile { username } } }', context);
    expect(read.data?.["account"]).toEqual({ profile: { username: "bob" } });
    const mutation = schema.getMutationType();
    expect(mutation).toBeDefined();
    const names = Object.keys(mutation?.getFields() ?? {});
    expect(names).toContain("setProfileUsername");
    expect(names.filter((name) => /username/i.test(name))).toEqual(["setProfileUsername"]);
    const profileType = schema.getType("Profile");
    expect(isObjectType(profileType) && Object.keys(profileType.getFields())).toContain("usernameState");
  });

  test("停止中 Account は ACCOUNT_RESTRICTED、未認証は UNAUTHENTICATED で Emumet に触れない", async () => {
    const emumet = createMockEmumetClient();
    emumet.profileIdentityControl.setModeration("acc_02", { type: "BANNED", reason: "tos", suspendedAt: null, expiresAt: null, bannedAt: "2025-06-02T00:00:00Z" });
    expect(code(await run(SET, await authenticated(emumet), { id: "prof_02", u: "bob" }))).toBe("ACCOUNT_RESTRICTED");

    let touched = 0;
    const anonymous = await buildContext(new Request("http://localhost/graphql"), {
      adapter: nullSessionAdapter,
      createEmumetClient: () => {
        touched++;
        return createMockEmumetClient();
      },
    });
    const result = await run(SET, anonymous, { id: "prof_02", u: "bob" });
    expect(code(result)).toBe("UNAUTHENTICATED");
    expect(touched).toBe(0);
    expect(code(await run('{ checkProfileUsername(username: "bob") }', anonymous))).toBe("UNAUTHENTICATED");
  });
});

function failingClient(error: unknown): EmumetClient {
  const base = createMockEmumetClient();
  return {
    ...base,
    setProfileUsername: () => Promise.reject(error),
    createAccount: () => Promise.reject(error),
  };
}

describe("(c') 上流エラーの写像 (setProfileUsername / username 付き createAccount)", () => {
  const cases: [string, unknown, string][] = [
    ["400 (規則上は有効な値) は BAD_REQUEST", new EmumetApiError(400, "secret body"), "BAD_REQUEST"],
    ["401 は UNAUTHENTICATED", new EmumetApiError(401, "secret body"), "UNAUTHENTICATED"],
    ["403 は FORBIDDEN (握りつぶさない)", new EmumetApiError(403, "secret body"), "FORBIDDEN"],
    ["409 判別不能は USERNAME_CONFLICT", new EmumetUsernameConflictError(), "USERNAME_CONFLICT"],
    ["409 使用中は USERNAME_TAKEN", new EmumetUsernameTakenError(), "USERNAME_TAKEN"],
    ["409 設定済みは USERNAME_ALREADY_SET", new EmumetUsernameAlreadySetError(), "USERNAME_ALREADY_SET"],
    ["422 は ACCOUNT_RESTRICTED", new EmumetAccountRestrictedError(), "ACCOUNT_RESTRICTED"],
    ["404 は NOT_FOUND", new EmumetNotFoundError("x"), "NOT_FOUND"],
    ["形式違反", new EmumetUsernameInvalidError("FORMAT"), "USERNAME_INVALID_FORMAT"],
    ["予約語", new EmumetUsernameInvalidError("RESERVED"), "USERNAME_RESERVED"],
    ["一時障害", new EmumetUnavailableError("down"), "TEMPORARILY_UNAVAILABLE"],
    ["契約違反の応答", new EmumetInvalidResponseError("bad"), "INVALID_UPSTREAM_RESPONSE"],
    ["500 は INTERNAL_SERVER_ERROR", new EmumetApiError(500, "secret body"), "INTERNAL_SERVER_ERROR"],
    ["想定外の例外は INTERNAL_SERVER_ERROR", new Error("boom"), "INTERNAL_SERVER_ERROR"],
  ];
  for (const [name, error, expected] of cases) {
    test(`setProfileUsername: ${name}`, async () => {
      const result = await run(SET, await authenticated(failingClient(error)), { id: "prof_02", u: "bob" });
      expect(code(result)).toBe(expected);
      expect(JSON.stringify(result.errors)).not.toContain("secret body");
    });
  }
  for (const [name, error, expected] of cases.filter(([, , c]) => c !== "NOT_FOUND")) {
    test(`createAccount (username 指定): ${name}`, async () => {
      const result = await run(CREATE, await authenticated(failingClient(error)), { input: { name: "x", username: "bob" } });
      expect(code(result)).toBe(expected);
    });
  }

});

describe("(d) checkProfileUsername — 入力中の検証 (形式・予約語は BFF、重複は Emumet の空き確認 API)", () => {
  const CHECK = "query($u: String!) { checkProfileUsername(username: $u) }";

  test("VALID / TAKEN / FORMAT / RESERVED。設定・作成は呼ばない。形式・予約語の違反は空き確認を呼ばない", async () => {
    const base = createMockEmumetClient();
    const calls: string[] = [];
    const emumet: EmumetClient = {
      ...base,
      setProfileUsername: (...args) => (calls.push("set"), base.setProfileUsername(...args)),
      createAccount: (...args) => (calls.push("create"), base.createAccount(...args)),
      checkUsernameAvailability: (...args) => (calls.push(`availability:${args[0]}`), base.checkUsernameAvailability(...args)),
    };
    const context = await authenticated(emumet);
    const check = async (username: string) => (await run(CHECK, context, { u: username })).data?.["checkProfileUsername"];
    expect(await check("fresh-name")).toBe("VALID");
    expect(await check("alice")).toBe("TAKEN");
    expect(await check("Alice")).toBe("FORMAT");
    expect(await check(" alice")).toBe("FORMAT");
    expect(await check("")).toBe("FORMAT");
    expect(await check("admin")).toBe("RESERVED");
    expect(await check("alice\n")).toBe("FORMAT");
    expect(await check("admin\n")).toBe("FORMAT");
    // 形式・予約語を満たす 2 回だけが Emumet へ届く (レート制限を節約)
    expect(calls).toEqual(["availability:fresh-name", "availability:alice"]);
  });

  test("確認できなかったとき (429 / 接続不可) は VALID ではなく UNKNOWN。形式・予約語は引き続き判定できる", async () => {
    const emumet = createMockEmumetClient();
    const context = await authenticated(emumet);
    const check = async (username: string) => (await run(CHECK, context, { u: username })).data?.["checkProfileUsername"];
    for (const kind of ["rate_limited", "unavailable"] as const) {
      emumet.profileIdentityControl.setAvailabilityFailure(kind);
      expect(await check("fresh-name"), kind).toBe("UNKNOWN");
      expect(await check("alice"), kind).toBe("UNKNOWN");
      expect(await check("Alice"), kind).toBe("FORMAT");
      expect(await check("admin"), kind).toBe("RESERVED");
    }
    emumet.profileIdentityControl.setAvailabilityFailure(null);
    expect(await check("fresh-name")).toBe("VALID");
  });

  test("上流の 5xx や契約違反も UNKNOWN。401 だけは UNAUTHENTICATED (認証の失敗を確認不能に隠さない)", async () => {
    const base = createMockEmumetClient();
    const failing = (error: Error): EmumetClient => ({ ...base, checkUsernameAvailability: () => Promise.reject(error) });
    const check = async (emumet: EmumetClient) => run(CHECK, await authenticated(emumet), { u: "fresh-name" });
    expect((await check(failing(new EmumetApiError(503, "down")))).data?.["checkProfileUsername"]).toBe("UNKNOWN");
    expect((await check(failing(new EmumetApiError(500, "boom")))).data?.["checkProfileUsername"]).toBe("UNKNOWN");
    expect((await check(failing(new EmumetInvalidResponseError("bad body")))).data?.["checkProfileUsername"]).toBe("UNKNOWN");
    expect((await check(failing(new TypeError("unexpected")))).data?.["checkProfileUsername"]).toBe("UNKNOWN");
    expect(code(await check(failing(new EmumetApiError(401, ""))))).toBe("UNAUTHENTICATED");
    expect(code(await check(failing(new EmumetApiError(403, ""))))).toBe("FORBIDDEN");
  });

  test("上流が同じ規則で invalid_format / reserved と返したときはその理由をそのまま使う (BFF の規則と食い違っても VALID にしない)", async () => {
    const base = createMockEmumetClient();
    const upstream = (reason: "invalid_format" | "reserved"): EmumetClient => ({
      ...base,
      checkUsernameAvailability: () => Promise.resolve({ available: false, reason }),
    });
    const run1 = async (emumet: EmumetClient) => (await run(CHECK, await authenticated(emumet), { u: "fresh-name" })).data?.["checkProfileUsername"];
    expect(await run1(upstream("invalid_format"))).toBe("FORMAT");
    expect(await run1(upstream("reserved"))).toBe("RESERVED");
  });
});

describe("(d') instanceHost — 公開ホストは明示設定が契約 (API 接続先への暗黙フォールバックなし)", () => {
  const KEYS = ["EMUMET_PUBLIC_HOST", "EMUMET_API_URL", "USE_MOCK"] as const;
  async function withEnv<T>(env: Partial<Record<(typeof KEYS)[number], string>>, body: () => Promise<T>): Promise<T> {
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, env);
    try {
      return await body();
    } finally {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  }
  const ask = async () => run("{ instanceHost }", await authenticated(createMockEmumetClient()));

  test("EMUMET_PUBLIC_HOST をそのまま返す (port 付きも可)", async () => {
    expect((await withEnv({ EMUMET_PUBLIC_HOST: "emumet.example.com", USE_MOCK: "false" }, ask)).data?.["instanceHost"]).toBe("emumet.example.com");
    expect((await withEnv({ EMUMET_PUBLIC_HOST: " localhost:8080 ", USE_MOCK: "false" }, ask)).data?.["instanceHost"]).toBe("localhost:8080");
  });

  test("real で未設定なら EMUMET_API_URL のホストを使わず INSTANCE_HOST_NOT_CONFIGURED", async () => {
    const result = await withEnv({ USE_MOCK: "false", EMUMET_API_URL: "http://internal-emumet.cluster.local:8080" }, ask);
    expect(result.data).toBeNull();
    expect(code(result)).toBe("INSTANCE_HOST_NOT_CONFIGURED");
  });

  test("形式が host[:port] でない設定 (scheme / path / 空白混じり) も取得失敗", async () => {
    for (const bad of ["https://emumet.example.com", "emumet.example.com/", "emu met.example.com", "emumet.example.com:99999x"]) {
      const result = await withEnv({ USE_MOCK: "false", EMUMET_PUBLIC_HOST: bad }, ask);
      expect(code(result), bad).toBe("INSTANCE_HOST_NOT_CONFIGURED");
    }
  });

  test("mock (USE_MOCK 未設定 = index.ts の既定も mock) は設定が無ければ例示ホスト、あればそちら", async () => {
    expect((await withEnv({}, ask)).data?.["instanceHost"]).toBe("emumet.example");
    expect((await withEnv({ USE_MOCK: "true" }, ask)).data?.["instanceHost"]).toBe("emumet.example");
    expect((await withEnv({ USE_MOCK: "true", EMUMET_PUBLIC_HOST: "mock.example" }, ask)).data?.["instanceHost"]).toBe("mock.example");
  });
});

describe("(e) HTTP 経路 (createYogaHandler)", () => {
  const cookie = `ratcap_session=${encodeMockCookie({ token: "t", username: "u" })}`;

  async function post(handler: (req: Request) => Promise<Response>, query: string, variables?: Record<string, unknown>) {
    const response = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ query, variables }),
      }),
    );
    return (await response.json()) as { data: unknown; errors?: { message: string; extensions: Record<string, unknown> }[] };
  }

  test("分類コードが INTERNAL_SERVER_ERROR にマスクされず、retryable 等の extensions も保たれる。上流本文は出ない", async () => {
    const adapter = createMockSessionAdapter("ratcap_session", false);
    const attempts: [unknown, string][] = [
      [new EmumetUsernameTakenError(), "USERNAME_TAKEN"],
      [new EmumetUsernameInvalidError("RESERVED"), "USERNAME_RESERVED"],
      [new EmumetUsernameAlreadySetError(), "USERNAME_ALREADY_SET"],
      [new EmumetApiError(403, "UPSTREAM-SECRET"), "FORBIDDEN"],
      [new EmumetUnavailableError("down"), "TEMPORARILY_UNAVAILABLE"],
    ];
    for (const [error, expected] of attempts) {
      const handler = createYogaHandler(adapter, () => failingClient(error));
      const body = await post(handler, SET, { id: "prof_02", u: "bob" });
      expect(body.errors?.[0]?.extensions["code"], expected).toBe(expected);
      expect(JSON.stringify(body)).not.toContain("UPSTREAM-SECRET");
      if (expected === "TEMPORARILY_UNAVAILABLE") expect(body.errors?.[0]?.extensions["retryable"]).toBe(true);
    }
  });

  test("mock セッションで設定でき、同じセッションの再設定は USERNAME_ALREADY_SET", async () => {
    const mock = createMockEmumetClient();
    const handler = createYogaHandler(createMockSessionAdapter("ratcap_session", false), () => mock);
    const first = await post(handler, SET, { id: "prof_02", u: "bob" });
    expect(first.errors).toBeUndefined();
    const second = await post(handler, SET, { id: "prof_02", u: "robert" });
    expect(second.errors?.[0]?.extensions["code"]).toBe("USERNAME_ALREADY_SET");
  });
});

describe("(f) 現行 UI と同じ選択項目が実 Emumet の AccountResponse (public_key なし) で動く (real クライアント + 上流 stub)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    Object.assign(globalThis, { fetch: originalFetch });
  });

  const wireAccount = {
    id: "acc_r1",
    name: "real",
    is_bot: false,
    created_at: "2026-11-11T00:00:00Z",
    moderation: null,
    profile_id: "prof_r1",
    profile_username: null,
    display_name: "Real Display",
    summary: "s",
    icon_url: null,
    banner_url: null,
    fields: [{ label: "Website", content: "https://real.example.com" }],
  };

  function realContext(): Promise<GraphQLContext> {
    return authenticated(createRealEmumetClient({ baseUrl: "http://emumet.test" }, "tok"));
  }

  test("createAccount (id name isBot publicKey createdAt, username 付き) は成功し、publicKey は null (値を持たない)", async () => {
    stubFetch(() => jsonResponse(201, wireAccount));
    const result = await run(
      'mutation { createAccount(input: { name: "real", isBot: false, username: "real-user" }) { id name isBot publicKey createdAt } }',
      await realContext(),
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.["createAccount"]).toEqual({ id: "acc_r1", name: "real", isBot: false, publicKey: null, createdAt: "2026-11-11T00:00:00Z" });
  });

  test("一覧・詳細 (profile / metadata を含む) は旧 /profiles・/metadata を使わず AccountResponse だけから作られる", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { items: [wireAccount], first: null, last: null }));
    const context = await realContext();
    const list = await run("{ accounts { items { id name isBot publicKey createdAt } first last } }", context);
    expect(list.errors).toBeUndefined();
    const detail = await run(
      '{ account(id: "acc_r1") { id name profile { nanoid displayName summary username usernameState } metadata { nanoid label content } } }',
      context,
    );
    expect(detail.errors).toBeUndefined();
    expect(detail.data?.["account"]).toEqual({
      id: "acc_r1",
      name: "real",
      profile: { nanoid: "prof_r1", displayName: "Real Display", summary: "s", username: null, usernameState: "UNSET" },
      metadata: [{ nanoid: "0", label: "Website", content: "https://real.example.com" }],
    });
    expect(calls.every((call) => new URL(call.url).pathname === "/api/v1/accounts")).toBe(true);
  });

  test("updateProfile は PATCH /api/v1/accounts/{id} で Profile 属性だけを書き込む (fields は送らない)", async () => {
    const { calls } = stubFetch((call) => jsonResponse(200, { ...wireAccount, display_name: (JSON.parse(call.body ?? "{}") as { display_name?: string }).display_name ?? wireAccount.display_name }));
    const context = await realContext();
    const profile = await run('mutation { updateProfile(accountId: "acc_r1", input: { displayName: "New" }) { nanoid displayName } }', context);
    expect(profile.data?.["updateProfile"]).toEqual({ nanoid: "prof_r1", displayName: "New" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/api/v1/accounts/acc_r1");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ display_name: "New" });
  });

  test("createMetadata / updateMetadata / deleteMetadata は UNSUPPORTED (何も書き換えず、HTTP 経路でもコードが保たれる)", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { items: [wireAccount], first: null, last: null }));
    const context = await realContext();
    for (const source of [
      'mutation { createMetadata(accountId: "acc_r1", input: { label: "Blog", content: "b" }) { nanoid } }',
      'mutation { updateMetadata(accountId: "acc_r1", nanoid: "0", input: { label: "Web", content: "w" }) { nanoid } }',
      'mutation { deleteMetadata(accountId: "acc_r1", nanoid: "0") }',
    ]) {
      const result = await run(source, context);
      expect(code(result), source).toBe("UNSUPPORTED");
      expect(result.data, source).toBeNull();
    }
    expect(calls).toHaveLength(0);
    const handler = createYogaHandler(createMockSessionAdapter("ratcap_session", false), (token) => createRealEmumetClient({ baseUrl: "http://emumet.test" }, token));
    const response = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `ratcap_session=${encodeMockCookie({ token: "t", username: "u" })}` },
        body: JSON.stringify({ query: 'mutation { updateMetadata(accountId: "acc_r1", nanoid: "0", input: { label: "Web", content: "w" }) { nanoid } }' }),
      }),
    );
    const body = (await response.json()) as { errors?: { extensions: Record<string, unknown> }[] };
    expect(body.errors?.[0]?.extensions["code"]).toBe("UNSUPPORTED");
    expect(calls).toHaveLength(0);
  });
});
