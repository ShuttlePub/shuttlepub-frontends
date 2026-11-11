// ============================================================
// MockRegistrationGate — 登録ゲートの stateful mock
//
// kernel の純粋状態機械 (Emumet kernel/src/entity/registration_gate/machine.rs、E15a PR #67 = 0ac9e9c に
// E15d PR #92 = 95e3f77 の適用証明 (enforcement) ラッチを加えたもの) を
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
  ENFORCEMENT_NOTIFICATION_FIXTURES,
  NOTIFICATION_LIST_FIXTURES,
  REGISTRATION_GATE_FIXTURES,
  WEBHOOK_STATUS_FIXTURES,
  WEBHOOK_TEST_FIXTURES,
  type NotificationListFixtureName,
  type RegistrationGateFixtureName,
  type WebhookStatusFixtureName,
} from "./registration-gate-fixtures.ts";
import {
  toNotification,
  toProtectionReadiness,
  toRegistrationGate,
  toWebhookStatus,
  toWebhookTest,
  type WireProtectionReadiness,
} from "./registration-gate-real.ts";
import {
  EmumetRegistrationTargetNotFoundError,
  EmumetWebhookUnavailableError,
  type RegistrationAdminState,
  type RegistrationDecision,
  type RegistrationGate,
  type RegistrationGateClient,
  type RegistrationGateEventKind,
  type RegistrationGateNotification,
  type RegistrationGateNotificationPage,
  type RegistrationHealthEpisode,
  type RegistrationObservation,
  type RegistrationProtection,
  type RegistrationProtectionObservation,
  type RegistrationProtectionReadiness,
  type RegistrationProtectionVerification,
  type RegistrationWebhookDelivery,
  type RegistrationWebhookStatus,
} from "./registration-gate.ts";

export const MOCK_ADMIN_ID = "auth-account-mock-admin";
export const MOCK_MEMBER_ID = "auth-account-mock-member";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_MARK_READ_IDS = 100;

/** mock 呼び出し者の権限。admin 以外は全操作が 403 (認可の正本は Emumet API。mock も同じ結果を返す) */
export type MockRegistrationGateRole = "admin" | "non-admin";

export type MockRegistrationGateOptions = {
  /** 初期状態。省略時は準備未完了 (not_ready) */
  readonly fixture?: RegistrationGateFixtureName;
  /** 初期通知。省略時は通知なし */
  readonly notifications?: NotificationListFixtureName | "enforcement" | "many";
  /** 保護の readiness。省略時は初期状態の observation から導出する (Emumet の to_observation の逆) */
  readonly protections?: readonly WireProtectionReadiness[];
  /** Webhook 配送状態。省略時は未設定 */
  readonly webhook?: WebhookStatusFixtureName;
  readonly role?: MockRegistrationGateRole;
  /** 時刻の注入 (テストの決定性用) */
  readonly now?: () => string;
};

type GateState = {
  revision: number;
  adminState: RegistrationAdminState;
  override: { activatedBy: string; activatedAt: string } | null;
  configLostLatch: boolean;
  enforcementLostLatch: boolean;
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
  // E15d: 適用証明の喪失は override より優先して停止する
  if (!state.observation.enforcementVerified || state.enforcementLostLatch) return "STOPPED";
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
  return (
    state.adminState === "OPEN" &&
    state.override === null &&
    !state.configLostLatch &&
    state.observation.enforcementVerified &&
    !state.enforcementLostLatch
  );
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
    a.enforcementLostLatch === b.enforcementLostLatch &&
    a.observation.enforcementVerified === b.observation.enforcementVerified &&
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
    enforcementLostLatch: state.enforcementLostLatch,
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
    enforcementLostLatch: gate.enforcementLostLatch,
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
  /** 観測入力 (検証 API の観測結果)。制御状態が変わらない反復は revision・通知を増やさない。保護の readiness も観測から導出し直す */
  observe(observation: RegistrationObservation): void;
  /**
   * 保護の readiness を設定し、対応する観測 (Emumet の to_observation) を入力する。
   * 未設定と設定エラーはどちらも configured=false になるので、readiness だけが区別を持つ
   */
  setProtections(protections: readonly WireProtectionReadiness[]): void;
  setWebhook(fixture: WebhookStatusFixtureName): void;
  setRole(role: MockRegistrationGateRole): void;
  /** 次の 1 回の呼び出しを、この例外で失敗させる (一時障害・401 などの注入) */
  failNext(error: Error): void;
  /** 現在の状態の DTO (GraphQL を経由せず検証する用) */
  snapshot(): RegistrationGate;
  /** 状態・通知・保護・Webhook・権限をまとめて初期化する (開発・visual のシナリオ切替用) */
  reset(options: MockRegistrationGateOptions): void;
};

export type MockRegistrationGate = {
  readonly client: RegistrationGateClient;
  readonly control: MockRegistrationGateControl;
};

/** Emumet の to_observation の逆。未設定と設定エラーの区別は失われるので未設定にする */
function readinessFromObservation(
  protection: RegistrationProtection,
  observation: RegistrationProtectionObservation,
): RegistrationProtectionReadiness {
  if (!observation.configured) {
    return { protection, enabled: false, status: "CONFIGURATION_INVALID", reason: "not_configured", checkedAt: null, validUntil: null };
  }
  switch (observation.probe) {
    case "HEALTHY":
      return { protection, enabled: true, status: "OPERATIONAL", reason: "business_success", checkedAt: MOCK_CHECKED_AT, validUntil: MOCK_VALID_UNTIL };
    case "UNHEALTHY":
      return { protection, enabled: true, status: "TEMPORARILY_UNAVAILABLE", reason: "timeout", checkedAt: MOCK_CHECKED_AT, validUntil: null };
    case "UNKNOWN":
      return { protection, enabled: true, status: "UNVERIFIED", reason: "never_verified", checkedAt: null, validUntil: null };
  }
}

const MOCK_CHECKED_AT = "2026-11-10T03:41:00Z";
const MOCK_VALID_UNTIL = "2026-11-10T09:41:00Z";

/** Emumet の to_observation (契約 §4) */
function observationFromReadiness(readiness: RegistrationProtectionReadiness): RegistrationProtectionObservation {
  switch (readiness.status) {
    case "OPERATIONAL":
      return { configured: true, probe: "HEALTHY" };
    case "TEMPORARILY_UNAVAILABLE":
      return { configured: true, probe: "UNHEALTHY" };
    case "UNVERIFIED":
      return { configured: true, probe: "UNKNOWN" };
    case "CONFIGURATION_INVALID":
      return { configured: false, probe: "UNKNOWN" };
  }
}

function seedEvents(name: NotificationListFixtureName | "enforcement" | "many"): StoredEvent[] {
  // many: 1 ページ (50 件) に収まらない通知 (多数の 1 ページ目と最終ページを合わせた 62 件)
  const wires =
    name === "enforcement" ? ENFORCEMENT_NOTIFICATION_FIXTURES.notifications
    : name === "many" ? [...NOTIFICATION_LIST_FIXTURES.many_first_page.notifications, ...NOTIFICATION_LIST_FIXTURES.many_last_page.notifications]
    : NOTIFICATION_LIST_FIXTURES[name].notifications;
  return wires
    .map((wire) => {
      const notification = toNotification(wire);
      return {
        id: Number(notification.id),
        kind: notification.kind,
        revision: notification.revision,
        actor: notification.actor,
        observation: notification.observation,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      };
    })
    .sort((a, b) => b.id - a.id);
}

export function createMockRegistrationGate(options: MockRegistrationGateOptions = {}): MockRegistrationGate {
  const now = options.now ?? (() => new Date().toISOString());
  let role: MockRegistrationGateRole = "admin";
  const faults: Error[] = [];
  let state = stateFromGate(registrationGateFromFixture("not_ready"));
  let protections: Record<RegistrationProtection, RegistrationProtectionReadiness> = {
    EMAIL: readinessFromObservation("EMAIL", state.observation.email),
    BOT: readinessFromObservation("BOT", state.observation.bot),
  };
  let webhook: { status: RegistrationWebhookStatus; deliveries: RegistrationWebhookDelivery[] } = loadWebhook("not_configured");
  let events: StoredEvent[] = [];
  let nextEventId = 1001;

  function loadWebhook(name: WebhookStatusFixtureName) {
    const status = toWebhookStatus(WEBHOOK_STATUS_FIXTURES[name]);
    return { status, deliveries: [...status.recentDeliveries] };
  }

  function load(next: MockRegistrationGateOptions): void {
    role = next.role ?? "admin";
    faults.length = 0;
    state = stateFromGate(registrationGateFromFixture(next.fixture ?? "not_ready"));
    protections = {
      EMAIL: readinessFromObservation("EMAIL", state.observation.email),
      BOT: readinessFromObservation("BOT", state.observation.bot),
    };
    for (const wire of next.protections ?? []) {
      const readiness = toProtectionReadiness(wire);
      protections[readiness.protection] = readiness;
    }
    // fixture の観測と readiness が食い違う組合せは scenario の誤り (観測入力で状態が変わってしまう)
    for (const protection of PROTECTIONS) {
      const derived = observationFromReadiness(protections[protection]);
      const current = observationOf(state.observation, protection);
      if (derived.configured !== current.configured || (derived.configured && derived.probe !== current.probe)) {
        throw new Error(`mock registration gate: readiness for ${protection} contradicts fixture ${next.fixture ?? "not_ready"}`);
      }
    }
    webhook = loadWebhook(next.webhook ?? "not_configured");
    events = seedEvents(next.notifications ?? "empty");
    nextEventId = Math.max(1000, ...events.map((event) => event.id)) + 1;
  }

  load(options);

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
    if ((command === "open" || command === "enable_override") && !state.observation.enforcementVerified) throw status(422);
    const at = now();
    const next: GateState = { ...state };
    const kinds: RegistrationGateEventKind[] = [];
    switch (command) {
      case "open": {
        if (state.adminState === "OPEN" && !state.configLostLatch && !state.enforcementLostLatch) throw status(422);
        if (!meetsMinimum(state.observation)) throw status(422);
        next.adminState = "OPEN";
        next.configLostLatch = false;
        next.enforcementLostLatch = false;
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
        if (state.override !== null && state.adminState === "OPEN" && !state.enforcementLostLatch) throw status(422);
        next.adminState = "OPEN";
        next.configLostLatch = false;
        next.enforcementLostLatch = false;
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

  function applyProtections(): void {
    control.observe({
      enforcementVerified: state.observation.enforcementVerified,
      email: observationFromReadiness(protections.EMAIL),
      bot: observationFromReadiness(protections.BOT),
    });
  }

  function verify(protection: RegistrationProtection): RegistrationProtectionVerification {
    guard();
    const current = protections[protection];
    const checkedAt = now();
    // 入力なしの検証は operational にしない (bot は負の probe、email は canary への送信のみ)。状態は変えず時刻だけ進める
    const readiness: RegistrationProtectionReadiness = current.enabled ? { ...current, checkedAt } : current;
    protections[protection] = readiness;
    if (!current.enabled || current.status === "CONFIGURATION_INVALID") {
      return { outcome: "CONFIGURATION_INVALID", reason: current.reason, recorded: true, disposition: "COMPLETED", readiness };
    }
    if (current.status === "TEMPORARILY_UNAVAILABLE") {
      return { outcome: "TEMPORARILY_UNAVAILABLE", reason: current.reason, recorded: true, disposition: "COMPLETED", readiness };
    }
    return {
      outcome: "ACCEPTED",
      reason: "accepted",
      recorded: true,
      disposition: protection === "EMAIL" ? "PENDING_CONFIRMATION" : "COMPLETED",
      readiness,
    };
  }

  function webhookView(): RegistrationWebhookStatus {
    const count = (status: RegistrationWebhookDelivery["status"]) =>
      webhook.deliveries.filter((delivery) => delivery.status === status).length;
    return {
      ...webhook.status,
      counts: {
        pending: count("PENDING"),
        inFlight: count("IN_FLIGHT"),
        retrying: count("RETRYING"),
        delivered: count("DELIVERED"),
        failed: count("FAILED"),
      },
      lastFailureAt: webhook.deliveries.some((delivery) => delivery.status === "FAILED") ? webhook.status.lastFailureAt : null,
      recentDeliveries: webhook.deliveries,
    };
  }

  const client: RegistrationGateClient = {
    async getViewer() {
      // /api/v1/me は管理権限を要求しない (非管理者にも 200 でロール無しを返す)
      const fault = faults.shift();
      if (fault) throw fault;
      return role === "admin"
        ? { accountId: MOCK_ADMIN_ID, instanceRoles: ["ADMIN"] }
        : { accountId: MOCK_MEMBER_ID, instanceRoles: [] };
    },
    async listRegistrationProtections() {
      guard();
      return [protections.EMAIL, protections.BOT];
    },
    async verifyRegistrationProtection(protection) {
      return verify(protection);
    },
    async getRegistrationWebhookStatus() {
      guard();
      return webhookView();
    },
    async sendRegistrationWebhookTest() {
      guard();
      if (webhook.status.configuration !== "CONFIGURED") throw new EmumetWebhookUnavailableError();
      const failing = webhook.deliveries.some((delivery) => delivery.status === "FAILED" || delivery.status === "RETRYING");
      return { ...toWebhookTest(failing ? WEBHOOK_TEST_FIXTURES.failure : WEBHOOK_TEST_FIXTURES.success), attemptedAt: now() };
    },
    async retryRegistrationWebhook(eventId) {
      guard();
      const targets = webhook.deliveries.filter(
        (delivery) => delivery.status === "FAILED" && (eventId === undefined || delivery.eventId === eventId),
      );
      if (eventId !== undefined && targets.length === 0) {
        throw new EmumetRegistrationTargetNotFoundError("no failed webhook delivery with that event ID");
      }
      webhook.deliveries = webhook.deliveries.map((delivery) =>
        targets.includes(delivery) ? { ...delivery, status: "PENDING", failureReason: null } : delivery,
      );
      return targets.length;
    },
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
      for (const protection of PROTECTIONS) {
        const observed = observationOf(observation, protection);
        const derived = observationFromReadiness(protections[protection]);
        if (derived.configured !== observed.configured || (observed.configured && derived.probe !== observed.probe)) {
          protections[protection] = readinessFromObservation(protection, observed);
        }
      }
      const next: GateState = { ...state, observation };
      const kinds: RegistrationGateEventKind[] = [];
      if (!observation.enforcementVerified && (state.observation.enforcementVerified || !state.enforcementLostLatch)) {
        next.enforcementLostLatch = true;
        kinds.push("ENFORCEMENT_LOST_STOPPED");
      } else if (observation.enforcementVerified && !state.observation.enforcementVerified) {
        kinds.push("ENFORCEMENT_RESTORED");
      }
      if (!latchOnConfigLost(next, kinds)) {
        const reconciled = reconcileEpisode(state.episode, isJudged(next), observation);
        next.episode = reconciled.episode;
        kinds.push(...reconciled.events);
      }
      if (sameControl(state, next) && kinds.length === 0) {
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
    setProtections(list) {
      for (const wire of list) {
        const readiness = toProtectionReadiness(wire);
        protections[readiness.protection] = readiness;
      }
      applyProtections();
    },
    setWebhook(name) {
      webhook = loadWebhook(name);
    },
    reset(next) {
      load(next);
    },
    failNext(error) {
      faults.push(error);
    },
    snapshot: () => view(state),
  };

  return { client, control };
}
