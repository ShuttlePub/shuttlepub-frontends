// ============================================================
// MockRegistrationGate — 登録ゲートの stateful mock
//
// kernel の純粋状態機械 (Emumet kernel/src/entity/registration_gate/machine.rs、E15a PR #67 = 0ac9e9c) を
// 手で移植したもの。判定 (evaluate)・管理者操作 (apply_command)・観測入力 (apply_observation) と
// 通知イベントの生成条件を同じ表で実装し、API の応答状態 (409/422/400/403) も同じ規則で返す。
//
// 保証範囲: 手書き fixture (OpenAPI 照合済み) の導出フィールド (decision・accepting など) が移植した判定と
// 一致すること、および registration-gate-mock.test.ts が書き下した状態表のシナリオ。遷移条件・revision 増分・
// 通知生成が Rust 実装と常に同一であることまでは、この repo では独立に保証しない
// (Emumet 側の状態機械が変わったら、このファイルを機械の差分に合わせて手で更新する)。
//
// 公開 HTTP に観測の書込口は無いため、観測入力は control.observe (テスト・fixture 専用) からのみ行う。
// ============================================================

import { EmumetApiError } from "./client.ts";
import {
  NOTIFICATION_LIST_FIXTURES,
  REGISTRATION_GATE_FIXTURES,
  type NotificationListFixtureName,
  type RegistrationGateFixtureName,
} from "./registration-gate-fixtures.ts";
import { toNotification, toRegistrationGate } from "./registration-gate-real.ts";
import type {
  RegistrationAdminState,
  RegistrationDecision,
  RegistrationGate,
  RegistrationGateClient,
  RegistrationGateEventKind,
  RegistrationGateNotification,
  RegistrationGateNotificationPage,
  RegistrationHealthEpisode,
  RegistrationObservation,
  RegistrationProtection,
  RegistrationProtectionObservation,
} from "./registration-gate.ts";

export const MOCK_ADMIN_ID = "auth-account-mock-admin";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_MARK_READ_IDS = 100;

/** mock 呼び出し者の権限。admin 以外は全操作が 403 (認可の正本は Emumet API。mock も同じ結果を返す) */
export type MockRegistrationGateRole = "admin" | "non-admin";

export type MockRegistrationGateOptions = {
  /** 初期状態。省略時は準備未完了 (not_ready) */
  readonly fixture?: RegistrationGateFixtureName;
  /** 初期通知。省略時は通知なし */
  readonly notifications?: NotificationListFixtureName;
  readonly role?: MockRegistrationGateRole;
  /** 時刻の注入 (テストの決定性用) */
  readonly now?: () => string;
};

type GateState = {
  revision: number;
  adminState: RegistrationAdminState;
  override: { activatedBy: string; activatedAt: string } | null;
  configLostLatch: boolean;
  episode: RegistrationHealthEpisode;
  observation: RegistrationObservation;
  updatedAt: string;
};

type StoredEvent = {
  id: number;
  kind: RegistrationGateEventKind;
  revision: number;
  actor: string | null;
  observation: RegistrationObservation;
  createdAt: string;
  readAt: string | null;
};

const PROTECTIONS: readonly RegistrationProtection[] = ["EMAIL", "BOT"];

function observationOf(observation: RegistrationObservation, protection: RegistrationProtection): RegistrationProtectionObservation {
  return protection === "EMAIL" ? observation.email : observation.bot;
}

function isEffective(observation: RegistrationProtectionObservation): boolean {
  return observation.configured && observation.probe === "HEALTHY";
}

function effectiveProtections(observation: RegistrationObservation): RegistrationProtection[] {
  return PROTECTIONS.filter((protection) => isEffective(observationOf(observation, protection)));
}

function degradedProtections(observation: RegistrationObservation): RegistrationProtection[] {
  return PROTECTIONS.filter((protection) => {
    const item = observationOf(observation, protection);
    return item.configured && !isEffective(item);
  });
}

function meetsMinimum(observation: RegistrationObservation): boolean {
  return effectiveProtections(observation).length > 0;
}

function configuredCount(observation: RegistrationObservation): number {
  return PROTECTIONS.filter((protection) => observationOf(observation, protection).configured).length;
}

type Health = "NO_CONFIG" | "OUTAGE" | "DEGRADED" | "HEALTHY";

function classify(observation: RegistrationObservation): Health {
  if (configuredCount(observation) === 0) return "NO_CONFIG";
  if (!meetsMinimum(observation)) return "OUTAGE";
  return degradedProtections(observation).length === 0 ? "HEALTHY" : "DEGRADED";
}

export function evaluate(state: GateState): RegistrationDecision {
  if (state.adminState === "CLOSED") return "ADMIN_CLOSED";
  if (state.override !== null) return "ACCEPTING";
  if (state.configLostLatch) return "STOPPED";
  switch (classify(state.observation)) {
    case "NO_CONFIG":
      return "STOPPED";
    case "OUTAGE":
      return "TEMPORARY_REJECT";
    default:
      return "ACCEPTING";
  }
}

function isJudged(state: GateState): boolean {
  return state.adminState === "OPEN" && state.override === null && !state.configLostLatch;
}

function reconcileEpisode(
  previous: RegistrationHealthEpisode,
  judged: boolean,
  observation: RegistrationObservation,
): { episode: RegistrationHealthEpisode; events: RegistrationGateEventKind[] } {
  const health = classify(observation);
  const events: RegistrationGateEventKind[] = [];
  if (previous === "OUTAGE" && (health === "DEGRADED" || health === "HEALTHY")) events.push("OUTAGE_RECOVERED");
  if (judged && health === "OUTAGE") {
    if (previous !== "OUTAGE") events.push("OUTAGE_STARTED");
    return { episode: "OUTAGE", events };
  }
  if (judged && health === "DEGRADED") {
    if (previous !== "DEGRADED") events.push("PROTECTION_DEGRADED");
    return { episode: "DEGRADED", events };
  }
  if (!judged && health === "OUTAGE" && previous === "OUTAGE") return { episode: "OUTAGE", events };
  if (!judged && health === "DEGRADED" && previous === "DEGRADED") return { episode: "DEGRADED", events };
  return { episode: "NONE", events };
}

function latchOnConfigLost(state: GateState, events: RegistrationGateEventKind[]): boolean {
  if (isJudged(state) && classify(state.observation) === "NO_CONFIG") {
    state.configLostLatch = true;
    state.episode = "NONE";
    events.push("PROTECTION_LOST_STOPPED");
    return true;
  }
  return false;
}

function sameControl(a: GateState, b: GateState): boolean {
  return (
    a.adminState === b.adminState &&
    (a.override === null) === (b.override === null) &&
    a.configLostLatch === b.configLostLatch &&
    a.episode === b.episode
  );
}

function view(state: GateState): RegistrationGate {
  const decision = evaluate(state);
  const accepting = decision === "ACCEPTING";
  return {
    revision: state.revision,
    adminState: state.adminState,
    decision,
    accepting,
    requiresManualResume: decision === "STOPPED",
    configLostLatch: state.configLostLatch,
    healthEpisode: state.episode,
    enforcedProtections: accepting ? effectiveProtections(state.observation) : [],
    degradedProtections: accepting ? degradedProtections(state.observation) : [],
    override: {
      active: state.override !== null,
      activatedBy: state.override?.activatedBy ?? null,
      activatedAt: state.override?.activatedAt ?? null,
    },
    observation: state.observation,
    updatedAt: state.updatedAt,
  };
}

function stateFromGate(gate: RegistrationGate): GateState {
  return {
    revision: gate.revision,
    adminState: gate.adminState,
    override: gate.override.active
      ? { activatedBy: gate.override.activatedBy ?? MOCK_ADMIN_ID, activatedAt: gate.override.activatedAt ?? gate.updatedAt }
      : null,
    configLostLatch: gate.configLostLatch,
    episode: gate.healthEpisode,
    observation: gate.observation,
    updatedAt: gate.updatedAt,
  };
}

/** fixture (ワイヤ形式) から作る DTO。mock の初期状態と、kernel 移植との整合テストの両方で使う */
export function registrationGateFromFixture(name: RegistrationGateFixtureName): RegistrationGate {
  return toRegistrationGate(REGISTRATION_GATE_FIXTURES[name]);
}

/** kernel 移植の判定をそのまま公開する (fixture との整合テスト用) */
export function viewOfRegistrationGate(gate: RegistrationGate): RegistrationGate {
  return view(stateFromGate(gate));
}

function status(code: number): EmumetApiError {
  return new EmumetApiError(code, "");
}

export type MockRegistrationGateControl = {
  /** 観測入力 (検証 API の観測結果)。制御状態が変わらない反復は revision・通知を増やさない */
  observe(observation: RegistrationObservation): void;
  setRole(role: MockRegistrationGateRole): void;
  /** 次の 1 回の呼び出しを、この例外で失敗させる (一時障害・401 などの注入) */
  failNext(error: Error): void;
  /** 現在の状態の DTO (GraphQL を経由せず検証する用) */
  snapshot(): RegistrationGate;
};

export type MockRegistrationGate = {
  readonly client: RegistrationGateClient;
  readonly control: MockRegistrationGateControl;
};

export function createMockRegistrationGate(options: MockRegistrationGateOptions = {}): MockRegistrationGate {
  const now = options.now ?? (() => new Date().toISOString());
  let role: MockRegistrationGateRole = options.role ?? "admin";
  const faults: Error[] = [];
  let state = stateFromGate(registrationGateFromFixture(options.fixture ?? "not_ready"));

  const events: StoredEvent[] = [];
  const seeded = NOTIFICATION_LIST_FIXTURES[options.notifications ?? "empty"].notifications;
  for (const wire of seeded) {
    const notification = toNotification(wire);
    events.push({
      id: Number(notification.id),
      kind: notification.kind,
      revision: notification.revision,
      actor: notification.actor,
      observation: notification.observation,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    });
  }
  events.sort((a, b) => b.id - a.id);
  let nextEventId = Math.max(1000, ...events.map((event) => event.id)) + 1;

  function guard(): void {
    const fault = faults.shift();
    if (fault) throw fault;
    if (role !== "admin") throw status(403);
  }

  function record(kinds: readonly RegistrationGateEventKind[], actor: string | null, at: string): void {
    for (const kind of kinds) {
      const overrideEvent = kind === "OVERRIDE_STARTED" || kind === "OVERRIDE_REVOKED";
      events.unshift({
        id: nextEventId++,
        kind,
        revision: state.revision,
        actor: overrideEvent ? actor : null,
        observation: state.observation,
        createdAt: at,
        readAt: null,
      });
    }
  }

  function commit(next: GateState, kinds: readonly RegistrationGateEventKind[], actor: string | null): RegistrationGate {
    state = next;
    record(kinds, actor, next.updatedAt);
    return view(state);
  }

  function applyCommand(
    expectedRevision: number,
    command: "open" | "close" | "enable_override" | "revoke_override",
    acknowledged = false,
  ): RegistrationGate {
    guard();
    if (state.revision !== expectedRevision) throw status(409);
    const at = now();
    const next: GateState = { ...state };
    const kinds: RegistrationGateEventKind[] = [];
    switch (command) {
      case "open": {
        if (state.adminState === "OPEN" && !state.configLostLatch) throw status(422);
        if (!meetsMinimum(state.observation)) throw status(422);
        next.adminState = "OPEN";
        next.configLostLatch = false;
        const reconciled = reconcileEpisode(next.episode, isJudged(next), next.observation);
        next.episode = reconciled.episode;
        kinds.push(...reconciled.events);
        break;
      }
      case "close":
        if (state.adminState === "CLOSED") throw status(422);
        next.adminState = "CLOSED";
        break;
      case "enable_override":
        if (!acknowledged) throw status(400);
        if (state.override !== null && state.adminState === "OPEN") throw status(422);
        next.adminState = "OPEN";
        next.configLostLatch = false;
        if (state.override === null) {
          next.override = { activatedBy: MOCK_ADMIN_ID, activatedAt: at };
          next.episode = "NONE";
          kinds.push("OVERRIDE_STARTED");
        }
        break;
      case "revoke_override": {
        if (state.override === null) throw status(422);
        next.override = null;
        kinds.push("OVERRIDE_REVOKED");
        if (!latchOnConfigLost(next, kinds)) {
          const reconciled = reconcileEpisode(next.episode, isJudged(next), next.observation);
          next.episode = reconciled.episode;
          kinds.push(...reconciled.events);
        }
        break;
      }
    }
    next.revision = state.revision + 1;
    next.updatedAt = at;
    return commit(next, kinds, MOCK_ADMIN_ID);
  }

  function unreadCount(): number {
    return events.filter((event) => event.readAt === null).length;
  }

  function toNotificationDto(event: StoredEvent): RegistrationGateNotification {
    return {
      id: String(event.id),
      kind: event.kind,
      revision: event.revision,
      actor: event.actor,
      observation: event.observation,
      createdAt: event.createdAt,
      read: event.readAt !== null,
      readAt: event.readAt,
    };
  }

  const client: RegistrationGateClient = {
    async getRegistrationGate() {
      guard();
      return view(state);
    },
    async openRegistrationGate(revision) {
      return applyCommand(revision, "open");
    },
    async closeRegistrationGate(revision) {
      return applyCommand(revision, "close");
    },
    async enableRegistrationGateOverride(revision, acknowledgeWarning) {
      return applyCommand(revision, "enable_override", acknowledgeWarning);
    },
    async revokeRegistrationGateOverride(revision) {
      return applyCommand(revision, "revoke_override");
    },
    async listRegistrationGateNotifications(query): Promise<RegistrationGateNotificationPage> {
      guard();
      // Emumet は limit を 1〜100 に丸める (範囲外は 400 ではない)
      const requested = query?.limit ?? DEFAULT_PAGE_LIMIT;
      if (!Number.isInteger(requested)) throw status(400);
      const limit = Math.min(Math.max(requested, 1), MAX_PAGE_LIMIT);
      let before: number | null = null;
      if (query?.before !== undefined) {
        if (!/^-?\d+$/.test(query.before.trim())) throw status(400);
        before = Number(query.before.trim());
      }
      const candidates = events.filter((event) => before === null || event.id < before);
      const pageEvents = candidates.slice(0, limit);
      const last = pageEvents[pageEvents.length - 1];
      return {
        notifications: pageEvents.map(toNotificationDto),
        unreadCount: unreadCount(),
        nextCursor: candidates.length > limit && last ? String(last.id) : null,
      };
    },
    async countUnreadRegistrationGateNotifications() {
      guard();
      return unreadCount();
    },
    async markRegistrationGateNotificationsRead(eventIds) {
      guard();
      if (eventIds.length < 1 || eventIds.length > MAX_MARK_READ_IDS) throw status(400);
      const ids = eventIds.map((raw) => {
        if (!/^-?\d+$/.test(raw.trim())) throw status(400);
        return Number(raw.trim());
      });
      const at = now();
      for (const event of events) {
        if (ids.includes(event.id) && event.readAt === null) event.readAt = at;
      }
      return unreadCount();
    },
    async markAllRegistrationGateNotificationsRead() {
      guard();
      const at = now();
      for (const event of events) if (event.readAt === null) event.readAt = at;
      return 0;
    },
  };

  const control: MockRegistrationGateControl = {
    observe(observation) {
      const at = now();
      const next: GateState = { ...state, observation };
      const kinds: RegistrationGateEventKind[] = [];
      if (!latchOnConfigLost(next, kinds)) {
        const reconciled = reconcileEpisode(state.episode, isJudged(state), observation);
        next.episode = reconciled.episode;
        kinds.push(...reconciled.events);
      }
      if (sameControl(state, next)) {
        if (JSON.stringify(state.observation) !== JSON.stringify(observation)) next.updatedAt = at;
        state = next;
        return;
      }
      next.revision = state.revision + 1;
      next.updatedAt = at;
      commit(next, kinds, null);
    },
    setRole(value) {
      role = value;
    },
    failNext(error) {
      faults.push(error);
    },
    snapshot: () => view(state),
  };

  return { client, control };
}
