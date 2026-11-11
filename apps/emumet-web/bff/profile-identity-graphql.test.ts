// ============================================================
// Profile username の GraphQL 統合テスト
//  (a) 読取: Account.profileId / profileUsername、Profile.username / usernameState (未設定は状態でありエラーではない)
//  (b) createAccount: username を送る・省略 (旧経路) の両方。拒否は種別ごとの extensions.code
//  (c) setProfileUsername: 一回限り。重複・予約語・形式・設定済み・停止中・未認証・権限なしが別コード
//  (d) checkProfileUsername: 規則だけの判定 (Emumet 非接触)
//  (e) HTTP 経路 (createYogaHandler) でも分類が保たれ、上流の本文が漏れない。変更 mutation は存在しない
// ============================================================

import { describe, expect, test } from "bun:test";
import { graphql, isObjectType, type GraphQLSchema } from "graphql";
import { createMockSessionAdapter, encodeMockCookie, type SessionAdapter } from "@shuttlepub/auth-bun";
import { buildContext, type GraphQLContext } from "./context.ts";
import { createYogaHandler } from "./server.ts";
import { makeSchema } from "./schema.ts";
import { resolvers } from "./resolvers.ts";
import { createMockEmumetClient } from "./emumet/mock.ts";
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

  test("username 省略 (旧経路) は従来どおり成功する (画面実装 PR まで schema 上は任意)。Profile は作られ、username は未設定 (profileId あり・profileUsername null)", async () => {
    const result = await run(CREATE, await authenticated(createMockEmumetClient()), { input: { name: "legacy" } });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["createAccount"]).toMatchObject({ name: "legacy", profileUsername: null });
    expect((result.data?.["createAccount"] as { profileId: string | null }).profileId).not.toBeNull();
  });

  test("username: null は省略と同じ (送らない)", async () => {
    const result = await run(CREATE, await authenticated(createMockEmumetClient()), { input: { name: "legacy", username: null } });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["createAccount"]).toMatchObject({ profileUsername: null });
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

  test("createAccount (username 無し) の既存のエラー写像は変えない: 400 は従来どおり INTERNAL_SERVER_ERROR", async () => {
    const result = await run(CREATE, await authenticated(failingClient(new EmumetApiError(400, "x"))), { input: { name: "x" } });
    expect(code(result)).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("(d) checkProfileUsername — 規則だけの判定", () => {
  test("VALID / FORMAT / RESERVED を返し、Emumet の操作 (設定・作成) は呼ばない", async () => {
    const base = createMockEmumetClient();
    const calls: string[] = [];
    const emumet: EmumetClient = {
      ...base,
      setProfileUsername: (...args) => (calls.push("set"), base.setProfileUsername(...args)),
      createAccount: (...args) => (calls.push("create"), base.createAccount(...args)),
    };
    const context = await authenticated(emumet);
    const check = async (username: string) => (await run("query($u: String!) { checkProfileUsername(username: $u) }", context, { u: username })).data?.["checkProfileUsername"];
    expect(await check("alice")).toBe("VALID");
    expect(await check("Alice")).toBe("FORMAT");
    expect(await check(" alice")).toBe("FORMAT");
    expect(await check("")).toBe("FORMAT");
    expect(await check("admin")).toBe("RESERVED");
    expect(await check("alice\n")).toBe("FORMAT");
    expect(await check("admin\n")).toBe("FORMAT");
    expect(calls).toEqual([]);
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
