// ============================================================
// 登録ゲート管理画面 (F15 画面 PR) で追加した BFF の契約テスト
//  - 管理画面の状態 (status) と最低条件 (minimumMet) の導出 (1 関数に閉じ込めた判定の固定)
//  - E15d: 適用証明 (enforcement) の喪失・復旧の REST 変換と stateful mock の状態遷移
//  - E15c: 保護の readiness 一覧・入力なしの再検証
//  - E15w: Webhook 配送状態・テスト送信・再試行 (宛先は host のみ。secret・URL 全体は扱わない)
//  - GET /api/v1/me (管理画面の導線のヒント。権限判断の正本ではない)
//  - GraphQL のエラー分類 (FORBIDDEN / WEBHOOK_NOT_CONFIGURED / NOT_FOUND / TEMPORARILY_UNAVAILABLE)
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { graphql, type GraphQLSchema } from "graphql";
import type { SessionAdapter } from "@shuttlepub/auth-bun";
import { describeViolations, violationsForResponse } from "./openapi/contract.ts";
import { buildContext, type GraphQLContext } from "./context.ts";
import { makeSchema } from "./schema.ts";
import { resolvers } from "./resolvers.ts";
import { createMockEmumetClient } from "./emumet/mock.ts";
import { createRealEmumetClient } from "./emumet/real.ts";
import { EmumetApiError, type EmumetClient } from "./emumet/client.ts";
import {
  ENFORCEMENT_NOTIFICATION_FIXTURES,
  ME_FIXTURES,
  PROTECTION_LIST_FIXTURES,
  REGISTRATION_GATE_FIXTURES,
  REGISTRATION_GATE_FIXTURE_NAMES,
  VERIFY_PROTECTION_FIXTURES,
  WEBHOOK_RETRY_FIXTURES,
  WEBHOOK_STATUS_FIXTURES,
  WEBHOOK_TEST_FIXTURES,
} from "./emumet/registration-gate-fixtures.ts";
import { createMockRegistrationGate, registrationGateFromFixture } from "./emumet/registration-gate-mock.ts";
import { REGISTRATION_GATE_SCENARIOS } from "./emumet/registration-gate-scenarios.ts";
import {
  EmumetInvalidResponseError,
  EmumetRegistrationTargetNotFoundError,
  EmumetUnavailableError,
  EmumetWebhookUnavailableError,
  type RegistrationObservation,
} from "./emumet/registration-gate.ts";
import { registrationGateStatus, registrationMinimumMet } from "./registration-gate-status.ts";
import { isAdminPath, loadAdminSsrState } from "./admin-ssr.ts";
import { jsonResponse, stubFetch } from "./test-utils.ts";

const GATE = "/api/v1/admin/registration-gate";
const BASE = "http://emumet.test";
const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

describe("管理画面の状態 (registrationGateStatus) は decision を優先して 1 関数で決まる", () => {
  const expected: Record<string, string> = {
    accepting_protected: "OPEN",
    accepting_email_only: "OPEN",
    accepting_degraded_bot: "OPEN",
    accepting_degraded_email: "OPEN",
    admin_closed: "ADMIN_STOPPED",
    not_ready: "NOT_OPENED",
    not_ready_unverified: "NOT_OPENED",
    temporary_reject: "TEMPORARILY_SUSPENDED",
    stopped_config_lost: "AUTO_STOPPED",
    stopped_awaiting_resume: "AUTO_STOPPED",
    override_unprotected: "OVERRIDE",
    override_protected: "OVERRIDE",
    override_degraded: "OVERRIDE",
    // override 値は保持したまま閉鎖・適用証明喪失: decision を優先する (警告帯は override.active で別に出す)
    override_admin_closed: "ADMIN_STOPPED",
    stopped_enforcement_lost: "AUTO_STOPPED",
    stopped_enforcement_restored: "AUTO_STOPPED",
  };

  test("全 fixture に期待値がある", () => {
    expect(Object.keys(expected).sort()).toEqual([...REGISTRATION_GATE_FIXTURE_NAMES].sort());
  });

  for (const name of REGISTRATION_GATE_FIXTURE_NAMES) {
    test(name, () => {
      expect(registrationGateStatus(registrationGateFromFixture(name))).toBe(expected[name] as ReturnType<typeof registrationGateStatus>);
    });
  }

  test("未開放は closed かつ revision 0 のときだけ (一度でも遷移した closed は停止中)", () => {
    const initial = registrationGateFromFixture("not_ready");
    expect(registrationGateStatus(initial)).toBe("NOT_OPENED");
    expect(registrationGateStatus({ ...initial, revision: 1 })).toBe("ADMIN_STOPPED");
  });

  test("最低条件はどちらかの保護が設定済みかつ応答ありのときだけ満たす", () => {
    const obs = (email: [boolean, "HEALTHY" | "UNHEALTHY" | "UNKNOWN"], bot: [boolean, "HEALTHY" | "UNHEALTHY" | "UNKNOWN"]): RegistrationObservation => ({
      enforcementVerified: true,
      email: { configured: email[0], probe: email[1] },
      bot: { configured: bot[0], probe: bot[1] },
    });
    expect(registrationMinimumMet(obs([true, "HEALTHY"], [false, "UNKNOWN"]))).toBe(true);
    expect(registrationMinimumMet(obs([false, "UNKNOWN"], [true, "HEALTHY"]))).toBe(true);
    expect(registrationMinimumMet(obs([true, "UNHEALTHY"], [true, "UNKNOWN"]))).toBe(false);
    expect(registrationMinimumMet(obs([false, "HEALTHY"], [false, "UNKNOWN"]))).toBe(false);
  });
});

describe("追加 fixture は固定した OpenAPI 契約に適合する", () => {
  const check = (path: string, method: "get" | "post", body: unknown) =>
    expect(describeViolations(violationsForResponse({ path, method, status: "200" }, body)), `${method} ${path}`).toBe("");

  test("保護の readiness 一覧・検証結果", () => {
    for (const body of Object.values(PROTECTION_LIST_FIXTURES)) check(`${GATE}/protections`, "get", body);
    for (const body of Object.values(VERIFY_PROTECTION_FIXTURES)) check(`${GATE}/protections/{protection}/verify`, "post", body);
  });

  test("Webhook 状態・テスト送信・再試行", () => {
    for (const body of Object.values(WEBHOOK_STATUS_FIXTURES)) check(`${GATE}/webhook`, "get", body);
    for (const body of Object.values(WEBHOOK_TEST_FIXTURES)) check(`${GATE}/webhook/test`, "post", body);
    for (const body of Object.values(WEBHOOK_RETRY_FIXTURES)) check(`${GATE}/webhook/retry`, "post", body);
  });

  test("GET /api/v1/me と E15d の通知", () => {
    for (const body of Object.values(ME_FIXTURES)) check("/api/v1/me", "get", body);
    check(`${GATE}/notifications`, "get", ENFORCEMENT_NOTIFICATION_FIXTURES);
  });

  test("Webhook fixture は未設定・設定不備・正常・再試行中・失敗を網羅し、宛先は host のみ", () => {
    const configurations = Object.values(WEBHOOK_STATUS_FIXTURES).map((body) => body.configuration);
    expect(new Set(configurations)).toEqual(new Set(["not_configured", "misconfigured", "configured"]));
    const statuses = Object.values(WEBHOOK_STATUS_FIXTURES).flatMap((body) => body.recent_deliveries.map((delivery) => delivery.status));
    for (const status of ["delivered", "retrying", "failed"]) expect(statuses).toContain(status);
    for (const body of Object.values(WEBHOOK_STATUS_FIXTURES)) {
      expect(JSON.stringify(body)).not.toMatch(/https?:|secret_value|\/\//);
    }
  });
});

describe("REST 変換 (real)", () => {
  function client(): EmumetClient {
    return createRealEmumetClient({ baseUrl: BASE }, "token");
  }

  test("E15d: enforcement の値と通知種別を変換する (語彙外で fail closed にしない)", async () => {
    stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.stopped_enforcement_lost));
    const gate = await client().getRegistrationGate();
    expect(gate.enforcementLostLatch).toBe(true);
    expect(gate.observation.enforcementVerified).toBe(false);
    expect(gate.override.active).toBe(true);
    stubFetch(() => jsonResponse(200, ENFORCEMENT_NOTIFICATION_FIXTURES));
    const page = await client().listRegistrationGateNotifications();
    expect(page.notifications.map((item) => item.kind)).toEqual(["ENFORCEMENT_RESTORED", "ENFORCEMENT_LOST_STOPPED"]);
  });

  test("保護の一覧と検証: path・method・空の body、readiness を変換する (fingerprint・generation は出さない)", async () => {
    const { calls } = stubFetch((call) =>
      call.url.endsWith("/verify")
        ? jsonResponse(200, VERIFY_PROTECTION_FIXTURES.email_pending)
        : jsonResponse(200, PROTECTION_LIST_FIXTURES.email_unset_bot_invalid),
    );
    const list = await client().listRegistrationProtections();
    expect(list).toEqual([
      { protection: "EMAIL", enabled: false, status: "CONFIGURATION_INVALID", reason: "not_configured", checkedAt: null, validUntil: null },
      { protection: "BOT", enabled: true, status: "CONFIGURATION_INVALID", reason: "invalid_secret", checkedAt: "2026-11-10T03:41:00Z", validUntil: null },
    ]);
    const result = await client().verifyRegistrationProtection("EMAIL");
    expect(result.disposition).toBe("PENDING_CONFIRMATION");
    expect(result.readiness.status).toBe("UNVERIFIED");
    expect(calls.map((call) => [call.method, call.url.replace(BASE, ""), call.body === undefined ? undefined : JSON.parse(call.body)])).toEqual([
      ["GET", `${GATE}/protections`, undefined],
      ["POST", `${GATE}/protections/email/verify`, {}],
    ]);
    expect(JSON.stringify(list)).not.toContain("fp-");
  });

  test("Webhook: 状態の変換・テスト送信・event_id 指定の再試行", async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.endsWith("/test")) return jsonResponse(200, WEBHOOK_TEST_FIXTURES.failure);
      if (call.url.endsWith("/retry")) return jsonResponse(200, WEBHOOK_RETRY_FIXTURES.one);
      return jsonResponse(200, WEBHOOK_STATUS_FIXTURES.failed);
    });
    const status = await client().getRegistrationWebhookStatus();
    expect(status.configuration).toBe("CONFIGURED");
    expect(status.destinationHost).toBe("hooks.example.net");
    expect(status.counts.failed).toBe(2);
    expect(status.recentDeliveries[0]).toMatchObject({ eventId: "13", eventType: "OUTAGE_STARTED", status: "FAILED", failureReason: "retries_exhausted" });
    expect(await client().sendRegistrationWebhookTest()).toEqual({ delivered: false, result: "http_server_error", httpStatus: 503, attemptedAt: "2026-11-10T03:50:00Z" });
    expect(await client().retryRegistrationWebhook("13")).toBe(1);
    expect(calls.map((call) => [call.method, call.url.replace(BASE, ""), call.body === undefined ? undefined : JSON.parse(call.body)])).toEqual([
      ["GET", `${GATE}/webhook`, undefined],
      ["POST", `${GATE}/webhook/test`, undefined],
      ["POST", `${GATE}/webhook/retry`, { event_id: "13" }],
    ]);
  });

  test("Webhook: テスト送信の 409 は未設定エラー、再試行の 404 は対象なし (revision 競合とは別)", async () => {
    stubFetch(() => new Response("", { status: 409 }));
    await expect(client().sendRegistrationWebhookTest()).rejects.toBeInstanceOf(EmumetWebhookUnavailableError);
    stubFetch(() => new Response("", { status: 404 }));
    await expect(client().retryRegistrationWebhook("99")).rejects.toBeInstanceOf(EmumetRegistrationTargetNotFoundError);
    stubFetch(() => new Response("", { status: 403 }));
    await expect(client().getRegistrationWebhookStatus()).rejects.toMatchObject({ status: 403 });
  });

  test("Webhook: host 以外 (path・userinfo) を含む宛先は契約違反として受け入れない", async () => {
    for (const host of ["hooks.example.net/secret-path", "user:pw@hooks.example.net", "hooks.example.net:8443"]) {
      stubFetch(() => jsonResponse(200, { ...WEBHOOK_STATUS_FIXTURES.healthy, destination_host: host }));
      await expect(client().getRegistrationWebhookStatus()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
    }
  });

  test("me: 管理者ロールを変換し、未知のロールは捨てる。503 は一時障害", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { account_id: "1", instance_roles: ["admin", "owner", "admin"] }));
    expect(await client().getViewer()).toEqual({ accountId: "1", instanceRoles: ["ADMIN"] });
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/me`);
    stubFetch(() => new Response("", { status: 503 }));
    await expect(client().getViewer()).rejects.toMatchObject({ status: 503 });
  });
});

describe("stateful mock: E15d の適用証明ラッチ", () => {
  function fixed() {
    let tick = 0;
    return () => `2026-12-01T00:00:${String(tick++).padStart(2, "0")}Z`;
  }

  test("証明の喪失は override 中でも停止し、通知を出す。証明が戻るまで開放・override は 422", async () => {
    const { client, control } = createMockRegistrationGate({ fixture: "override_protected", now: fixed() });
    const before = control.snapshot();
    control.observe({ ...before.observation, enforcementVerified: false });
    const stopped = control.snapshot();
    expect(stopped.decision).toBe("STOPPED");
    expect(stopped.enforcementLostLatch).toBe(true);
    expect(stopped.override.active).toBe(true);
    expect(stopped.revision).toBe(before.revision + 1);
    await expect(client.openRegistrationGate(stopped.revision)).rejects.toMatchObject({ status: 422 });
    await expect(client.enableRegistrationGateOverride(stopped.revision, true)).rejects.toMatchObject({ status: 422 });
    const page = await client.listRegistrationGateNotifications();
    expect(page.notifications[0]?.kind).toBe("ENFORCEMENT_LOST_STOPPED");
  });

  test("証明が戻ってもラッチは残り、手動再開 (open) で通常判定に戻る。無保護の再開は override の再確認が必要", async () => {
    const { client, control } = createMockRegistrationGate({ fixture: "stopped_enforcement_lost", now: fixed() });
    control.observe({ ...control.snapshot().observation, enforcementVerified: true });
    const restored = control.snapshot();
    expect(restored.decision).toBe("STOPPED");
    expect((await client.listRegistrationGateNotifications()).notifications[0]?.kind).toBe("ENFORCEMENT_RESTORED");
    const reopened = await client.openRegistrationGate(restored.revision);
    expect(reopened.enforcementLostLatch).toBe(false);
    expect(reopened.decision).toBe("ACCEPTING");

    const unprotected = createMockRegistrationGate({ fixture: "stopped_enforcement_lost", now: fixed() });
    unprotected.control.setProtections([...PROTECTION_LIST_FIXTURES.unset.protections]);
    unprotected.control.observe({ ...unprotected.control.snapshot().observation, enforcementVerified: true });
    const gate = unprotected.control.snapshot();
    await expect(unprotected.client.openRegistrationGate(gate.revision)).rejects.toMatchObject({ status: 422 });
    await expect(unprotected.client.enableRegistrationGateOverride(gate.revision, false)).rejects.toMatchObject({ status: 400 });
    const resumed = await unprotected.client.enableRegistrationGateOverride(gate.revision, true);
    expect(resumed.decision).toBe("ACCEPTING");
    expect(resumed.enforcementLostLatch).toBe(false);
  });
});

describe("stateful mock: 保護・Webhook・呼び出し者", () => {
  test("readiness と観測は Emumet の to_observation で対応し、未設定と設定エラーは readiness だけが区別する", async () => {
    const { client, control } = createMockRegistrationGate({
      fixture: "stopped_config_lost",
      protections: [...PROTECTION_LIST_FIXTURES.email_unset_bot_invalid.protections],
    });
    const list = await client.listRegistrationProtections();
    expect(list.map((item) => [item.protection, item.enabled, item.status])).toEqual([
      ["EMAIL", false, "CONFIGURATION_INVALID"],
      ["BOT", true, "CONFIGURATION_INVALID"],
    ]);
    expect(control.snapshot().observation.bot.configured).toBe(false);
  });

  test("観測と矛盾する readiness の組合せは初期化で拒否する", () => {
    expect(() => createMockRegistrationGate({ fixture: "accepting_protected", protections: [...PROTECTION_LIST_FIXTURES.unset.protections] })).toThrow();
  });

  test("入力なしの再検証は状態を準備済みにしない (メールは確認待ち、BOT は負の probe)", async () => {
    const { client } = createMockRegistrationGate({ fixture: "not_ready_unverified", protections: [...PROTECTION_LIST_FIXTURES.email_unverified_bot_unset.protections] });
    const email = await client.verifyRegistrationProtection("EMAIL");
    expect(email.disposition).toBe("PENDING_CONFIRMATION");
    expect(email.readiness.status).toBe("UNVERIFIED");
    const bot = await client.verifyRegistrationProtection("BOT");
    expect(bot.outcome).toBe("CONFIGURATION_INVALID");
  });

  test("Webhook: 未設定のテスト送信は未設定エラー、失敗の再試行で件数が変わる、対象なしは NotFound", async () => {
    const { client, control } = createMockRegistrationGate({ webhook: "not_configured" });
    await expect(client.sendRegistrationWebhookTest()).rejects.toBeInstanceOf(EmumetWebhookUnavailableError);
    control.setWebhook("failed");
    expect((await client.getRegistrationWebhookStatus()).counts.failed).toBe(2);
    expect((await client.sendRegistrationWebhookTest()).delivered).toBe(false);
    expect(await client.retryRegistrationWebhook("13")).toBe(1);
    const after = await client.getRegistrationWebhookStatus();
    expect(after.counts.failed).toBe(1);
    expect(after.counts.pending).toBe(1);
    await expect(client.retryRegistrationWebhook("13")).rejects.toBeInstanceOf(EmumetRegistrationTargetNotFoundError);
  });

  test("非管理者: 呼び出し者は取得できるが管理 API はすべて 403", async () => {
    const { client } = createMockRegistrationGate({ role: "non-admin" });
    expect(await client.getViewer()).toMatchObject({ instanceRoles: [] });
    for (const call of [
      () => client.listRegistrationProtections(),
      () => client.verifyRegistrationProtection("EMAIL"),
      () => client.getRegistrationWebhookStatus(),
      () => client.sendRegistrationWebhookTest(),
      () => client.retryRegistrationWebhook(),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
  });

  test("画面シナリオはすべて矛盾なく読み込め、期待する状態になる", () => {
    const expected: Record<string, string> = {
      default: "NOT_OPENED",
      "not-opened": "NOT_OPENED",
      open: "OPEN",
      "open-degraded": "OPEN",
      suspended: "TEMPORARILY_SUSPENDED",
      "auto-stopped": "AUTO_STOPPED",
      "auto-stopped-recovered": "AUTO_STOPPED",
      "admin-stopped": "ADMIN_STOPPED",
      override: "OVERRIDE",
      "override-ready": "OVERRIDE",
      "enforcement-lost": "AUTO_STOPPED",
      "webhook-unset": "OPEN",
      "webhook-misconfigured": "OPEN",
      "notifications-many": "OPEN",
      member: "OPEN",
    };
    expect(Object.keys(expected).sort()).toEqual(Object.keys(REGISTRATION_GATE_SCENARIOS).sort());
    const mock = createMockRegistrationGate();
    for (const [name, options] of Object.entries(REGISTRATION_GATE_SCENARIOS)) {
      mock.control.reset(options);
      expect(registrationGateStatus(mock.control.snapshot()), name).toBe(expected[name] as ReturnType<typeof registrationGateStatus>);
    }
  });
});

describe("GraphQL: 追加フィールドとエラー分類", () => {
  const schema: GraphQLSchema = makeSchema(resolvers);
  const adapter: SessionAdapter = {
    getSession: () => Promise.resolve({ accessToken: "t" }),
    refreshSessionIfNeeded: (session) => Promise.resolve({ kind: "fresh", accessToken: session.accessToken }),
    sealSessionCookie: () => Promise.resolve(""),
    clearSessionCookie: () => "",
  };
  const context = (emumet: EmumetClient): Promise<GraphQLContext> =>
    buildContext(new Request("http://localhost/graphql"), { adapter, createEmumetClient: () => emumet });
  const run = async (source: string, emumet: EmumetClient) => graphql({ schema, source, contextValue: await context(emumet) });
  const code = (result: Awaited<ReturnType<typeof run>>) => String(result.errors?.[0]?.extensions?.["code"]);

  test("viewer.isAdmin・status・minimumMet・enforcement を返す", async () => {
    const mock = createMockEmumetClient({ registrationGate: { fixture: "stopped_enforcement_lost" } });
    const result = await run(
      "{ viewer { isAdmin instanceRoles } registrationGate { status minimumMet enforcementLostLatch override { active } observation { enforcementVerified } } }",
      mock,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: { isAdmin: true, instanceRoles: ["ADMIN"] },
      registrationGate: { status: "AUTO_STOPPED", minimumMet: true, enforcementLostLatch: true, override: { active: true }, observation: { enforcementVerified: false } },
    });
  });

  test("非管理者: viewer は isAdmin=false で成功し、管理クエリは FORBIDDEN (データを返さない)", async () => {
    const mock = createMockEmumetClient({ registrationGate: { role: "non-admin" } });
    expect((await run("{ viewer { isAdmin } }", mock)).data).toEqual({ viewer: { isAdmin: false } });
    for (const source of [
      "{ registrationProtections { status } }",
      "{ registrationWebhook { configuration } }",
      "mutation { verifyRegistrationProtection(protection: EMAIL) { outcome } }",
      "mutation { sendRegistrationWebhookTest { delivered } }",
      "mutation { retryRegistrationWebhook }",
    ]) {
      const result = await run(source, mock);
      expect(code(result), source).toBe("FORBIDDEN");
      expect(result.data, source).toBeNull();
    }
  });

  test("Webhook 未設定のテスト送信は WEBHOOK_NOT_CONFIGURED、再試行の対象なしは NOT_FOUND、一時障害は retryable", async () => {
    const mock = createMockEmumetClient({ registrationGate: { webhook: "misconfigured" } });
    expect(code(await run("mutation { sendRegistrationWebhookTest { delivered } }", mock))).toBe("WEBHOOK_NOT_CONFIGURED");
    expect(code(await run('mutation { retryRegistrationWebhook(eventId: "404") }', mock))).toBe("NOT_FOUND");
    mock.registrationGateControl.failNext(new EmumetUnavailableError("down"));
    const temporary = await run("{ registrationWebhook { configuration } }", mock);
    expect(code(temporary)).toBe("TEMPORARILY_UNAVAILABLE");
    expect(temporary.errors?.[0]?.extensions?.["retryable"]).toBe(true);
    mock.registrationGateControl.failNext(new EmumetApiError(401, ""));
    expect(code(await run("{ viewer { isAdmin } }", mock))).toBe("UNAUTHENTICATED");
  });

  test("Webhook の応答に secret・URL 全体は現れない", async () => {
    const mock = createMockEmumetClient({ registrationGate: { webhook: "failed" } });
    const result = await run(
      "{ registrationWebhook { configuration issue destinationHost counts { failed } recentDeliveries { eventId eventType status lastResult failureReason } } }",
      mock,
    );
    expect(result.errors).toBeUndefined();
    expect(JSON.stringify(result.data)).not.toMatch(/https?:|\/\/|secret/i);
  });
});

describe("管理画面の SSR 初期状態 (bff/admin-ssr.ts)", () => {
  test("管理者: 呼び出し者と状態チップ・警告帯に要る値だけを渡す (secret・観測の詳細は渡さない)", async () => {
    const mock = createMockRegistrationGate({ fixture: "override_unprotected" });
    const state = await loadAdminSsrState(mock.client, "admin@example.com");
    expect(state).toEqual({
      username: "admin@example.com",
      isAdmin: true,
      forbidden: false,
      gate: { revision: 14, status: "OVERRIDE", minimumMet: false, adminOpen: true, overrideActive: true, enforcementVerified: true },
    });
  });

  test("非管理者は isAdmin=false (404 を描画)、管理 API の 403 は forbidden=true", async () => {
    expect(await loadAdminSsrState(createMockRegistrationGate({ role: "non-admin" }).client, "m")).toEqual({ username: "m", isAdmin: false, forbidden: false, gate: null });
    const forbidden = createMockRegistrationGate();
    // viewer は管理者だが、状態の取得が 403 になるケース
    const viewerAdminGate403 = {
      ...forbidden.client,
      getViewer: async () => ({ accountId: "1", instanceRoles: ["ADMIN" as const] }),
      getRegistrationGate: async () => {
        throw new EmumetApiError(403, "");
      },
    };
    expect(await loadAdminSsrState(viewerAdminGate403, "x")).toEqual({ username: "x", isAdmin: false, forbidden: true, gate: null });
  });

  test("未認証・呼び出し者が取れないときは null (クライアントで取得)、状態の一時障害は枠だけ描画", async () => {
    const mock = createMockRegistrationGate();
    mock.control.failNext(new EmumetApiError(401, ""));
    expect(await loadAdminSsrState(mock.client, "x")).toBeNull();
    const unavailable = {
      ...mock.client,
      getRegistrationGate: async () => {
        throw new EmumetUnavailableError("down");
      },
    };
    expect(await loadAdminSsrState(unavailable, "x")).toEqual({ username: "x", isAdmin: true, forbidden: false, gate: null });
  });

  test("管理画面の SSR 対象は /admin/registration と /admin/webhook だけ", () => {
    expect(isAdminPath("/admin/registration")).toBe(true);
    expect(isAdminPath("/admin/webhook")).toBe(true);
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/admin/other")).toBe(false);
  });
});

describe("通知の次ページ (stateful mock の notifications=many)", () => {
  test("1 ページ目 50 件と nextCursor、2 ページ目で残り 12 件に到達できる", async () => {
    const { client } = createMockRegistrationGate({ notifications: "many" });
    const first = await client.listRegistrationGateNotifications({ limit: 50 });
    expect(first.notifications).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.listRegistrationGateNotifications({ limit: 50, before: first.nextCursor ?? "" });
    expect(second.notifications).toHaveLength(12);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.notifications, ...second.notifications].map((item) => item.id)).size).toBe(62);
  });
});
