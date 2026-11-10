// ============================================================
// MockRegistrationGate の状態遷移 — kernel 状態表 (E15a) と同じ規則で
// 開閉・手動再開・override・観測入力・通知・管理者権限・revision 楽観ロックが動くこと
// ============================================================

import { describe, expect, test } from "bun:test";
import { EmumetApiError } from "./client.ts";
import { createMockEmumetClient } from "./mock.ts";
import { createMockRegistrationGate, MOCK_ADMIN_ID } from "./registration-gate-mock.ts";
import type { RegistrationGateFixtureName } from "./registration-gate-fixtures.ts";
import { EmumetUnavailableError, type RegistrationObservation } from "./registration-gate.ts";

const HEALTHY = { configured: true, probe: "HEALTHY" } as const;
const UNHEALTHY = { configured: true, probe: "UNHEALTHY" } as const;
const NONE = { configured: false, probe: "UNKNOWN" } as const;

const both = (email: RegistrationObservation["email"], bot: RegistrationObservation["bot"]): RegistrationObservation => ({ email, bot });

function fixed() {
  let tick = 0;
  return () => `2026-12-01T00:00:${String(tick++).padStart(2, "0")}Z`;
}

function make(fixture: RegistrationGateFixtureName, notifications?: "empty" | "mixed") {
  return createMockRegistrationGate({ fixture, now: fixed(), ...(notifications === undefined ? {} : { notifications }) });
}

async function status(call: Promise<unknown>): Promise<number | string> {
  try {
    await call;
    return "ok";
  } catch (error) {
    return error instanceof EmumetApiError ? error.status : (error as Error).name;
  }
}

describe("管理者操作 (open / close) と revision 楽観ロック", () => {
  test("not_ready: 通常の開放は最低条件未達で 422、revision は変わらない", async () => {
    const { client } = make("not_ready");
    expect(await status(client.openRegistrationGate(0))).toBe(422);
    expect((await client.getRegistrationGate()).revision).toBe(0);
  });

  test("古い revision は 409 (状態は変わらない)。422 や 400 とは別の結果", async () => {
    const { client } = make("accepting_protected");
    expect(await status(client.closeRegistrationGate(6))).toBe(409);
    expect((await client.getRegistrationGate()).adminState).toBe("OPEN");
    // revision の確認が前提条件の確認より先 (kernel と同じ順序)
    expect(await status(client.openRegistrationGate(6))).toBe(409);
  });

  test("close → 閉鎖 (revision +1)、再 close は 422、閉鎖は自動では解除されない", async () => {
    const { client, control } = make("accepting_protected");
    const closed = await client.closeRegistrationGate(7);
    expect(closed).toMatchObject({ revision: 8, adminState: "CLOSED", decision: "ADMIN_CLOSED", accepting: false, requiresManualResume: false });
    expect(await status(client.closeRegistrationGate(8))).toBe(422);
    control.observe(both(UNHEALTHY, UNHEALTHY));
    control.observe(both(HEALTHY, HEALTHY));
    expect((await client.getRegistrationGate()).decision).toBe("ADMIN_CLOSED");
  });

  test("open: 最低条件を満たせば再開できる。既に開放中は 422", async () => {
    const { client } = make("admin_closed");
    const opened = await client.openRegistrationGate(11);
    expect(opened).toMatchObject({ revision: 12, adminState: "OPEN", decision: "ACCEPTING", enforcedProtections: ["EMAIL", "BOT"] });
    expect(await status(client.openRegistrationGate(12))).toBe(422);
  });
});

describe("設定喪失の停止ラッチと手動再開 (STOPPED)", () => {
  test("開放中に設定が両方失われるとラッチが成立し、通知が 1 件増える。反復観測では増えない", async () => {
    const { client, control } = make("accepting_protected");
    control.observe(both(NONE, NONE));
    const stopped = await client.getRegistrationGate();
    expect(stopped).toMatchObject({ revision: 8, decision: "STOPPED", requiresManualResume: true, configLostLatch: true, adminState: "OPEN" });
    control.observe(both(NONE, NONE));
    control.observe(both(NONE, NONE));
    expect((await client.getRegistrationGate()).revision).toBe(8);
    const page = await client.listRegistrationGateNotifications();
    expect(page.notifications.map((item) => item.kind)).toEqual(["PROTECTION_LOST_STOPPED"]);
    expect(page.unreadCount).toBe(1);
  });

  test("復旧しても自動再開しない (再開待ち)。手動の open で解除され、最低条件未達なら 422", async () => {
    const { client, control } = make("stopped_config_lost");
    control.observe(both(HEALTHY, NONE));
    const waiting = await client.getRegistrationGate();
    expect(waiting).toMatchObject({ decision: "STOPPED", requiresManualResume: true, configLostLatch: true });
    control.observe(both(NONE, NONE));
    expect(await status(client.openRegistrationGate((await client.getRegistrationGate()).revision))).toBe(422);
    control.observe(both(HEALTHY, NONE));
    const resumed = await client.openRegistrationGate((await client.getRegistrationGate()).revision);
    expect(resumed).toMatchObject({ decision: "ACCEPTING", configLostLatch: false, requiresManualResume: false });
  });
});

describe("一時障害 (TEMPORARY_REJECT) と防御低下 (DEGRADED)", () => {
  test("両対策が障害なら一時拒否 + OUTAGE_STARTED、復旧で手動操作なしに自動再開 + OUTAGE_RECOVERED", async () => {
    const { client, control } = make("accepting_protected");
    control.observe(both(UNHEALTHY, UNHEALTHY));
    expect(await client.getRegistrationGate()).toMatchObject({ decision: "TEMPORARY_REJECT", healthEpisode: "OUTAGE", requiresManualResume: false, accepting: false });
    control.observe(both(HEALTHY, UNHEALTHY));
    expect(await client.getRegistrationGate()).toMatchObject({ decision: "ACCEPTING", healthEpisode: "DEGRADED", degradedProtections: ["BOT"], enforcedProtections: ["EMAIL"] });
    const kinds = (await client.listRegistrationGateNotifications()).notifications.map((item) => item.kind);
    expect(kinds).toEqual(["PROTECTION_DEGRADED", "OUTAGE_RECOVERED", "OUTAGE_STARTED"]);
  });

  test("片方のみの障害は防御低下として継続し、通知は episode の変化でのみ増える", async () => {
    const { client, control } = make("accepting_protected");
    control.observe(both(HEALTHY, UNHEALTHY));
    control.observe(both(HEALTHY, UNHEALTHY));
    control.observe(both(UNHEALTHY, HEALTHY));
    const page = await client.listRegistrationGateNotifications();
    expect(page.notifications.map((item) => item.kind)).toEqual(["PROTECTION_DEGRADED"]);
    expect(await client.getRegistrationGate()).toMatchObject({ decision: "ACCEPTING", degradedProtections: ["EMAIL"], enforcedProtections: ["BOT"] });
  });
});

describe("override", () => {
  test("警告 ack が無ければ 400。revision 競合は ack の検証より先に 409", async () => {
    const { client } = make("not_ready");
    expect(await status(client.enableRegistrationGateOverride(0, false))).toBe(400);
    expect(await status(client.enableRegistrationGateOverride(99, true))).toBe(409);
  });

  test("準備未完了でも ack 付きで開放でき、override 状態が判別でき、OVERRIDE_STARTED に実行者が残る", async () => {
    const { client } = make("not_ready");
    const gate = await client.enableRegistrationGateOverride(0, true);
    expect(gate).toMatchObject({ adminState: "OPEN", decision: "ACCEPTING", accepting: true, enforcedProtections: [], override: { active: true, activatedBy: MOCK_ADMIN_ID } });
    const [notification] = (await client.listRegistrationGateNotifications()).notifications;
    expect(notification).toMatchObject({ kind: "OVERRIDE_STARTED", actor: MOCK_ADMIN_ID, read: false });
    expect(await status(client.enableRegistrationGateOverride(1, true))).toBe(422);
  });

  test("override 中は自動停止も一時拒否も行わず、準備済みの保護は課され続ける", async () => {
    const { client, control } = make("override_protected");
    control.observe(both(NONE, NONE));
    expect(await client.getRegistrationGate()).toMatchObject({ decision: "ACCEPTING", configLostLatch: false, healthEpisode: "NONE", override: { active: true } });
    control.observe(both(HEALTHY, NONE));
    expect(await client.getRegistrationGate()).toMatchObject({ enforcedProtections: ["EMAIL"] });
    control.observe(both(UNHEALTHY, UNHEALTHY));
    expect(await client.getRegistrationGate()).toMatchObject({ decision: "ACCEPTING", override: { active: true } });
    expect((await client.listRegistrationGateNotifications()).notifications).toEqual([]);
  });

  test("解除で通常判定に戻る: 設定 0 件なら停止ラッチ、設定ありで障害なら一時拒否、effective があれば受付", async () => {
    const unconfigured = make("override_unprotected");
    const stopped = await unconfigured.client.revokeRegistrationGateOverride(14);
    expect(stopped).toMatchObject({ decision: "STOPPED", configLostLatch: true, requiresManualResume: true, override: { active: false, activatedBy: null } });
    expect((await unconfigured.client.listRegistrationGateNotifications()).notifications.map((item) => item.kind)).toEqual(["PROTECTION_LOST_STOPPED", "OVERRIDE_REVOKED"]);

    const outage = make("override_unprotected");
    outage.control.observe(both(UNHEALTHY, NONE));
    expect(await outage.client.revokeRegistrationGateOverride(14)).toMatchObject({ decision: "TEMPORARY_REJECT", healthEpisode: "OUTAGE" });

    const protectedGate = make("override_protected");
    expect(await protectedGate.client.revokeRegistrationGateOverride(15)).toMatchObject({ decision: "ACCEPTING", enforcedProtections: ["EMAIL"], override: { active: false } });
  });

  test("解除は管理者状態を閉鎖にしない。override が無ければ解除は 422", async () => {
    const { client } = make("override_protected");
    expect((await client.revokeRegistrationGateOverride(15)).adminState).toBe("OPEN");
    expect(await status(client.revokeRegistrationGateOverride(16))).toBe(422);
  });

  test("閉鎖しても override 値は保持され (常時警告の対象のまま)、判定は閉鎖", async () => {
    const { client } = make("override_protected");
    const closed = await client.closeRegistrationGate(15);
    expect(closed).toMatchObject({ decision: "ADMIN_CLOSED", override: { active: true } });
    // 閉鎖中の override 有効化は開放に戻す (kernel と同じ)。既に active なので OVERRIDE_STARTED は再生成されない
    const reopened = await client.enableRegistrationGateOverride(16, true);
    expect(reopened).toMatchObject({ adminState: "OPEN", decision: "ACCEPTING", override: { active: true } });
    expect((await client.listRegistrationGateNotifications()).notifications).toEqual([]);
  });
});

describe("通知: 一覧・未読・既読", () => {
  test("既読は呼び出した管理者のみ。未読件数が減り、既読化は冪等", async () => {
    const { client } = make("accepting_protected", "mixed");
    expect(await client.countUnreadRegistrationGateNotifications()).toBe(1);
    expect(await client.markRegistrationGateNotificationsRead(["303"])).toBe(0);
    expect(await client.markRegistrationGateNotificationsRead(["303"])).toBe(0);
    const page = await client.listRegistrationGateNotifications();
    expect(page.notifications.every((item) => item.read)).toBe(true);
    expect(page.unreadCount).toBe(0);
  });

  test("既読にした通知の既読時刻は最初の時刻のまま", async () => {
    const { client } = make("accepting_protected", "mixed");
    await client.markRegistrationGateNotificationsRead(["303"]);
    const first = (await client.listRegistrationGateNotifications()).notifications[0]?.readAt;
    await client.markAllRegistrationGateNotificationsRead();
    expect((await client.listRegistrationGateNotifications()).notifications[0]?.readAt).toBe(first ?? "");
  });

  test("全件既読。新しい通知は再び未読になる", async () => {
    const { client, control } = make("accepting_protected", "mixed");
    expect(await client.markAllRegistrationGateNotificationsRead()).toBe(0);
    control.observe(both(UNHEALTHY, UNHEALTHY));
    expect(await client.countUnreadRegistrationGateNotifications()).toBe(1);
  });

  test("ページング: limit と before、最後のページの nextCursor は null、不正値は 400", async () => {
    const { client, control } = make("accepting_protected");
    for (let index = 0; index < 5; index++) {
      control.observe(both(UNHEALTHY, UNHEALTHY));
      control.observe(both(HEALTHY, HEALTHY));
    }
    const first = await client.listRegistrationGateNotifications({ limit: 4 });
    expect(first.notifications).toHaveLength(4);
    expect(first.nextCursor).toBe(first.notifications[3]?.id ?? "");
    const second = await client.listRegistrationGateNotifications({ limit: 4, before: first.nextCursor ?? "" });
    expect(second.notifications).toHaveLength(4);
    expect(Number(second.notifications[0]?.id)).toBeLessThan(Number(first.notifications[3]?.id));
    const last = await client.listRegistrationGateNotifications({ limit: 4, before: second.nextCursor ?? "" });
    expect(last.notifications).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
    expect(first.unreadCount).toBe(10);
    expect(await status(client.listRegistrationGateNotifications({ before: "abc" }))).toBe(400);
  });

  test("limit は 1〜100 に丸められる (Emumet と同じ。400 にはならない)", async () => {
    const { client } = make("accepting_protected", "mixed");
    expect((await client.listRegistrationGateNotifications({ limit: 0 })).notifications).toHaveLength(1);
    expect((await client.listRegistrationGateNotifications({ limit: -5 })).notifications).toHaveLength(1);
    expect((await client.listRegistrationGateNotifications({ limit: 101 })).notifications).toHaveLength(3);
    const many = createMockRegistrationGate({ fixture: "accepting_protected", notifications: "many_first_page", now: fixed() });
    expect((await many.client.listRegistrationGateNotifications({ limit: 500 })).notifications).toHaveLength(50);
    expect((await many.client.listRegistrationGateNotifications({ limit: 100 })).notifications).toHaveLength(50);
  });

  test("既読化の入力検証 (空・101 件・整数でない ID は 400)", async () => {
    const { client } = make("accepting_protected", "mixed");
    expect(await status(client.markRegistrationGateNotificationsRead([]))).toBe(400);
    expect(await status(client.markRegistrationGateNotificationsRead(Array.from({ length: 101 }, (_, i) => String(i))))).toBe(400);
    expect(await status(client.markRegistrationGateNotificationsRead(["x1"]))).toBe(400);
  });
});

describe("管理者のみ・障害注入", () => {
  test("non-admin は全操作が 403 で状態も通知も変わらない", async () => {
    const mock = createMockRegistrationGate({ fixture: "accepting_protected", notifications: "mixed", role: "non-admin" });
    const { client } = mock;
    const calls = [
      client.getRegistrationGate(),
      client.openRegistrationGate(7),
      client.closeRegistrationGate(7),
      client.enableRegistrationGateOverride(7, true),
      client.revokeRegistrationGateOverride(7),
      client.listRegistrationGateNotifications(),
      client.countUnreadRegistrationGateNotifications(),
      client.markRegistrationGateNotificationsRead(["303"]),
      client.markAllRegistrationGateNotificationsRead(),
    ];
    expect(await Promise.all(calls.map(status))).toEqual(Array(calls.length).fill(403));
    mock.control.setRole("admin");
    expect((await client.getRegistrationGate()).revision).toBe(7);
    expect(await client.countUnreadRegistrationGateNotifications()).toBe(1);
  });

  test("failNext は次の 1 回だけを失敗させる (一時障害・401)", async () => {
    const { client, control } = make("accepting_protected");
    control.failNext(new EmumetUnavailableError("down"));
    expect(await status(client.getRegistrationGate())).toBe("EmumetUnavailableError");
    expect((await client.getRegistrationGate()).revision).toBe(7);
    control.failNext(new EmumetApiError(401, ""));
    expect(await status(client.closeRegistrationGate(7))).toBe(401);
    expect((await client.getRegistrationGate()).adminState).toBe("OPEN");
  });

  test("MockEmumetClient は登録ゲートを持ち、既存のアカウント系はそのまま使える", async () => {
    const mock = createMockEmumetClient({ registrationGate: { fixture: "admin_closed" } });
    expect((await mock.getRegistrationGate()).decision).toBe("ADMIN_CLOSED");
    expect((await mock.listAccounts()).items).toHaveLength(3);
    expect(createMockEmumetClient().registrationGateControl.snapshot().decision).toBe("ADMIN_CLOSED");
  });
});
