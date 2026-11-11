// ============================================================
// 登録ゲートの全状態 fixture (ワイヤ形式 = Emumet OpenAPI の応答そのもの)
//
// 値は bff/emumet/generated/emumet-api.ts の型で縛り、registration-gate-fixtures.test.ts が
// vendored OpenAPI (openapi/emumet.json、producer pin 済み) の応答スキーマに照合する。
// mock (registration-gate-mock.ts) の初期状態もここから作るため、mock と契約が乖離しない。
// 保護の readiness (E15c) と Webhook 配送状態 (E15w) の fixture も同じ方法で OpenAPI に照合する。
// ============================================================

import type {
  WireMe,
  WireProtectionList,
  WireProtectionReadiness,
  WireRegistrationGate,
  WireRegistrationGateNotification,
  WireRegistrationGateNotificationList,
  WireRegistrationObservation,
  WireVerifyProtection,
  WireWebhookDelivery,
  WireWebhookRetry,
  WireWebhookStatus,
  WireWebhookTest,
} from "./registration-gate-real.ts";

type Probe = "healthy" | "unhealthy" | "unknown";

function observation(email: [configured: boolean, probe: Probe], bot: [configured: boolean, probe: Probe]): WireRegistrationObservation {
  return {
    enforcement_verified: true,
    email: { configured: email[0], probe: email[1] },
    bot: { configured: bot[0], probe: bot[1] },
  };
}

const HEALTHY_BOTH = observation([true, "healthy"], [true, "healthy"]);
const UNCONFIGURED = observation([false, "unknown"], [false, "unknown"]);
const NO_OVERRIDE = { active: false, activated_by: null, activated_at: null } as const;
const OVERRIDE_BY_ADMIN = { active: true, activated_by: "auth-account-admin-1", activated_at: "2026-11-10T02:00:00Z" } as const;

export const REGISTRATION_GATE_FIXTURES = {
  /** 通常開放 (両対策が実応答・防御低下なし) */
  accepting_protected: {
    revision: 7,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: ["email", "bot"],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: HEALTHY_BOTH,
    updated_at: "2026-11-10T01:00:00Z",
  },
  /** 通常開放 (片方のみ設定。設定していない対策は防御低下ではない) */
  accepting_email_only: {
    revision: 8,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: ["email"],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: observation([true, "healthy"], [false, "unknown"]),
    updated_at: "2026-11-10T01:05:00Z",
  },
  /** 片方障害 (BOT 対策が応答しない。動作中のメール認証のみ課して継続 = 防御低下) */
  accepting_degraded_bot: {
    revision: 9,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "degraded",
    enforced_protections: ["email"],
    degraded_protections: ["bot"],
    override: NO_OVERRIDE,
    observation: observation([true, "healthy"], [true, "unhealthy"]),
    updated_at: "2026-11-10T01:10:00Z",
  },
  /** 片方障害 (メール認証が応答しない。BOT 対策のみ課して継続) */
  accepting_degraded_email: {
    revision: 10,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "degraded",
    enforced_protections: ["bot"],
    degraded_protections: ["email"],
    override: NO_OVERRIDE,
    observation: observation([true, "unknown"], [true, "healthy"]),
    updated_at: "2026-11-10T01:15:00Z",
  },
  /** 管理者閉鎖 (準備は整っている。自動では解除されない) */
  admin_closed: {
    revision: 11,
    admin_state: "closed",
    decision: "admin_closed",
    accepting: false,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: HEALTHY_BOTH,
    updated_at: "2026-11-10T01:20:00Z",
  },
  /** 準備未完了 (初期状態: 閉鎖・対策が一つも設定されていない。通常の開放は 422、override のみ可) */
  not_ready: {
    revision: 0,
    admin_state: "closed",
    decision: "admin_closed",
    accepting: false,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: UNCONFIGURED,
    updated_at: "2026-11-10T00:00:00Z",
  },
  /** 準備途中 (初期状態のまま。メール認証は設定済みだが未検証 = 条件未達。通常の開放は 422) */
  not_ready_unverified: {
    revision: 0,
    admin_state: "closed",
    decision: "admin_closed",
    accepting: false,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: observation([true, "unknown"], [false, "unknown"]),
    updated_at: "2026-11-10T00:00:00Z",
  },
  /** 一時拒否 (設定は残っているが検証 API が応答しない。復旧すれば自動で再開する) */
  temporary_reject: {
    revision: 12,
    admin_state: "open",
    decision: "temporary_reject",
    accepting: false,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "outage",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: observation([true, "unhealthy"], [true, "unknown"]),
    updated_at: "2026-11-10T01:25:00Z",
  },
  /** 設定喪失停止 (両対策の設定が失われ停止ラッチが成立。手動再開が必要) */
  stopped_config_lost: {
    revision: 13,
    admin_state: "open",
    decision: "stopped",
    accepting: false,
    requires_manual_resume: true,
    config_lost_latch: true,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: UNCONFIGURED,
    updated_at: "2026-11-10T01:30:00Z",
  },
  /** 再開待ち (設定が復旧したが自動再開しない。管理者の手動再開を待つ) */
  stopped_awaiting_resume: {
    revision: 13,
    admin_state: "open",
    decision: "stopped",
    accepting: false,
    requires_manual_resume: true,
    config_lost_latch: true,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: HEALTHY_BOTH,
    updated_at: "2026-11-10T01:35:00Z",
  },
  /** override 中 (準備済みの保護なし。対策が一つも設定されていなくても開放中) */
  override_unprotected: {
    revision: 14,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: OVERRIDE_BY_ADMIN,
    observation: UNCONFIGURED,
    updated_at: "2026-11-10T02:00:00Z",
  },
  /** override 中 (準備済みの保護あり。override 中も実応答した対策は登録時に課される) */
  override_protected: {
    revision: 15,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: ["email"],
    degraded_protections: [],
    override: OVERRIDE_BY_ADMIN,
    observation: observation([true, "healthy"], [false, "unknown"]),
    updated_at: "2026-11-10T02:05:00Z",
  },
  /** override 中 (片方の対策が応答しない。override 中は一時拒否・自動停止の判定を行わない) */
  override_degraded: {
    revision: 16,
    admin_state: "open",
    decision: "accepting",
    accepting: true,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: ["email"],
    degraded_protections: ["bot"],
    override: OVERRIDE_BY_ADMIN,
    observation: observation([true, "healthy"], [true, "unhealthy"]),
    updated_at: "2026-11-10T02:10:00Z",
  },
  /** override 値を保持したまま管理者が閉鎖 (decision は閉鎖だが override は On のまま常時表示の対象) */
  override_admin_closed: {
    revision: 17,
    admin_state: "closed",
    decision: "admin_closed",
    accepting: false,
    requires_manual_resume: false,
    config_lost_latch: false,
    enforcement_lost_latch: false,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: OVERRIDE_BY_ADMIN,
    observation: UNCONFIGURED,
    updated_at: "2026-11-10T02:15:00Z",
  },
  /**
   * E15d: 登録の保護の適用証明が失われた (override 中でも STOPPED。override 値は保持される)。
   * 証明が戻るまで開放・再開・override は 422
   */
  stopped_enforcement_lost: {
    revision: 18,
    admin_state: "open",
    decision: "stopped",
    accepting: false,
    requires_manual_resume: true,
    config_lost_latch: false,
    enforcement_lost_latch: true,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: OVERRIDE_BY_ADMIN,
    observation: { ...HEALTHY_BOTH, enforcement_verified: false },
    updated_at: "2026-11-10T02:20:00Z",
  },
  /** E15d: 適用証明は復旧したがラッチが残り、管理者の手動再開を待つ */
  stopped_enforcement_restored: {
    revision: 19,
    admin_state: "open",
    decision: "stopped",
    accepting: false,
    requires_manual_resume: true,
    config_lost_latch: false,
    enforcement_lost_latch: true,
    health_episode: "none",
    enforced_protections: [],
    degraded_protections: [],
    override: NO_OVERRIDE,
    observation: HEALTHY_BOTH,
    updated_at: "2026-11-10T02:25:00Z",
  },
} as const satisfies Record<string, WireRegistrationGate>;

export type RegistrationGateFixtureName = keyof typeof REGISTRATION_GATE_FIXTURES;

export const REGISTRATION_GATE_FIXTURE_NAMES = Object.keys(REGISTRATION_GATE_FIXTURES) as RegistrationGateFixtureName[];

type NotificationKind = WireRegistrationGateNotification["kind"];

export function notificationFixture(
  id: number,
  kind: NotificationKind,
  options: { read?: boolean; revision?: number; actor?: string | null; observation?: WireRegistrationObservation } = {},
): WireRegistrationGateNotification {
  const read = options.read ?? false;
  const minute = String(id % 60).padStart(2, "0");
  return {
    id: String(id),
    kind,
    revision: options.revision ?? id,
    actor: options.actor ?? null,
    observation: options.observation ?? HEALTHY_BOTH,
    created_at: `2026-11-10T03:${minute}:00Z`,
    read,
    read_at: read ? `2026-11-10T04:${minute}:00Z` : null,
  };
}

function page(notifications: WireRegistrationGateNotification[], nextCursor: string | null = null): WireRegistrationGateNotificationList {
  return {
    notifications,
    unread_count: notifications.filter((item) => !item.read).length,
    next_cursor: nextCursor,
  };
}

/** 種別を網羅した通知 (id が大きいほど新しい。サーバーは新しい順に返す) */
const ALL_KINDS: NotificationKind[] = [
  "override_revoked",
  "override_started",
  "protection_lost_stopped",
  "protection_degraded",
  "outage_recovered",
  "outage_started",
];

function manyNotifications(count: number): WireRegistrationGateNotification[] {
  return Array.from({ length: count }, (_, index) => {
    const id = 1000 - index;
    const kind = ALL_KINDS[index % ALL_KINDS.length] as NotificationKind;
    const actor = kind === "override_started" || kind === "override_revoked" ? "auth-account-admin-1" : null;
    return notificationFixture(id, kind, { read: index >= 3, actor });
  });
}

export const NOTIFICATION_LIST_FIXTURES = {
  empty: page([]),
  /** 未読のみ (全種別) */
  all_unread: page(
    ALL_KINDS.map((kind, index) =>
      notificationFixture(106 - index, kind, {
        actor: kind === "override_started" || kind === "override_revoked" ? "auth-account-admin-1" : null,
      }),
    ),
  ),
  /** 既読のみ */
  all_read: page([
    notificationFixture(202, "outage_recovered", { read: true }),
    notificationFixture(201, "outage_started", { read: true }),
  ]),
  /** 未読と既読の混在 (既読は管理者ごと。read は呼び出した管理者自身の状態) */
  mixed: page([
    notificationFixture(303, "override_started", { actor: "auth-account-admin-1" }),
    notificationFixture(302, "protection_degraded", { read: true }),
    notificationFixture(301, "outage_started", { read: true }),
  ]),
  /** 多数 (1 ページ目。次ページがある。unread_count はページ範囲ではなく管理者の全未読件数) */
  many_first_page: {
    notifications: manyNotifications(50),
    unread_count: 3,
    next_cursor: "951",
  },
  /** 多数の最終ページ */
  many_last_page: {
    notifications: Array.from({ length: 12 }, (_, index) => notificationFixture(50 - index, "outage_started", { read: true })),
    unread_count: 0,
    next_cursor: null,
  },
} as const satisfies Record<string, WireRegistrationGateNotificationList>;

export type NotificationListFixtureName = keyof typeof NOTIFICATION_LIST_FIXTURES;

export const UNREAD_COUNT_FIXTURES = {
  none: { unread_count: 0 },
  some: { unread_count: 3 },
} as const;

/** E15d の通知 (適用証明の喪失・復旧)。ALL_KINDS とは別にして既存 fixture の並びを変えない */
export const ENFORCEMENT_NOTIFICATION_FIXTURES = page([
  notificationFixture(402, "enforcement_restored", { read: false }),
  notificationFixture(401, "enforcement_lost_stopped", {
    read: false,
    observation: { ...HEALTHY_BOTH, enforcement_verified: false },
  }),
]);

// ------------------------------------------------------------
// 保護の readiness (E15c)。observation との対応は Emumet の to_observation と同じ
// (operational → configured・healthy / temporarily_unavailable → configured・unhealthy /
//  unverified → configured・unknown / configuration_invalid → 未設定扱い)。
// ------------------------------------------------------------

type ProtectionName = "email" | "bot";

const PROVIDER: Readonly<Record<ProtectionName, string>> = { email: "smtp", bot: "turnstile" };

export function protectionReadinessFixture(
  protection: ProtectionName,
  status: "configuration_invalid" | "operational" | "temporarily_unavailable" | "unverified",
  options: { enabled?: boolean; reason?: string; checkedAt?: string | null } = {},
): WireProtectionReadiness {
  const enabled = options.enabled ?? true;
  const checkedAt = options.checkedAt === undefined ? (status === "unverified" || !enabled ? null : "2026-11-10T03:41:00Z") : options.checkedAt;
  const defaultReason = {
    configuration_invalid: enabled ? "invalid_secret" : "not_configured",
    operational: "business_success",
    temporarily_unavailable: "timeout",
    unverified: "never_verified",
  }[status];
  return {
    protection,
    provider: PROVIDER[protection],
    enabled,
    generation: `gen-${protection}-1`,
    fingerprint: enabled ? `fp-${protection}` : "",
    status,
    reason: options.reason ?? defaultReason,
    checked_at: checkedAt,
    valid_until: status === "operational" ? "2026-11-10T09:41:00Z" : null,
    last_check: null,
  };
}

/** 未設定の保護 (enabled=false / configuration_invalid / not_configured) */
export function unsetProtectionFixture(protection: ProtectionName): WireProtectionReadiness {
  return protectionReadinessFixture(protection, "configuration_invalid", { enabled: false });
}

export const PROTECTION_LIST_FIXTURES = {
  both_operational: { protections: [protectionReadinessFixture("email", "operational"), protectionReadinessFixture("bot", "operational")] },
  unset: { protections: [unsetProtectionFixture("email"), unsetProtectionFixture("bot")] },
  /** 未確認 (設定済みだが一度も検証していない) と未設定 */
  email_unverified_bot_unset: { protections: [protectionReadinessFixture("email", "unverified"), unsetProtectionFixture("bot")] },
  /** 応答なし (一時障害) と準備済み */
  email_unavailable_bot_operational: {
    protections: [protectionReadinessFixture("email", "temporarily_unavailable"), protectionReadinessFixture("bot", "operational")],
  },
  /** 設定エラー (サイトキー/secret が不正) と未設定 */
  email_unset_bot_invalid: {
    protections: [unsetProtectionFixture("email"), protectionReadinessFixture("bot", "configuration_invalid", { reason: "invalid_secret" })],
  },
} as const satisfies Record<string, WireProtectionList>;

export const VERIFY_PROTECTION_FIXTURES = {
  /** bot: token なしの負の probe。secret は受理されたが operational にはならない */
  bot_negative_probe: {
    result: { outcome: "accepted", reason: "accepted", transport: "http_2xx" },
    recorded: true,
    disposition: "completed",
    pending_challenge: null,
    readiness: protectionReadinessFixture("bot", "unverified", { reason: "no_business_success", checkedAt: "2026-11-10T03:50:00Z" }),
  },
  /** email: canary mailbox にコードを送った (確認待ち) */
  email_pending: {
    result: { outcome: "accepted", reason: "accepted", transport: "smtp_accepted" },
    recorded: true,
    disposition: "pending_confirmation",
    pending_challenge: { challenge_id: "challenge-1", expires_at: "2026-11-10T04:00:00Z" },
    readiness: protectionReadinessFixture("email", "unverified", { reason: "no_business_success", checkedAt: "2026-11-10T03:50:00Z" }),
  },
  /** 一時障害 (タイムアウト) */
  email_timeout: {
    result: { outcome: "temporarily_unavailable", reason: "timeout", transport: "timeout" },
    recorded: true,
    disposition: "completed",
    pending_challenge: null,
    readiness: protectionReadinessFixture("email", "temporarily_unavailable", { checkedAt: "2026-11-10T03:50:00Z" }),
  },
} as const satisfies Record<string, WireVerifyProtection>;

// ------------------------------------------------------------
// Webhook 配送状態 (E15w)。宛先は host のみ、secret・URL 全体は含まない
// ------------------------------------------------------------

export function webhookDeliveryFixture(
  eventId: string,
  eventType: WireWebhookDelivery["event_type"],
  status: "pending" | "in_flight" | "retrying" | "delivered" | "failed",
  minute: number,
): WireWebhookDelivery {
  const at = `2026-11-10T03:${String(minute).padStart(2, "0")}:00Z`;
  return {
    event_id: eventId,
    event_type: eventType,
    status,
    attempt_count: status === "pending" ? 0 : status === "failed" ? 5 : status === "retrying" ? 2 : 1,
    created_at: at,
    last_attempt_at: status === "pending" ? null : at,
    delivered_at: status === "delivered" ? at : null,
    last_result: status === "delivered" ? "delivered" : status === "pending" ? null : "http_server_error",
    last_http_status: status === "delivered" ? 204 : status === "pending" ? null : 503,
    failure_reason: status === "failed" ? "retries_exhausted" : null,
    next_attempt_at: status === "retrying" ? "2026-11-10T04:10:00Z" : null,
  };
}

const NO_DELIVERIES = { pending: 0, in_flight: 0, retrying: 0, delivered: 0, failed: 0 };

export const WEBHOOK_STATUS_FIXTURES = {
  /** 未設定 (Webhook 無効。エラーではない) */
  not_configured: {
    configuration: "not_configured",
    issue: null,
    destination_host: null,
    counts: NO_DELIVERIES,
    last_success_at: null,
    last_failure_at: null,
    recent_deliveries: [],
  },
  /** 設定不備 (secret が無い) */
  misconfigured: {
    configuration: "misconfigured",
    issue: "missing_secret",
    destination_host: "hooks.example.net",
    counts: NO_DELIVERIES,
    last_success_at: null,
    last_failure_at: null,
    recent_deliveries: [],
  },
  /** 正常 (直近の配送はすべて成功) */
  healthy: {
    configuration: "configured",
    issue: null,
    destination_host: "hooks.example.net",
    counts: { ...NO_DELIVERIES, delivered: 2 },
    last_success_at: "2026-11-10T03:32:00Z",
    last_failure_at: null,
    recent_deliveries: [
      webhookDeliveryFixture("12", "protection_degraded", "delivered", 32),
      webhookDeliveryFixture("11", "outage_recovered", "delivered", 20),
    ],
  },
  /** 再試行中 (自動再試行の途中。失敗ではない) */
  retrying: {
    configuration: "configured",
    issue: null,
    destination_host: "hooks.example.net",
    counts: { ...NO_DELIVERIES, retrying: 1, delivered: 1 },
    last_success_at: "2026-11-10T03:20:00Z",
    last_failure_at: "2026-11-10T03:32:00Z",
    recent_deliveries: [
      webhookDeliveryFixture("12", "protection_degraded", "retrying", 32),
      webhookDeliveryFixture("11", "outage_recovered", "delivered", 20),
    ],
  },
  /** 配送失敗あり (failed は自動では再試行されない。管理者が再試行する) */
  failed: {
    configuration: "configured",
    issue: null,
    destination_host: "hooks.example.net",
    counts: { ...NO_DELIVERIES, delivered: 1, failed: 2 },
    last_success_at: "2026-11-10T03:20:00Z",
    last_failure_at: "2026-11-10T03:40:00Z",
    recent_deliveries: [
      webhookDeliveryFixture("13", "outage_started", "failed", 40),
      webhookDeliveryFixture("12", "protection_degraded", "failed", 32),
      webhookDeliveryFixture("11", "outage_recovered", "delivered", 20),
    ],
  },
} as const satisfies Record<string, WireWebhookStatus>;

export type WebhookStatusFixtureName = keyof typeof WEBHOOK_STATUS_FIXTURES;

export const WEBHOOK_TEST_FIXTURES = {
  success: { event_id: "test_01", delivered: true, result: "delivered", http_status: 204, attempted_at: "2026-11-10T03:50:00Z" },
  failure: { event_id: "test_02", delivered: false, result: "http_server_error", http_status: 503, attempted_at: "2026-11-10T03:50:00Z" },
} as const satisfies Record<string, WireWebhookTest>;

export const WEBHOOK_RETRY_FIXTURES = {
  one: { requeued: 1 },
  none: { requeued: 0 },
} as const satisfies Record<string, WireWebhookRetry>;

export const ME_FIXTURES = {
  admin: { account_id: "1001", instance_roles: ["admin"] },
  moderator: { account_id: "1002", instance_roles: ["moderator"] },
  member: { account_id: "1003", instance_roles: [] },
} as const satisfies Record<string, WireMe>;
