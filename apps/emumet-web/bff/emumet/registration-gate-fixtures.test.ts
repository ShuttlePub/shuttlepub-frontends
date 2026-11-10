import { describe, expect, test } from "bun:test";
import { describeViolations, violationsForResponse, violationsForSchema } from "../openapi/contract.ts";
import {
  NOTIFICATION_LIST_FIXTURES,
  REGISTRATION_GATE_FIXTURE_NAMES,
  REGISTRATION_GATE_FIXTURES,
  UNREAD_COUNT_FIXTURES,
} from "./registration-gate-fixtures.ts";
import { registrationGateFromFixture, viewOfRegistrationGate } from "./registration-gate-mock.ts";
import { toNotificationPage } from "./registration-gate-real.ts";

const BASE = "/api/v1/admin/registration-gate";

describe("registration gate fixtures vs the pinned Emumet OpenAPI schema", () => {
  // 状態を返す全操作は同じ RegistrationGateResponse を返す
  const stateOperations = [
    { path: BASE, method: "get" },
    { path: `${BASE}/open`, method: "post" },
    { path: `${BASE}/close`, method: "post" },
    { path: `${BASE}/override`, method: "post" },
    { path: `${BASE}/override/revoke`, method: "post" },
  ] as const;

  for (const name of REGISTRATION_GATE_FIXTURE_NAMES) {
    test(`${name} satisfies every state-returning operation`, () => {
      for (const operation of stateOperations) {
        const violations = violationsForResponse({ ...operation, status: "200" }, REGISTRATION_GATE_FIXTURES[name]);
        expect(describeViolations(violations), `${operation.method} ${operation.path}`).toBe("");
      }
    });
  }

  for (const [name, body] of Object.entries(NOTIFICATION_LIST_FIXTURES)) {
    test(`notification list ${name} satisfies GET notifications 200`, () => {
      expect(describeViolations(violationsForResponse({ path: `${BASE}/notifications`, method: "get", status: "200" }, body))).toBe("");
      // unread_count はページ内の未読数以上 (多数のときはページ範囲外にも未読がありうる)
      expect(body.unread_count).toBeGreaterThanOrEqual(body.notifications.filter((item) => !item.read).length);
    });
  }

  for (const [name, body] of Object.entries(UNREAD_COUNT_FIXTURES)) {
    test(`unread count ${name} satisfies every unread-count response`, () => {
      for (const operation of [
        { path: `${BASE}/notifications/unread-count`, method: "get" },
        { path: `${BASE}/notifications/read`, method: "post" },
        { path: `${BASE}/notifications/read-all`, method: "post" },
      ] as const) {
        expect(describeViolations(violationsForResponse({ ...operation, status: "200" }, body))).toBe("");
      }
    });
  }

  test("a fixture that violates the schema fails the check", () => {
    const broken = [
      { ...REGISTRATION_GATE_FIXTURES.accepting_protected, override: { active: "no" } },
      { ...REGISTRATION_GATE_FIXTURES.accepting_protected, observation: { email: { configured: true } } },
      { ...REGISTRATION_GATE_FIXTURES.accepting_protected, enforced_protections: "email" },
    ];
    for (const body of broken) {
      expect(violationsForSchema("RegistrationGateResponse", body)).not.toEqual([]);
    }
  });
});

describe("fixture coverage of the D15 state vocabulary", () => {
  const gates = REGISTRATION_GATE_FIXTURE_NAMES.map((name) => ({ name, gate: registrationGateFromFixture(name) }));
  const has = (predicate: (gate: ReturnType<typeof registrationGateFromFixture>) => boolean) => gates.some(({ gate }) => predicate(gate));

  test("covers every decision", () => {
    for (const decision of ["ACCEPTING", "ADMIN_CLOSED", "STOPPED", "TEMPORARY_REJECT"] as const) {
      expect(has((gate) => gate.decision === decision), decision).toBe(true);
    }
  });

  test("covers degraded / non-degraded accepting, and each protection degraded", () => {
    expect(has((gate) => gate.decision === "ACCEPTING" && gate.degradedProtections.length === 0 && !gate.override.active)).toBe(true);
    expect(has((gate) => gate.decision === "ACCEPTING" && gate.degradedProtections.includes("BOT") && !gate.override.active)).toBe(true);
    expect(has((gate) => gate.decision === "ACCEPTING" && gate.degradedProtections.includes("EMAIL") && !gate.override.active)).toBe(true);
  });

  test("covers stop latch with and without recovered protection (resume pending)", () => {
    expect(has((gate) => gate.decision === "STOPPED" && !gate.observation.email.configured && !gate.observation.bot.configured)).toBe(true);
    expect(has((gate) => gate.decision === "STOPPED" && gate.observation.email.probe === "HEALTHY" && gate.requiresManualResume)).toBe(true);
  });

  test("covers override with and without enforced protection, and override while closed", () => {
    expect(has((gate) => gate.override.active && gate.enforcedProtections.length === 0 && gate.decision === "ACCEPTING")).toBe(true);
    expect(has((gate) => gate.override.active && gate.enforcedProtections.length > 0)).toBe(true);
    expect(has((gate) => gate.override.active && gate.decision === "ADMIN_CLOSED")).toBe(true);
  });

  test("covers not-ready (closed, nothing configured)", () => {
    expect(has((gate) => gate.adminState === "CLOSED" && !gate.override.active && !gate.observation.email.configured && !gate.observation.bot.configured)).toBe(true);
  });

  test("notification fixtures cover unread, read, mixed, many with paging, and every event kind", () => {
    expect(NOTIFICATION_LIST_FIXTURES.all_unread.notifications.every((item) => !item.read)).toBe(true);
    expect(NOTIFICATION_LIST_FIXTURES.all_read.notifications.every((item) => item.read)).toBe(true);
    const mixed = NOTIFICATION_LIST_FIXTURES.mixed.notifications;
    expect(mixed.some((item) => item.read) && mixed.some((item) => !item.read)).toBe(true);
    expect(NOTIFICATION_LIST_FIXTURES.many_first_page.notifications.length).toBe(50);
    expect(NOTIFICATION_LIST_FIXTURES.many_first_page.next_cursor).not.toBeNull();
    expect(NOTIFICATION_LIST_FIXTURES.many_last_page.next_cursor).toBeNull();
    const kinds = new Set(NOTIFICATION_LIST_FIXTURES.all_unread.notifications.map((item) => item.kind));
    expect([...kinds].sort()).toEqual(
      ["outage_recovered", "outage_started", "override_revoked", "override_started", "protection_degraded", "protection_lost_stopped"],
    );
    const page = toNotificationPage(NOTIFICATION_LIST_FIXTURES.many_first_page);
    expect(page.nextCursor).toBe("951");
  });

  test("override notifications carry the actor, others do not", () => {
    for (const item of NOTIFICATION_LIST_FIXTURES.all_unread.notifications) {
      const overrideEvent = item.kind === "override_started" || item.kind === "override_revoked";
      expect(item.actor !== null, item.kind).toBe(overrideEvent);
    }
  });
});

// 保証範囲は判定表 (decision / accepting / requires_manual_resume / enforced / degraded) の整合のみ。
// 遷移条件・revision 増分・通知生成は registration-gate-mock.test.ts のシナリオで確認する (Rust 実装との同一性は未保証)。
describe("fixtures agree with the ported kernel judgement table (derived fields are not hand-copied wrongly)", () => {
  for (const name of REGISTRATION_GATE_FIXTURE_NAMES) {
    test(name, () => {
      const fromWire = registrationGateFromFixture(name);
      expect(viewOfRegistrationGate(fromWire)).toEqual(fromWire);
    });
  }
});
