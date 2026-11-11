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
  WEBHOOK_FIXTURES,
  WEBHOOK_TEST_FIXTURES,
  type NotificationListFixtureName,
  type RegistrationGateFixtureName,
  type WebhookFixtureName,
} from "./registration-gate-fixtures.ts";
import {
  toNotification,
  toProtectionReadiness,
  toRegistrationGate,
  toWebhookEndpoints,
  toWebhookFailedDelivery,
  toWebhookTest,
  type WireProtectionReadiness,
} from "./registration-gate-real.ts";
import {
  EmumetRegistrationTargetNotFoundError,
  EmumetWebhookEndpointRejectedError,
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
  type RegistrationWebhookCategory,
  type RegistrationWebhookEndpoint,
  type RegistrationWebhookEndpoints,
  type RegistrationWebhookFailedDelivery,
  type WebhookEndpointRejection,
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
  /** Webhook 送信先と配送失敗。省略時は送信先なし */
  readonly webhook?: WebhookFixtureName;
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
  setWebhook(fixture: WebhookFixtureName): void;
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
  let webhook = loadWebhook("none");
  let events: StoredEvent[] = [];
  let nextEventId = 1001;

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
    webhook = loadWebhook(next.webhook ?? "none");
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

  // ---- Webhook 送信先 (E15x) ----

  type StoredEndpoint = {
    endpoint: RegistrationWebhookEndpoint;
    /** 重複判定用の正規化した URL。fixture 由来の送信先は分からない (null) */
    url: string | null;
  };

  function loadWebhook(name: WebhookFixtureName) {
    const fixture = WEBHOOK_FIXTURES[name];
    const list = toWebhookEndpoints(fixture.list);
    return {
      endpoints: list.endpoints.map((endpoint): StoredEndpoint => ({ endpoint, url: null })),
      failures: fixture.failures.map(toWebhookFailedDelivery),
      encryptionKeyConfigured: list.encryptionKeyConfigured,
      maxEndpoints: list.maxEndpoints,
      nextId: 1 + Math.max(0, ...list.endpoints.map((endpoint) => Number(endpoint.id)).filter(Number.isFinite)),
    };
  }

  /** 状態チップと failed 件数は配送失敗の一覧から導出する (failed が再試行で解消されれば healthy に戻る) */
  function endpointView(stored: StoredEndpoint): RegistrationWebhookEndpoint {
    const failed = webhook.failures.filter((item) => item.endpointId === stored.endpoint.id).length;
    const permanent = stored.endpoint.failingReasons.filter((reason) => reason !== "failed_deliveries");
    const failingReasons = [...(failed > 0 ? ["failed_deliveries"] : []), ...permanent];
    return {
      ...stored.endpoint,
      status: failingReasons.length > 0 ? "FAILING" : "HEALTHY",
      failingReasons,
      failedCount: failed,
      counts: { ...stored.endpoint.counts, failed },
    };
  }

  function findEndpoint(endpointId: string): StoredEndpoint {
    const stored = webhook.endpoints.find((item) => item.endpoint.id === endpointId);
    if (stored === undefined) throw new EmumetRegistrationTargetNotFoundError("no such webhook destination");
    return stored;
  }

  function reject(statusCode: number, reason: WebhookEndpointRejection): EmumetWebhookEndpointRejectedError {
    return new EmumetWebhookEndpointRejectedError(statusCode, reason);
  }

  function checkCategories(categories: readonly RegistrationWebhookCategory[]): void {
    if (categories.length === 0) throw reject(400, "no_categories");
  }

  function checkSecret(secret: string): void {
    const bytes = new TextEncoder().encode(secret).byteLength;
    if (bytes === 0) throw reject(400, "secret_required");
    if (bytes < 16) throw reject(400, "secret_too_short");
    if (bytes > 256) throw reject(400, "secret_too_long");
  }

  /** Emumet の登録時検査 (HTTPS のみ・userinfo と fragment は不可・2048 文字以内・内部宛先は不可) の写し */
  function parseUrl(raw: string): { normalized: string; masked: string } {
    if (raw.length > 2048) throw reject(400, "url_too_long");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw reject(400, "invalid_url");
    }
    if (url.protocol !== "https:") throw reject(400, "unsupported_scheme");
    if (url.username !== "" || url.password !== "") throw reject(400, "credentials_in_url");
    if (url.hash !== "" || raw.includes("#")) throw reject(400, "fragment_in_url");
    if (url.hostname === "") throw reject(400, "missing_host");
    if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname)) throw reject(400, "forbidden_destination");
    const tokens = url.pathname.split("/").filter((token) => token !== "");
    const last = tokens.at(-1) ?? "";
    const masked =
      last.length >= 12 ? `${url.host}/••••/${last.slice(-4)}`
      : tokens.length > 0 || url.search !== "" ? `${url.host}/••••`
      : url.host;
    return { normalized: url.toString(), masked };
  }

  function checkDuplicate(normalized: string, except: string | null): void {
    if (webhook.endpoints.some((item) => item.url === normalized && item.endpoint.id !== except)) {
      throw reject(409, "duplicate_url");
    }
  }

  function webhookList(): RegistrationWebhookEndpoints {
    return {
      endpoints: webhook.endpoints.map(endpointView),
      hasFailedDeliveries: webhook.failures.length > 0,
      encryptionKeyConfigured: webhook.encryptionKeyConfigured,
      maxEndpoints: webhook.maxEndpoints,
    };
  }

  /** failed になった時刻の新しい順 (同時刻は送信先 ID・event ID の降順) */
  function sortedFailures(endpointId: string | undefined): RegistrationWebhookFailedDelivery[] {
    const descending = (a: string, b: string) => (a === b ? 0 : a < b ? 1 : -1);
    return webhook.failures
      .filter((item) => endpointId === undefined || item.endpointId === endpointId)
      .sort((a, b) => descending(a.failedAt, b.failedAt) || descending(a.endpointId, b.endpointId) || Number(b.eventId) - Number(a.eventId));
  }

  /** cursor は「この失敗より古いもの」を指す不透明な文字列 (mock では failedAt|endpointId|eventId) */
  function failureCursor(item: RegistrationWebhookFailedDelivery): string {
    return btoa(`${item.failedAt}|${item.endpointId}|${item.eventId}`);
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
    async listRegistrationWebhookEndpoints() {
      guard();
      return webhookList();
    },
    async createRegistrationWebhookEndpoint(input) {
      guard();
      checkCategories(input.categories);
      const url = parseUrl(input.url);
      checkSecret(input.secret);
      if (!webhook.encryptionKeyConfigured) throw reject(409, "encryption_key_not_configured");
      if (webhook.endpoints.length >= webhook.maxEndpoints) throw reject(409, "endpoint_limit_reached");
      checkDuplicate(url.normalized, null);
      const at = now();
      const endpoint: RegistrationWebhookEndpoint = {
        id: String(webhook.nextId++),
        source: "API",
        maskedUrl: url.masked,
        categories: [...new Set(input.categories)],
        status: "HEALTHY",
        failingReasons: [],
        configIssue: null,
        failedCount: 0,
        counts: { pending: 0, inFlight: 0, retrying: 0, delivered: 0, failed: 0 },
        secretConfigured: true,
        editable: true,
        revision: 1,
        lastSuccessAt: null,
        lastFailureAt: null,
        createdAt: at,
      };
      const stored = { endpoint, url: url.normalized };
      webhook.endpoints.push(stored);
      return endpointView(stored);
    },
    async updateRegistrationWebhookEndpoint(endpointId, input) {
      guard();
      const stored = findEndpoint(endpointId);
      if (!stored.endpoint.editable) throw reject(409, "environment_endpoint_read_only");
      if (stored.endpoint.revision !== input.revision) throw status(409);
      if (input.url === undefined && input.secret === undefined && input.categories === undefined) {
        throw reject(400, "nothing_to_update");
      }
      if (input.categories !== undefined) checkCategories(input.categories);
      const url = input.url === undefined ? undefined : parseUrl(input.url);
      if (input.secret !== undefined) {
        checkSecret(input.secret);
        if (!webhook.encryptionKeyConfigured) throw reject(409, "encryption_key_not_configured");
      }
      if (url !== undefined) checkDuplicate(url.normalized, endpointId);
      stored.endpoint = {
        ...stored.endpoint,
        ...(url === undefined ? {} : { maskedUrl: url.masked }),
        ...(input.categories === undefined ? {} : { categories: [...new Set(input.categories)] }),
        // secret の再入力で復号不可は解消する
        ...(input.secret === undefined ? {} : { secretConfigured: true, failingReasons: stored.endpoint.failingReasons.filter((reason) => reason !== "secret_undecryptable") }),
        revision: input.revision + 1,
      };
      if (url !== undefined) stored.url = url.normalized;
      return endpointView(stored);
    },
    async deleteRegistrationWebhookEndpoint(endpointId, revision) {
      guard();
      const stored = findEndpoint(endpointId);
      if (!stored.endpoint.editable) throw reject(409, "environment_endpoint_read_only");
      if (stored.endpoint.revision !== revision) throw status(409);
      // 未完了の配送と配送履歴も消える (それ以降この送信先へは何も届かない)
      webhook.endpoints = webhook.endpoints.filter((item) => item !== stored);
      webhook.failures = webhook.failures.filter((item) => item.endpointId !== endpointId);
    },
    async sendRegistrationWebhookTest(endpointId) {
      guard();
      const view = endpointView(findEndpoint(endpointId));
      if (view.failingReasons.includes("config_invalid")) throw new EmumetWebhookUnavailableError();
      const fixture = view.status === "FAILING" ? WEBHOOK_TEST_FIXTURES.failure : WEBHOOK_TEST_FIXTURES.success;
      return { ...toWebhookTest(fixture), attemptedAt: now() };
    },
    async listRegistrationWebhookFailures(query) {
      guard();
      const limit = query?.limit ?? DEFAULT_PAGE_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) throw status(400);
      if (query?.endpointId !== undefined) findEndpoint(query.endpointId);
      const all = sortedFailures(query?.endpointId);
      let start = 0;
      if (query?.before !== undefined) {
        const index = all.findIndex((item) => failureCursor(item) === query.before);
        if (index === -1) throw status(400);
        start = index + 1;
      }
      const items = all.slice(start, start + limit);
      const last = items.at(-1);
      return { items, nextCursor: start + limit < all.length && last !== undefined ? failureCursor(last) : null };
    },
    async retryRegistrationWebhook(target) {
      guard();
      if (target !== undefined) findEndpoint(target.endpointId);
      const targets = webhook.failures.filter(
        (item) =>
          target === undefined ||
          (item.endpointId === target.endpointId && (target.eventId === undefined || item.eventId === target.eventId)),
      );
      if (target?.eventId !== undefined && targets.length === 0) {
        throw new EmumetRegistrationTargetNotFoundError("no failed webhook delivery for that destination / event ID");
      }
      // 再キューした配送は mock では成功したものとして配送失敗の一覧から外す
      webhook.failures = webhook.failures.filter((item) => !targets.includes(item));
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
