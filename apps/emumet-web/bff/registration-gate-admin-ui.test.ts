// ============================================================
// 登録ゲート管理画面 (F15 画面 PR) で追加した BFF の契約テスト
//  - 管理画面の状態 (status) と最低条件 (minimumMet) の導出 (1 関数に閉じ込めた判定の固定)
//  - E15d: 適用証明 (enforcement) の喪失・復旧の REST 変換と stateful mock の状態遷移
//  - E15c: 保護の readiness 一覧・入力なしの再検証
//  - E15x: Webhook 送信先の登録・更新・削除・テスト送信・配送失敗の再試行 (URL は部分マスク形だけ。secret は返さない)
//  - GET /api/v1/me (管理画面の導線のヒント。権限判断の正本ではない)
//  - GraphQL のエラー分類 (FORBIDDEN / REVISION_CONFLICT / WEBHOOK_ENDPOINT_REJECTED / WEBHOOK_NOT_CONFIGURED / NOT_FOUND / TEMPORARILY_UNAVAILABLE)
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
  WEBHOOK_FIXTURES,
  WEBHOOK_TEST_FIXTURES,
} from "./emumet/registration-gate-fixtures.ts";
import { createMockRegistrationGate, registrationGateFromFixture } from "./emumet/registration-gate-mock.ts";
import { REGISTRATION_GATE_SCENARIOS } from "./emumet/registration-gate-scenarios.ts";
import {
  EmumetInvalidResponseError,
  EmumetRegistrationTargetNotFoundError,
  EmumetUnavailableError,
  EmumetWebhookEndpointRejectedError,
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

  test("Webhook 送信先の一覧・配送失敗・テスト送信・再試行", () => {
    for (const fixture of Object.values(WEBHOOK_FIXTURES)) {
      check(`${GATE}/webhook/endpoints`, "get", fixture.list);
      check(`${GATE}/webhook/failures`, "get", { items: fixture.failures, next_cursor: null });
      for (const endpoint of fixture.list.endpoints) check(`${GATE}/webhook/endpoints/{endpoint_id}`, "get", endpoint);
    }
    for (const body of Object.values(WEBHOOK_TEST_FIXTURES)) check(`${GATE}/webhook/endpoints/{endpoint_id}/test`, "post", body);
    for (const body of Object.values(WEBHOOK_RETRY_FIXTURES)) check(`${GATE}/webhook/retry`, "post", body);
  });

  test("GET /api/v1/me と E15d の通知", () => {
    for (const body of Object.values(ME_FIXTURES)) check("/api/v1/me", "get", body);
    check(`${GATE}/notifications`, "get", ENFORCEMENT_NOTIFICATION_FIXTURES);
  });

  test("Webhook fixture は送信先なし・正常・配送失敗・複数・復号不可・環境変数 (正常/設定不備)・多数の失敗を網羅し、URL は部分マスク形だけ", () => {
    const endpoints = Object.values(WEBHOOK_FIXTURES).flatMap((fixture) => fixture.list.endpoints);
    expect(new Set(endpoints.map((endpoint) => endpoint.source))).toEqual(new Set(["api", "environment"]));
    expect(new Set(endpoints.flatMap((endpoint) => endpoint.failing_reasons))).toEqual(new Set(["failed_deliveries", "secret_undecryptable", "config_invalid"]));
    expect(WEBHOOK_FIXTURES.many_failures.failures.length).toBeGreaterThan(50);
    expect(WEBHOOK_FIXTURES.no_key.list.encryption_key_configured).toBe(false);
    for (const fixture of Object.values(WEBHOOK_FIXTURES)) {
      expect(JSON.stringify(fixture)).not.toMatch(/https?:|secret_value|\/\//);
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

  test("Webhook: 一覧・配送失敗の変換と、作成・更新・削除・テスト送信・再試行の path・method・本文", async () => {
    const { calls } = stubFetch((call) => {
      const path = call.url.replace(BASE, "");
      if (path.startsWith(`${GATE}/webhook/failures`)) return jsonResponse(200, { items: WEBHOOK_FIXTURES.failed.failures, next_cursor: "c2" });
      if (path.endsWith("/test")) return jsonResponse(200, WEBHOOK_TEST_FIXTURES.failure);
      if (path.endsWith("/retry")) return jsonResponse(200, WEBHOOK_RETRY_FIXTURES.one);
      if (path.endsWith("/delete")) return new Response(null, { status: 204 });
      if (call.method === "POST") return jsonResponse(201, WEBHOOK_FIXTURES.healthy.list.endpoints[0]);
      if (call.method === "PUT") return jsonResponse(200, WEBHOOK_FIXTURES.healthy.list.endpoints[0]);
      return jsonResponse(200, WEBHOOK_FIXTURES.multiple.list);
    });
    const list = await client().listRegistrationWebhookEndpoints();
    expect(list.hasFailedDeliveries).toBe(true);
    expect(list.endpoints.map((endpoint) => [endpoint.id, endpoint.maskedUrl, endpoint.status, endpoint.categories, endpoint.editable])).toEqual([
      ["1", "hooks.example.net/••••/a8f2", "HEALTHY", ["OUTAGE", "RECOVERY", "AUTO_STOP", "OVERRIDE"], true],
      ["2", "ops.example.org/••••/9c1e", "FAILING", ["OUTAGE", "AUTO_STOP"], true],
    ]);
    const page = await client().listRegistrationWebhookFailures({ endpointId: "1", limit: 50, before: "c1" });
    expect(page.nextCursor).toBe("c2");
    expect(page.items[0]).toMatchObject({ endpointId: "1", eventId: "13", eventType: "OUTAGE_STARTED", category: "OUTAGE" });
    await client().createRegistrationWebhookEndpoint({ url: "https://hooks.example.net/x", secret: "0123456789abcdef", categories: ["OUTAGE", "AUTO_STOP"] });
    await client().updateRegistrationWebhookEndpoint("1", { revision: 1, categories: ["RECOVERY"] });
    await client().updateRegistrationWebhookEndpoint("1", { revision: 2, secret: "fedcba9876543210" });
    await client().deleteRegistrationWebhookEndpoint("1", 3);
    expect(await client().sendRegistrationWebhookTest("2")).toEqual({ delivered: false, result: "http_server_error", httpStatus: 503, attemptedAt: "2026-11-10T03:50:00Z" });
    expect(await client().retryRegistrationWebhook({ endpointId: "2", eventId: "13" })).toBe(1);
    expect(calls.map((call) => [call.method, call.url.replace(BASE, ""), call.body === undefined ? undefined : JSON.parse(call.body)])).toEqual([
      ["GET", `${GATE}/webhook/endpoints`, undefined],
      ["GET", `${GATE}/webhook/failures?endpoint_id=1&limit=50&before=c1`, undefined],
      ["POST", `${GATE}/webhook/endpoints`, { url: "https://hooks.example.net/x", secret: "0123456789abcdef", categories: ["outage", "auto_stop"] }],
      // 省略した項目 (URL・secret) は送らない = 変更しない
      ["PUT", `${GATE}/webhook/endpoints/1`, { revision: 1, categories: ["recovery"] }],
      ["PUT", `${GATE}/webhook/endpoints/1`, { revision: 2, secret: "fedcba9876543210" }],
      ["POST", `${GATE}/webhook/endpoints/1/delete`, { revision: 3 }],
      ["POST", `${GATE}/webhook/endpoints/2/test`, undefined],
      ["POST", `${GATE}/webhook/retry`, { endpoint_id: "2", event_id: "13" }],
    ]);
  });

  test("Webhook: 409 の空本文は revision 競合、固定コードは拒否 (理由つき)、テスト送信の 409 は未設定、404 は対象なし", async () => {
    stubFetch(() => new Response("", { status: 409 }));
    await expect(client().updateRegistrationWebhookEndpoint("1", { revision: 1, url: "https://a.example/x" })).rejects.toMatchObject({ status: 409 });
    await expect(client().updateRegistrationWebhookEndpoint("1", { revision: 1, url: "https://a.example/x" })).rejects.toBeInstanceOf(EmumetApiError);
    await expect(client().sendRegistrationWebhookTest("environment")).rejects.toBeInstanceOf(EmumetWebhookUnavailableError);
    stubFetch(() => new Response("encryption_key_not_configured", { status: 409 }));
    await expect(client().createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret: "0123456789abcdef", categories: ["OUTAGE"] })).rejects.toMatchObject({
      status: 409,
      reason: "encryption_key_not_configured",
    });
    stubFetch(() => new Response("secret_too_short", { status: 400 }));
    await expect(client().createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret: "short", categories: ["OUTAGE"] })).rejects.toBeInstanceOf(
      EmumetWebhookEndpointRejectedError,
    );
    // 語彙外の 409 は競合として扱わない (理由なしの拒否)。語彙外の 400 は BAD_REQUEST のまま
    stubFetch(() => new Response("something_new", { status: 409 }));
    await expect(client().deleteRegistrationWebhookEndpoint("1", 1)).rejects.toMatchObject({ status: 409, reason: null });
    stubFetch(() => new Response("something_new", { status: 400 }));
    await expect(client().deleteRegistrationWebhookEndpoint("1", 1)).rejects.toMatchObject({ status: 400 });
    await expect(client().deleteRegistrationWebhookEndpoint("1", 1)).rejects.not.toBeInstanceOf(EmumetWebhookEndpointRejectedError);
    stubFetch(() => new Response("", { status: 404 }));
    await expect(client().retryRegistrationWebhook({ endpointId: "1", eventId: "99" })).rejects.toBeInstanceOf(EmumetRegistrationTargetNotFoundError);
    await expect(client().updateRegistrationWebhookEndpoint("9", { revision: 1, categories: ["OUTAGE"] })).rejects.toBeInstanceOf(EmumetRegistrationTargetNotFoundError);
    stubFetch(() => new Response("", { status: 403 }));
    await expect(client().listRegistrationWebhookEndpoints()).rejects.toMatchObject({ status: 403 });
  });

  test("Webhook: 部分マスクでない URL・source と editable/revision の食い違い・作成の 200 は契約違反として受け入れない", async () => {
    const endpoint = WEBHOOK_FIXTURES.healthy.list.endpoints[0]!;
    for (const masked of ["https://hooks.example.net/••••/a8f2", "hooks.example.net/secret-path", "user:pw@hooks.example.net", "hooks.example.net/••••/a8f2?x=1"]) {
      stubFetch(() => jsonResponse(200, { ...WEBHOOK_FIXTURES.healthy.list, endpoints: [{ ...endpoint, masked_url: masked }] }));
      await expect(client().listRegistrationWebhookEndpoints(), masked).rejects.toBeInstanceOf(EmumetInvalidResponseError);
    }
    stubFetch(() => jsonResponse(200, { ...WEBHOOK_FIXTURES.healthy.list, endpoints: [{ ...endpoint, editable: false }] }));
    await expect(client().listRegistrationWebhookEndpoints()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
    stubFetch(() => jsonResponse(200, endpoint));
    await expect(client().createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret: "0123456789abcdef", categories: ["OUTAGE"] })).rejects.toBeInstanceOf(
      EmumetInvalidResponseError,
    );
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

  test("Webhook: 作成は部分マスクで返り secret は返らない、URL 検査・鍵なし・重複・上限・revision 競合・環境変数は読み取り専用", async () => {
    const { client, control } = createMockRegistrationGate({ webhook: "none", now: () => "2026-11-10T04:00:00Z" });
    const reason = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => (error instanceof EmumetWebhookEndpointRejectedError ? error.reason : error instanceof EmumetApiError ? error.status : String(error)));
    const secret = "0123456789abcdef";
    const created = await client.createRegistrationWebhookEndpoint({ url: "https://hooks.example.net/services/T0000/abcdefghijkla8f2", secret, categories: ["OUTAGE"] });
    expect(created).toMatchObject({ maskedUrl: "hooks.example.net/••••/a8f2", status: "HEALTHY", revision: 1, editable: true, secretConfigured: true });
    expect(JSON.stringify(await client.listRegistrationWebhookEndpoints())).not.toContain(secret);
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "https://hooks.example.net/services/T0000/abcdefghijkla8f2", secret, categories: ["OUTAGE"] }))).toBe("duplicate_url");
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "http://hooks.example.net/x", secret, categories: ["OUTAGE"] }))).toBe("unsupported_scheme");
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "not a url", secret, categories: ["OUTAGE"] }))).toBe("invalid_url");
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret: "short", categories: ["OUTAGE"] }))).toBe("secret_too_short");
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret, categories: [] }))).toBe("no_categories");
    expect(await reason(client.updateRegistrationWebhookEndpoint(created.id, { revision: 9, categories: ["RECOVERY"] }))).toBe(409);
    expect(await reason(client.updateRegistrationWebhookEndpoint(created.id, { revision: 1 }))).toBe("nothing_to_update");
    const updated = await client.updateRegistrationWebhookEndpoint(created.id, { revision: 1, categories: ["RECOVERY", "OVERRIDE"] });
    expect(updated).toMatchObject({ revision: 2, categories: ["RECOVERY", "OVERRIDE"], maskedUrl: "hooks.example.net/••••/a8f2" });
    expect(await reason(client.deleteRegistrationWebhookEndpoint(created.id, 1))).toBe(409);
    await client.deleteRegistrationWebhookEndpoint(created.id, 2);
    expect((await client.listRegistrationWebhookEndpoints()).endpoints).toEqual([]);
    control.setWebhook("no_key");
    expect(await reason(client.createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret, categories: ["OUTAGE"] }))).toBe("encryption_key_not_configured");
    control.setWebhook("environment_misconfigured");
    expect(await reason(client.updateRegistrationWebhookEndpoint("environment", { revision: 1, categories: ["OUTAGE"] }))).toBe("environment_endpoint_read_only");
    await expect(client.sendRegistrationWebhookTest("environment")).rejects.toBeInstanceOf(EmumetWebhookUnavailableError);
    control.setWebhook("secret_undecryptable");
    const fixed = await client.updateRegistrationWebhookEndpoint("1", { revision: 1, secret });
    expect(fixed.status).toBe("HEALTHY");
  });

  test("Webhook: 配送失敗は 1 件ずつ再試行でき、解消すると正常に戻る。古い失敗にも cursor で到達できる。対象なしは NotFound", async () => {
    const { client, control } = createMockRegistrationGate({ webhook: "failed" });
    expect((await client.sendRegistrationWebhookTest("1")).delivered).toBe(false);
    expect(await client.retryRegistrationWebhook({ endpointId: "1", eventId: "13" })).toBe(1);
    let list = await client.listRegistrationWebhookEndpoints();
    expect([list.hasFailedDeliveries, list.endpoints[0]?.status, list.endpoints[0]?.failedCount]).toEqual([true, "FAILING", 1]);
    await expect(client.retryRegistrationWebhook({ endpointId: "1", eventId: "13" })).rejects.toBeInstanceOf(EmumetRegistrationTargetNotFoundError);
    expect(await client.retryRegistrationWebhook({ endpointId: "1", eventId: "12" })).toBe(1);
    list = await client.listRegistrationWebhookEndpoints();
    expect([list.hasFailedDeliveries, list.endpoints[0]?.status]).toEqual([false, "HEALTHY"]);
    expect((await client.listRegistrationWebhookFailures()).items).toEqual([]);
    control.setWebhook("many_failures");
    const first = await client.listRegistrationWebhookFailures();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.listRegistrationWebhookFailures({ before: first.nextCursor! });
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
    const oldest = second.items.at(-1)!;
    expect(await client.retryRegistrationWebhook({ endpointId: oldest.endpointId, eventId: oldest.eventId })).toBe(1);
    await expect(client.listRegistrationWebhookFailures({ before: "broken" })).rejects.toMatchObject({ status: 400 });
  });

  test("Webhook: 先頭ページの失敗をすべて再試行しても、その cursor で残りの古い失敗を読める (cursor は境界の値で比べる)", async () => {
    const { client } = createMockRegistrationGate({ webhook: "many_failures" });
    const first = await client.listRegistrationWebhookFailures();
    expect(first.items).toHaveLength(50);
    for (const item of first.items) {
      expect(await client.retryRegistrationWebhook({ endpointId: item.endpointId, eventId: item.eventId })).toBe(1);
    }
    const rest = await client.listRegistrationWebhookFailures({ before: first.nextCursor! });
    expect(rest.items).toHaveLength(10);
    expect(rest.nextCursor).toBeNull();
    expect(rest.items.every((item) => !first.items.some((done) => done.eventId === item.eventId))).toBe(true);
    // 先頭から読み直すと、残っているのはその 10 件だけ
    expect((await client.listRegistrationWebhookFailures()).items.map((item) => item.eventId)).toEqual(rest.items.map((item) => item.eventId));
  });

  test("非管理者: 呼び出し者は取得できるが管理 API はすべて 403", async () => {
    const { client } = createMockRegistrationGate({ role: "non-admin" });
    expect(await client.getViewer()).toMatchObject({ instanceRoles: [] });
    for (const call of [
      () => client.listRegistrationProtections(),
      () => client.verifyRegistrationProtection("EMAIL"),
      () => client.listRegistrationWebhookEndpoints(),
      () => client.listRegistrationWebhookFailures(),
      () => client.createRegistrationWebhookEndpoint({ url: "https://a.example/x", secret: "0123456789abcdef", categories: ["OUTAGE"] }),
      () => client.sendRegistrationWebhookTest("1"),
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
      "webhook-no-key": "OPEN",
      "webhook-multiple": "OPEN",
      "webhook-secret-undecryptable": "OPEN",
      "webhook-environment": "OPEN",
      "webhook-many-failures": "OPEN",
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
      "{ registrationWebhookEndpoints { hasFailedDeliveries } }",
      "{ registrationWebhookFailures { nextCursor } }",
      "mutation { verifyRegistrationProtection(protection: EMAIL) { outcome } }",
      'mutation { createRegistrationWebhookEndpoint(input: { url: "https://a.example/x", secret: "0123456789abcdef", categories: [OUTAGE] }) { id } }',
      'mutation { sendRegistrationWebhookTest(endpointId: "1") { delivered } }',
      "mutation { retryRegistrationWebhook }",
    ]) {
      const result = await run(source, mock);
      expect(code(result), source).toBe("FORBIDDEN");
      expect(result.data, source).toBeNull();
    }
  });

  test("Webhook: 環境変数の送信先のテスト送信は WEBHOOK_NOT_CONFIGURED、再試行の対象なしは NOT_FOUND、eventId だけは BAD_REQUEST、一時障害は retryable", async () => {
    const mock = createMockEmumetClient({ registrationGate: { webhook: "environment_misconfigured" } });
    expect(code(await run('mutation { sendRegistrationWebhookTest(endpointId: "environment") { delivered } }', mock))).toBe("WEBHOOK_NOT_CONFIGURED");
    expect(code(await run('mutation { retryRegistrationWebhook(endpointId: "environment", eventId: "404") }', mock))).toBe("NOT_FOUND");
    expect(code(await run('mutation { retryRegistrationWebhook(eventId: "13") }', mock))).toBe("BAD_REQUEST");
    mock.registrationGateControl.failNext(new EmumetUnavailableError("down"));
    const temporary = await run("{ registrationWebhookEndpoints { hasFailedDeliveries } }", mock);
    expect(code(temporary)).toBe("TEMPORARILY_UNAVAILABLE");
    expect(temporary.errors?.[0]?.extensions?.["retryable"]).toBe(true);
    mock.registrationGateControl.failNext(new EmumetApiError(401, ""));
    expect(code(await run("{ viewer { isAdmin } }", mock))).toBe("UNAUTHENTICATED");
  });

  test("Webhook: 拒否は WEBHOOK_ENDPOINT_REJECTED + reason、revision 競合は REVISION_CONFLICT (混同しない)", async () => {
    const mock = createMockEmumetClient({ registrationGate: { webhook: "no_key" } });
    const rejected = await run(
      'mutation { createRegistrationWebhookEndpoint(input: { url: "https://a.example/x", secret: "0123456789abcdef", categories: [OUTAGE] }) { id } }',
      mock,
    );
    expect(code(rejected)).toBe("WEBHOOK_ENDPOINT_REJECTED");
    expect(rejected.errors?.[0]?.extensions?.["reason"]).toBe("encryption_key_not_configured");
    expect(JSON.stringify(rejected.errors)).not.toContain("0123456789abcdef");
    mock.registrationGateControl.setWebhook("healthy");
    const conflict = await run('mutation { updateRegistrationWebhookEndpoint(endpointId: "1", input: { revision: 7, categories: [OUTAGE] }) { revision } }', mock);
    expect(code(conflict)).toBe("REVISION_CONFLICT");
    const updated = await run('mutation { updateRegistrationWebhookEndpoint(endpointId: "1", input: { revision: 1, categories: [OUTAGE, OVERRIDE] }) { revision categories } }', mock);
    expect(updated.data).toEqual({ updateRegistrationWebhookEndpoint: { revision: 2, categories: ["OUTAGE", "OVERRIDE"] } });
    expect((await run('mutation { deleteRegistrationWebhookEndpoint(endpointId: "1", revision: 2) }', mock)).data).toEqual({ deleteRegistrationWebhookEndpoint: true });
  });

  test("Webhook の応答に secret・URL 全体は現れない (登録した URL も部分マスクでだけ返る)", async () => {
    const mock = createMockEmumetClient({ registrationGate: { webhook: "failed" } });
    const created = await run(
      'mutation { createRegistrationWebhookEndpoint(input: { url: "https://hooks.example.org/services/abcdefghijk0042", secret: "0123456789abcdef", categories: [OUTAGE] }) { maskedUrl secretConfigured } }',
      mock,
    );
    expect(created.data).toEqual({ createRegistrationWebhookEndpoint: { maskedUrl: "hooks.example.org/••••/0042", secretConfigured: true } });
    const result = await run(
      "{ registrationWebhookEndpoints { hasFailedDeliveries endpoints { id maskedUrl status failingReasons configIssue secretConfigured editable revision categories } } registrationWebhookFailures { items { endpointId eventId eventType category failedAt result } nextCursor } }",
      mock,
    );
    expect(result.errors).toBeUndefined();
    expect(JSON.stringify(result.data)).not.toMatch(/https?:|\/\/|0123456789abcdef|services/i);
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
