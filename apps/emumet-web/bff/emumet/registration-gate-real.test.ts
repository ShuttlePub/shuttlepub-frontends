// ============================================================
// RealRegistrationGateClient — REST 契約テスト
//  - HTTP method / path / query / body / Authorization と snake_case → camelCase 変換
//  - 401/403/409/422/400 (OpenAPI 記載の応答) と 408/5xx/接続失敗/タイムアウト (記載外の一時障害) を別の例外で返す
//  - 契約に反する 2xx は成功にしない
// ============================================================

import { afterEach, describe, expect, test } from "bun:test";
import { isDocumentedStatus } from "../openapi/contract.ts";
import { EmumetApiError } from "./client.ts";
import { createRealEmumetClient } from "./real.ts";
import {
  NOTIFICATION_LIST_FIXTURES,
  REGISTRATION_GATE_FIXTURES,
  REGISTRATION_GATE_FIXTURE_NAMES,
  UNREAD_COUNT_FIXTURES,
} from "./registration-gate-fixtures.ts";
import { notificationQueryString, toRegistrationGate } from "./registration-gate-real.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError, type RegistrationGateClient } from "./registration-gate.ts";
import { jsonResponse, stubFetch } from "../test-utils.ts";

const BASE = "http://emumet.test";
const TOKEN = "test-access-token";
const GATE = "/api/v1/admin/registration-gate";
const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch });
});

function makeClient(timeoutMs?: number): RegistrationGateClient {
  return createRealEmumetClient({ baseUrl: BASE, ...(timeoutMs === undefined ? {} : { registrationGateTimeoutMs: timeoutMs }) }, TOKEN);
}

describe("request shape", () => {
  test("GET state: path, method, bearer token, no body", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.accepting_protected));
    await makeClient().getRegistrationGate();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(`${BASE}${GATE}`);
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.body).toBeUndefined();
  });

  test("open / close / revoke send the revision only", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.accepting_protected));
    const client = makeClient();
    await client.openRegistrationGate(7);
    await client.closeRegistrationGate(8);
    await client.revokeRegistrationGateOverride(9);
    expect(calls.map((call) => [call.method, call.url.replace(BASE, ""), JSON.parse(call.body ?? "null")])).toEqual([
      ["POST", `${GATE}/open`, { revision: 7 }],
      ["POST", `${GATE}/close`, { revision: 8 }],
      ["POST", `${GATE}/override/revoke`, { revision: 9 }],
    ]);
    expect(calls.every((call) => call.headers["Content-Type"] === "application/json")).toBe(true);
  });

  test("override sends revision and the explicit warning acknowledgement (snake_case)", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.override_unprotected));
    await makeClient().enableRegistrationGateOverride(13, true);
    expect(calls[0]?.url).toBe(`${BASE}${GATE}/override`);
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ revision: 13, acknowledge_warning: true });
  });

  test("override forwards acknowledge=false as-is (the API is the authority and answers 400)", async () => {
    const { calls } = stubFetch(() => new Response("", { status: 400 }));
    await expect(makeClient().enableRegistrationGateOverride(1, false)).rejects.toBeInstanceOf(EmumetApiError);
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ revision: 1, acknowledge_warning: false });
  });

  test("notifications: limit/before go in the query string, omitted when absent", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, NOTIFICATION_LIST_FIXTURES.mixed));
    const client = makeClient();
    await client.listRegistrationGateNotifications();
    await client.listRegistrationGateNotifications({ limit: 20, before: "951" });
    expect(calls[0]?.url).toBe(`${BASE}${GATE}/notifications`);
    expect(calls[1]?.url).toBe(`${BASE}${GATE}/notifications?limit=20&before=951`);
    expect(notificationQueryString({ before: "a b&c" })).toBe("?before=a+b%26c");
  });

  test("unread count / mark read / mark all read", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, UNREAD_COUNT_FIXTURES.some));
    const client = makeClient();
    expect(await client.countUnreadRegistrationGateNotifications()).toBe(3);
    expect(await client.markRegistrationGateNotificationsRead(["303", "302"])).toBe(3);
    expect(await client.markAllRegistrationGateNotificationsRead()).toBe(3);
    expect(calls.map((call) => [call.method, call.url.replace(BASE, ""), call.body === undefined ? null : JSON.parse(call.body)])).toEqual([
      ["GET", `${GATE}/notifications/unread-count`, null],
      ["POST", `${GATE}/notifications/read`, { event_ids: ["303", "302"] }],
      ["POST", `${GATE}/notifications/read-all`, null],
    ]);
  });
});

describe("snake_case → camelCase conversion", () => {
  test("every fixture converts and keeps the state vocabulary distinct", () => {
    for (const name of REGISTRATION_GATE_FIXTURE_NAMES) {
      const gate = toRegistrationGate(REGISTRATION_GATE_FIXTURES[name]);
      expect(gate.revision).toBe(REGISTRATION_GATE_FIXTURES[name].revision);
      expect(gate.accepting).toBe(gate.decision === "ACCEPTING");
      expect(gate.requiresManualResume).toBe(gate.decision === "STOPPED");
    }
  });

  test("override state is always determinable, also while closed", () => {
    expect(toRegistrationGate(REGISTRATION_GATE_FIXTURES.accepting_protected).override).toEqual({ active: false, activatedBy: null, activatedAt: null });
    expect(toRegistrationGate(REGISTRATION_GATE_FIXTURES.override_admin_closed)).toMatchObject({
      decision: "ADMIN_CLOSED",
      override: { active: true, activatedBy: "auth-account-admin-1", activatedAt: "2026-11-10T02:00:00Z" },
    });
  });

  test("a full GET maps field by field", async () => {
    stubFetch(() => jsonResponse(200, REGISTRATION_GATE_FIXTURES.accepting_degraded_bot));
    expect(await makeClient().getRegistrationGate()).toEqual({
      revision: 9,
      adminState: "OPEN",
      decision: "ACCEPTING",
      accepting: true,
      requiresManualResume: false,
      configLostLatch: false,
      enforcementLostLatch: false,
      healthEpisode: "DEGRADED",
      enforcedProtections: ["EMAIL"],
      degradedProtections: ["BOT"],
      override: { active: false, activatedBy: null, activatedAt: null },
      observation: { enforcementVerified: true, email: { configured: true, probe: "HEALTHY" }, bot: { configured: true, probe: "UNHEALTHY" } },
      updatedAt: "2026-11-10T01:10:00Z",
    });
  });

  test("notifications map actor / read state and keep the paging cursor", async () => {
    stubFetch(() => jsonResponse(200, NOTIFICATION_LIST_FIXTURES.mixed));
    const page = await makeClient().listRegistrationGateNotifications();
    expect(page.unreadCount).toBe(1);
    expect(page.nextCursor).toBeNull();
    expect(page.notifications[0]).toMatchObject({ id: "303", kind: "OVERRIDE_STARTED", actor: "auth-account-admin-1", read: false, readAt: null });
    expect(page.notifications[1]).toMatchObject({ kind: "PROTECTION_DEGRADED", actor: null, read: true });
    expect(page.notifications[1]?.readAt).not.toBeNull();
  });
});

describe("errors are classified, never turned into success", () => {
  const operations: { name: string; path: string; method: "get" | "post"; run: (client: RegistrationGateClient) => Promise<unknown> }[] = [
    { name: "get", path: GATE, method: "get", run: (c) => c.getRegistrationGate() },
    { name: "open", path: `${GATE}/open`, method: "post", run: (c) => c.openRegistrationGate(1) },
    { name: "close", path: `${GATE}/close`, method: "post", run: (c) => c.closeRegistrationGate(1) },
    { name: "override", path: `${GATE}/override`, method: "post", run: (c) => c.enableRegistrationGateOverride(1, true) },
    { name: "revoke", path: `${GATE}/override/revoke`, method: "post", run: (c) => c.revokeRegistrationGateOverride(1) },
    { name: "list", path: `${GATE}/notifications`, method: "get", run: (c) => c.listRegistrationGateNotifications() },
    { name: "unread", path: `${GATE}/notifications/unread-count`, method: "get", run: (c) => c.countUnreadRegistrationGateNotifications() },
    { name: "mark", path: `${GATE}/notifications/read`, method: "post", run: (c) => c.markRegistrationGateNotificationsRead(["1"]) },
    { name: "mark-all", path: `${GATE}/notifications/read-all`, method: "post", run: (c) => c.markAllRegistrationGateNotificationsRead() },
  ];

  for (const operation of operations) {
    test(`${operation.name}: 401 and 403 are documented and surface with their status`, async () => {
      for (const status of [401, 403]) {
        expect(isDocumentedStatus(operation.path, operation.method, status)).toBe(true);
        stubFetch(() => new Response("", { status }));
        await expect(operation.run(makeClient())).rejects.toMatchObject({ name: "EmumetApiError", status });
      }
    });
  }

  test("409 revision conflict and 422 precondition are documented for the state-changing operations only", () => {
    for (const operation of operations.filter((item) => ["open", "close", "override", "revoke"].includes(item.name))) {
      expect(isDocumentedStatus(operation.path, operation.method, 409), operation.name).toBe(true);
      expect(isDocumentedStatus(operation.path, operation.method, 422), operation.name).toBe(true);
      expect(isDocumentedStatus(operation.path, operation.method, 400), operation.name).toBe(true);
    }
    for (const operation of operations.filter((item) => !["open", "close", "override", "revoke"].includes(item.name))) {
      expect(isDocumentedStatus(operation.path, operation.method, 409), operation.name).toBe(false);
    }
  });

  test("409 / 422 / 400 keep distinct statuses on a state-changing call", async () => {
    for (const status of [409, 422, 400]) {
      stubFetch(() => new Response("conflict detail that must not leak", { status }));
      await expect(makeClient().openRegistrationGate(1)).rejects.toMatchObject({ name: "EmumetApiError", status });
    }
  });

  test("408 and 5xx (outside the documented responses) are API errors carrying the status", async () => {
    for (const status of [408, 500, 502, 503, 504]) {
      stubFetch(() => new Response("", { status }));
      await expect(makeClient().getRegistrationGate()).rejects.toMatchObject({ name: "EmumetApiError", status });
    }
  });

  test("a connection failure is an unavailable error (temporary), not an API status", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const error = await makeClient().getRegistrationGate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmumetUnavailableError);
    expect(error).not.toBeInstanceOf(EmumetApiError);
  });

  test("a response that never arrives times out as an unavailable error and the request carries an abort signal", async () => {
    let signal: AbortSignal | null | undefined;
    Object.assign(globalThis, {
      fetch: (_input: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      },
    });
    const started = Date.now();
    const error = await makeClient(30).getRegistrationGate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmumetUnavailableError);
    expect(signal).toBeDefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("existing (non registration-gate) requests keep their previous behaviour: no abort signal", async () => {
    let init: RequestInit | undefined;
    Object.assign(globalThis, {
      fetch: (_input: unknown, requestInit?: RequestInit) => {
        init = requestInit;
        return Promise.resolve(jsonResponse(200, { items: [], first: null, last: null }));
      },
    });
    await createRealEmumetClient({ baseUrl: BASE }, TOKEN).listAccounts();
    expect(init?.signal).toBeUndefined();
  });
});

describe("contract-violating 2xx responses fail closed", () => {
  const good = REGISTRATION_GATE_FIXTURES.accepting_protected;
  const cases: [string, unknown][] = [
    ["unknown decision", { ...good, decision: "maybe" }],
    ["unknown admin_state", { ...good, admin_state: "ajar" }],
    ["unknown health_episode", { ...good, health_episode: "sleeping" }],
    ["unknown protection name", { ...good, enforced_protections: ["sms"] }],
    ["unknown probe value", { ...good, observation: { ...good.observation, bot: { configured: true, probe: "meh" } } }],
    ["missing revision", (({ revision: _r, ...rest }) => rest)(good)],
    ["revision as string", { ...good, revision: "7" }],
    ["accepting contradicts decision", { ...good, accepting: false }],
    ["requires_manual_resume contradicts decision", { ...good, requires_manual_resume: true }],
    ["inactive override carrying activation details", { ...good, override: { active: false, activated_by: "x", activated_at: "2026-11-10T02:00:00Z" } }],
    ["revision beyond the GraphQL Int range", { ...good, revision: 2 ** 31 }],
    ["malformed timestamp", { ...good, updated_at: "yesterday" }],
  ];
  for (const [name, body] of cases) {
    test(name, async () => {
      stubFetch(() => jsonResponse(200, body));
      await expect(makeClient().getRegistrationGate()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
    });
  }

  test("a non-JSON 200 body", async () => {
    stubFetch(() => new Response("<html>proxy</html>", { status: 200 }));
    await expect(makeClient().getRegistrationGate()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
  });

  test("a 2xx other than 200 (e.g. 204) is not a success", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(makeClient().openRegistrationGate(1)).rejects.toBeInstanceOf(EmumetInvalidResponseError);
  });

  test("a notification with an unknown kind", async () => {
    const body = {
      ...NOTIFICATION_LIST_FIXTURES.mixed,
      notifications: [{ ...NOTIFICATION_LIST_FIXTURES.mixed.notifications[0], kind: "webhook_failed" }],
    };
    stubFetch(() => jsonResponse(200, body));
    await expect(makeClient().listRegistrationGateNotifications()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
  });

  test("an unread count that is negative or not an integer", async () => {
    for (const unread_count of [-1, 1.5]) {
      stubFetch(() => jsonResponse(200, { unread_count }));
      await expect(makeClient().countUnreadRegistrationGateNotifications()).rejects.toBeInstanceOf(EmumetInvalidResponseError);
    }
  });
});
