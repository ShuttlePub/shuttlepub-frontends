// ============================================================
// 登録ゲートの GraphQL 統合テスト
//  (a) 認可: 未認証・非管理者は fail closed (データを返さず、401/403 を握りつぶさない)
//  (b) エラー分類: 競合・前提条件・不正・一時障害・契約違反・権限が別の extensions.code になる
//  (c) 状態とエラーが別の型: 手動再開が必要な状態 (STOPPED) は成功した状態、エラーではない
//  (d) secret を含まない・Webhook (E15w) は未接続で成功を捏造しない
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { graphql, isEnumType, isObjectType, type GraphQLEnumType, type GraphQLObjectType, type GraphQLSchema } from "graphql";
import { createMockSessionAdapter, encodeMockCookie, type SessionAdapter } from "@shuttlepub/auth-bun";
import { buildContext, type GraphQLContext } from "./context.ts";
import { createYogaHandler } from "./server.ts";
import { makeSchema } from "./schema.ts";
import { resolvers } from "./resolvers.ts";
import { toRegistrationGateError } from "./registration-gate-resolvers.ts";
import { createMockEmumetClient } from "./emumet/mock.ts";
import { createRealEmumetClient } from "./emumet/real.ts";
import { EmumetApiError, type EmumetClient } from "./emumet/client.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./emumet/registration-gate.ts";
import { REGISTRATION_GATE_FIXTURES, REGISTRATION_GATE_FIXTURE_NAMES } from "./emumet/registration-gate-fixtures.ts";
import { jsonResponse, stubFetch } from "./test-utils.ts";

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

type Failure = { code: string; message: string; extensions: Record<string, unknown> };

function failure(result: Awaited<ReturnType<typeof run>>): Failure {
  const error = result.errors?.[0];
  expect(error, "expected a GraphQL error").toBeDefined();
  return { code: String(error?.extensions?.["code"]), message: error?.message ?? "", extensions: { ...(error?.extensions ?? {}) } };
}

const STATE_FIELDS = `revision adminState decision accepting requiresManualResume configLostLatch healthEpisode
  enforcedProtections degradedProtections
  override { active activatedBy activatedAt }
  observation { email { configured probe } bot { configured probe } }
  updatedAt`;

const OPERATIONS: { name: string; source: string }[] = [
  { name: "registrationGate", source: `{ registrationGate { ${STATE_FIELDS} } }` },
  { name: "registrationGateNotifications", source: "{ registrationGateNotifications { unreadCount nextCursor notifications { id } } }" },
  { name: "registrationGateUnreadCount", source: "{ registrationGateUnreadCount }" },
  { name: "openRegistrationGate", source: "mutation { openRegistrationGate(revision: 7) { revision } }" },
  { name: "closeRegistrationGate", source: "mutation { closeRegistrationGate(revision: 7) { revision } }" },
  { name: "enableRegistrationGateOverride", source: "mutation { enableRegistrationGateOverride(revision: 7, acknowledgeWarning: true) { revision } }" },
  { name: "revokeRegistrationGateOverride", source: "mutation { revokeRegistrationGateOverride(revision: 7) { revision } }" },
  { name: "markRegistrationGateNotificationsRead", source: 'mutation { markRegistrationGateNotificationsRead(eventIds: ["303"]) }' },
  { name: "markAllRegistrationGateNotificationsRead", source: "mutation { markAllRegistrationGateNotificationsRead }" },
];

describe("(a) 認可は fail closed", () => {
  test("未認証 (セッション無し) は全操作が UNAUTHENTICATED で、Emumet は一度も呼ばれない", async () => {
    let touched = 0;
    const context = await buildContext(new Request("http://localhost/graphql"), {
      adapter: nullSessionAdapter,
      createEmumetClient: () => {
        touched++;
        return createMockEmumetClient();
      },
    });
    for (const operation of OPERATIONS) {
      const result = await run(operation.source, context);
      expect(failure(result).code, operation.name).toBe("UNAUTHENTICATED");
      expect(result.data, operation.name).toBeNull();
    }
    expect(touched).toBe(0);
  });

  test("非管理者 (Emumet が 403) は全操作が FORBIDDEN で、データも状態変更も無い", async () => {
    const emumet = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected", notifications: "mixed", role: "non-admin" } });
    const context = await authenticated(emumet);
    for (const operation of OPERATIONS) {
      const result = await run(operation.source, context);
      expect(failure(result).code, operation.name).toBe("FORBIDDEN");
      expect(result.data, operation.name).toBeNull();
    }
    emumet.registrationGateControl.setRole("admin");
    expect(emumet.registrationGateControl.snapshot().revision).toBe(7);
    expect(await emumet.countUnreadRegistrationGateNotifications()).toBe(1);
  });

  test("上流の 401 (BFF が持つトークンが無効) は FORBIDDEN ではなく UNAUTHENTICATED", async () => {
    const emumet = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected" } });
    emumet.registrationGateControl.failNext(new EmumetApiError(401, ""));
    expect(failure(await run(OPERATIONS[0]!.source, await authenticated(emumet))).code).toBe("UNAUTHENTICATED");
  });

  test("yoga ハンドラ経由: cookie 無しは 200 + UNAUTHENTICATED、mock セッションの管理者は状態を取得できる", async () => {
    const mock = createMockEmumetClient({ registrationGate: { fixture: "override_protected" } });
    const handler = createYogaHandler(createMockSessionAdapter("ratcap_session", false), () => mock);
    const post = async (cookie?: string) => {
      const response = await handler(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
          body: JSON.stringify({ query: "{ registrationGate { decision override { active } } }" }),
        }),
      );
      return (await response.json()) as { data: unknown; errors?: { extensions: { code: string } }[] };
    };
    const anonymous = await post();
    expect(anonymous.errors?.[0]?.extensions.code).toBe("UNAUTHENTICATED");
    expect(anonymous.data).toBeNull();
    const cookie = `ratcap_session=${encodeMockCookie({ token: "t", username: "admin" })}`;
    expect((await post(cookie)).data).toEqual({ registrationGate: { decision: "ACCEPTING", override: { active: true } } });
  });
});

describe("(b) エラー分類 (mock 経由)", () => {
  test("revision 競合は REVISION_CONFLICT、状態は変わらず、再取得した revision で成功する", async () => {
    const emumet = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected" } });
    const context = await authenticated(emumet);
    const conflict = await run("mutation { closeRegistrationGate(revision: 3) { revision } }", context);
    expect(failure(conflict).code).toBe("REVISION_CONFLICT");
    expect(conflict.data).toBeNull();
    const fresh = await run("{ registrationGate { revision adminState } }", context);
    expect(fresh.data).toEqual({ registrationGate: { revision: 7, adminState: "OPEN" } });
    const closed = await run("mutation { closeRegistrationGate(revision: 7) { revision adminState decision } }", context);
    expect(closed.data).toEqual({ closeRegistrationGate: { revision: 8, adminState: "CLOSED", decision: "ADMIN_CLOSED" } });
  });

  test("前提条件違反 (準備未完了で open) は PRECONDITION_FAILED で、競合とは別", async () => {
    const context = await authenticated(createMockEmumetClient());
    const result = await run("mutation { openRegistrationGate(revision: 0) { revision } }", context);
    expect(failure(result).code).toBe("PRECONDITION_FAILED");
  });

  test("override の警告 ack が false なら BAD_REQUEST。true なら開放でき override が判別できる", async () => {
    const context = await authenticated(createMockEmumetClient());
    const refused = await run("mutation { enableRegistrationGateOverride(revision: 0, acknowledgeWarning: false) { revision } }", context);
    expect(failure(refused).code).toBe("BAD_REQUEST");
    const accepted = await run(
      "mutation { enableRegistrationGateOverride(revision: 0, acknowledgeWarning: true) { revision decision enforcedProtections override { active activatedBy } } }",
      context,
    );
    expect(accepted.errors).toBeUndefined();
    expect(accepted.data).toEqual({
      enableRegistrationGateOverride: { revision: 1, decision: "ACCEPTING", enforcedProtections: [], override: { active: true, activatedBy: "auth-account-mock-admin" } },
    });
  });

  test("一時障害は TEMPORARILY_UNAVAILABLE (retryable)。権限・競合とは別で、再試行すれば成功する", async () => {
    const emumet = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected" } });
    const context = await authenticated(emumet);
    emumet.registrationGateControl.failNext(new EmumetUnavailableError("timeout"));
    const failed = failure(await run("{ registrationGate { revision } }", context));
    expect(failed.code).toBe("TEMPORARILY_UNAVAILABLE");
    expect(failed.extensions["retryable"]).toBe(true);
    expect((await run("{ registrationGate { revision } }", context)).data).toEqual({ registrationGate: { revision: 7 } });
  });

  test("toRegistrationGateError: 状態コード → extensions.code の表 (本文・内部詳細は出さない)", () => {
    const table: [number, string, boolean?][] = [
      [400, "BAD_REQUEST"],
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [409, "REVISION_CONFLICT"],
      [422, "PRECONDITION_FAILED"],
      [408, "TEMPORARILY_UNAVAILABLE", true],
      [429, "TEMPORARILY_UNAVAILABLE", true],
      [500, "TEMPORARILY_UNAVAILABLE", true],
      [502, "TEMPORARILY_UNAVAILABLE", true],
      [503, "TEMPORARILY_UNAVAILABLE", true],
      [504, "TEMPORARILY_UNAVAILABLE", true],
      [404, "UPSTREAM_ERROR"],
      [418, "UPSTREAM_ERROR"],
    ];
    for (const [status, code, retryable] of table) {
      const error = toRegistrationGateError(new EmumetApiError(status, "SECRET-BODY database password=hunter2"));
      expect(error.extensions["code"], String(status)).toBe(code);
      expect(error.extensions["upstreamStatus"]).toBe(status);
      expect(error.extensions["retryable"] === true, String(status)).toBe(retryable === true);
      expect(JSON.stringify([error.message, error.extensions])).not.toContain("hunter2");
    }
    expect(toRegistrationGateError(new EmumetInvalidResponseError("x")).extensions["code"]).toBe("INVALID_UPSTREAM_RESPONSE");
    expect(toRegistrationGateError(new Error("boom")).extensions["code"]).toBe("INTERNAL_SERVER_ERROR");
    expect(toRegistrationGateError(new Error("boom")).message).toBe("Internal server error");
  });
});

describe("(b') エラー分類 (real クライアント + 上流応答 stub、BFF から GraphQL まで)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    Object.assign(globalThis, { fetch: originalFetch });
  });

  async function realContext() {
    return authenticated(createRealEmumetClient({ baseUrl: "http://emumet.test", registrationGateTimeoutMs: 50 }, "tok"));
  }

  test("上流の 401/403/409/422/400 が別々のコードになる", async () => {
    const expected: [number, string][] = [
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [409, "REVISION_CONFLICT"],
      [422, "PRECONDITION_FAILED"],
      [400, "BAD_REQUEST"],
    ];
    for (const [status, code] of expected) {
      stubFetch(() => new Response("", { status }));
      const result = await run("mutation { openRegistrationGate(revision: 1) { revision } }", await realContext());
      expect(failure(result).code, String(status)).toBe(code);
      expect(result.data).toBeNull();
    }
  });

  test("上流の 5xx・接続失敗・タイムアウトは一時障害、契約違反の 200 は INVALID_UPSTREAM_RESPONSE", async () => {
    const query = "{ registrationGate { revision } }";
    stubFetch(() => new Response("", { status: 503 }));
    expect(failure(await run(query, await realContext())).code).toBe("TEMPORARILY_UNAVAILABLE");
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(failure(await run(query, await realContext())).code).toBe("TEMPORARILY_UNAVAILABLE");
    Object.assign(globalThis, {
      fetch: (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    });
    expect(failure(await run(query, await realContext())).code).toBe("TEMPORARILY_UNAVAILABLE");
    stubFetch(() => jsonResponse(200, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, decision: "reopened" }));
    const invalid = failure(await run(query, await realContext()));
    expect(invalid.code).toBe("INVALID_UPSTREAM_RESPONSE");
    expect(invalid.message).not.toContain("reopened");
  });

  test("real の成功応答は GraphQL の状態になり、snake_case は露出しない", async () => {
    stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.stopped_awaiting_resume));
    const result = await run(`{ registrationGate { ${STATE_FIELDS} } }`, await realContext());
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      registrationGate: {
        revision: 13,
        adminState: "OPEN",
        decision: "STOPPED",
        accepting: false,
        requiresManualResume: true,
        configLostLatch: true,
        healthEpisode: "NONE",
        enforcedProtections: [],
        degradedProtections: [],
        override: { active: false, activatedBy: null, activatedAt: null },
        observation: { email: { configured: true, probe: "HEALTHY" }, bot: { configured: true, probe: "HEALTHY" } },
        updatedAt: "2026-11-10T01:35:00Z",
      },
    });
  });

  test("上流が余分なフィールド (secret 等) を返しても GraphQL 応答には出ない", async () => {
    stubFetch(() => jsonResponse(200, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, webhook_secret: "whsec_123", endpoint: "https://hooks.example/abc?token=zzz" }));
    const result = await run(`{ registrationGate { ${STATE_FIELDS} } }`, await realContext());
    expect(JSON.stringify(result)).not.toMatch(/whsec_123|hooks\.example|token=zzz/);
  });
});

describe("(c) 状態とエラーは別の型", () => {
  test("全 fixture 状態が成功した状態として取得でき、手動再開が必要・閉鎖・一時拒否はエラーにならない", async () => {
    for (const name of REGISTRATION_GATE_FIXTURE_NAMES) {
      const context = await authenticated(createMockEmumetClient({ registrationGate: { fixture: name } }));
      const result = await run(`{ registrationGate { ${STATE_FIELDS} } }`, context);
      expect(result.errors, name).toBeUndefined();
      const gate = (result.data as { registrationGate: { decision: string; requiresManualResume: boolean; override: { active: boolean } } }).registrationGate;
      expect(gate.requiresManualResume, name).toBe(gate.decision === "STOPPED");
      expect(gate.override.active, name).toBe(REGISTRATION_GATE_FIXTURES[name].override.active);
    }
  });

  test("通知一覧と未読件数・既読化 (mock)", async () => {
    const emumet = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected", notifications: "mixed" } });
    const context = await authenticated(emumet);
    const list = await run(
      "{ registrationGateNotifications(limit: 2) { unreadCount nextCursor notifications { id kind actor read readAt revision createdAt observation { email { probe } } } } registrationGateUnreadCount }",
      context,
    );
    expect(list.errors).toBeUndefined();
    const data = list.data as { registrationGateNotifications: { unreadCount: number; nextCursor: string | null; notifications: { id: string; kind: string; read: boolean }[] }; registrationGateUnreadCount: number };
    expect(data.registrationGateUnreadCount).toBe(1);
    expect(data.registrationGateNotifications.notifications.map((item) => [item.id, item.kind, item.read])).toEqual([
      ["303", "OVERRIDE_STARTED", false],
      ["302", "PROTECTION_DEGRADED", true],
    ]);
    expect(data.registrationGateNotifications.nextCursor).toBe("302");
    const marked = await run('mutation { markRegistrationGateNotificationsRead(eventIds: ["303"]) }', context);
    expect(marked.data).toEqual({ markRegistrationGateNotificationsRead: 0 });
  });
});

describe("(d) secret 非表示・Webhook は配送状態と操作のみ", () => {
  const registrationTypes = () =>
    Object.values(schema.getTypeMap()).filter(
      (type): type is GraphQLObjectType | GraphQLEnumType => type.name.startsWith("Registration") && (isObjectType(type) || isEnumType(type)),
    );

  test("登録ゲートの型に secret・URL・署名・トークンに当たるフィールドは無い", () => {
    const names = registrationTypes().flatMap((type) => (isObjectType(type) ? Object.keys(type.getFields()) : type.getValues().map((value) => value.name)));
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((name) => /secret|signature|token|password|url|endpoint|hmac|credential/i.test(name))).toEqual([]);
  });

  test("Webhook は配送状態・テスト送信・再試行だけを扱う (endpoint・secret の登録・編集はサーバー設定のみで schema に無い)", () => {
    const fields = [...Object.keys(schema.getQueryType()?.getFields() ?? {}), ...Object.keys(schema.getMutationType()?.getFields() ?? {})];
    expect(fields.filter((name) => /webhook/i.test(name)).sort()).toEqual([
      "registrationWebhook",
      "retryRegistrationWebhook",
      "sendRegistrationWebhookTest",
    ]);
    const status = schema.getType("RegistrationWebhookStatus");
    expect(isObjectType(status) ? Object.keys(status.getFields()).sort() : []).toEqual([
      "configuration",
      "counts",
      "destinationHost",
      "issue",
      "lastFailureAt",
      "lastSuccessAt",
      "recentDeliveries",
    ]);
  });
});

// Yoga の既定マスキングは originalError が通常の Error の GraphQLError を INTERNAL_SERVER_ERROR に置換する。
// graphql() 直実行では見えないため、実際の /graphql ハンドラ (createYogaHandler) 経由で分類が保たれることを固定する。
describe("(e) HTTP 経路 (createYogaHandler) でもエラー分類が保たれる", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    Object.assign(globalThis, { fetch: originalFetch });
  });

  const cookie = `ratcap_session=${encodeMockCookie({ token: "t", username: "admin" })}`;
  const UPSTREAM_SECRET = "SECRET-BODY database password=hunter2";

  type HttpResult = { status: number; body: { data: unknown; errors?: { message: string; extensions: Record<string, unknown> }[] } };

  async function post(handler: (req: Request) => Promise<Response>, query: string): Promise<HttpResult> {
    const response = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ query }),
      }),
    );
    return { status: response.status, body: (await response.json()) as HttpResult["body"] };
  }

  function realHandler(timeoutMs = 50) {
    return createYogaHandler(createMockSessionAdapter("ratcap_session", false), (token) =>
      createRealEmumetClient({ baseUrl: "http://emumet.test", registrationGateTimeoutMs: timeoutMs }, token),
    );
  }

  const MUTATION = "mutation { openRegistrationGate(revision: 1) { revision } }";
  const QUERY = "{ registrationGate { revision } }";

  test("上流 401/403/409/422/400 は HTTP 経路でも別々のコードのまま、上流本文は出ない", async () => {
    const expected: [number, string][] = [
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [409, "REVISION_CONFLICT"],
      [422, "PRECONDITION_FAILED"],
      [400, "BAD_REQUEST"],
    ];
    for (const [status, code] of expected) {
      stubFetch(() => new Response(UPSTREAM_SECRET, { status }));
      const { body } = await post(realHandler(), MUTATION);
      expect(body.errors?.[0]?.extensions["code"], String(status)).toBe(code);
      expect(body.errors?.[0]?.extensions["upstreamStatus"]).toBe(status);
      expect(JSON.stringify(body)).not.toContain("hunter2");
      expect(body.data).toBeNull();
    }
  });

  test("503・接続失敗・タイムアウトは TEMPORARILY_UNAVAILABLE + retryable のまま", async () => {
    stubFetch(() => new Response(UPSTREAM_SECRET, { status: 503 }));
    const unavailable = (await post(realHandler(), QUERY)).body.errors?.[0];
    expect(unavailable?.extensions["code"]).toBe("TEMPORARILY_UNAVAILABLE");
    expect(unavailable?.extensions["retryable"]).toBe(true);
    expect(unavailable?.extensions["upstreamStatus"]).toBe(503);

    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const network = (await post(realHandler(), QUERY)).body.errors?.[0];
    expect(network?.extensions["code"]).toBe("TEMPORARILY_UNAVAILABLE");
    expect(network?.extensions["retryable"]).toBe(true);

    Object.assign(globalThis, {
      fetch: (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    });
    const timeout = (await post(realHandler(30), QUERY)).body.errors?.[0];
    expect(timeout?.extensions["code"]).toBe("TEMPORARILY_UNAVAILABLE");
    expect(timeout?.extensions["retryable"]).toBe(true);
  });

  test("契約違反の 200 は INVALID_UPSTREAM_RESPONSE、想定外の内部エラーは従来どおり INTERNAL_SERVER_ERROR (詳細非公開)", async () => {
    stubFetch(() => jsonResponse(200, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, decision: "reopened" }));
    const invalid = (await post(realHandler(), QUERY)).body.errors?.[0];
    expect(invalid?.extensions["code"]).toBe("INVALID_UPSTREAM_RESPONSE");
    expect(JSON.stringify(invalid)).not.toContain("reopened");

    const broken: EmumetClient = createMockEmumetClient();
    Object.assign(broken, { getRegistrationGate: () => Promise.reject(new Error("db host=10.0.0.5 exploded")) });
    const internal = await post(createYogaHandler(createMockSessionAdapter("ratcap_session", false), () => broken), QUERY);
    expect(internal.body.errors?.[0]?.extensions["code"]).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(internal.body)).not.toContain("10.0.0.5");
  });

  test("mock クライアントの非管理者 (403)・競合 (409) も HTTP 経路で区別される", async () => {
    const mock = createMockEmumetClient({ registrationGate: { fixture: "accepting_protected", role: "non-admin" } });
    const handler = createYogaHandler(createMockSessionAdapter("ratcap_session", false), () => mock);
    expect((await post(handler, QUERY)).body.errors?.[0]?.extensions["code"]).toBe("FORBIDDEN");
    mock.registrationGateControl.setRole("admin");
    expect((await post(handler, "mutation { closeRegistrationGate(revision: 1) { revision } }")).body.errors?.[0]?.extensions["code"]).toBe("REVISION_CONFLICT");
  });
});
