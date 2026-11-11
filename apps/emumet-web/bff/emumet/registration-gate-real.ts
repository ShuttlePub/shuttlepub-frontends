// ============================================================
// RealRegistrationGateClient — Emumet REST (/api/v1/admin/registration-gate*)
// ワイヤ形式は snake_case、DTO は camelCase。境界で相互変換する。
//
// fail closed:
//   * 200 以外の 2xx / OpenAPI 契約に反する 200 / 語彙外の値 / 不整合な組合せ → EmumetInvalidResponseError
//   * 4xx/5xx → EmumetApiError (status を保持。分類は resolvers 側。応答本文はクライアントへ出さない)
//   * 接続失敗・タイムアウト → EmumetUnavailableError (一時障害)
// 成功や mock データへ置き換えることはしない。
// ============================================================

import { describeViolations, violationsForResponse, type HttpMethod } from "../openapi/contract.ts";
import { EmumetApiError } from "./client.ts";
import type { components } from "./generated/emumet-api.ts";
import {
  EmumetInvalidResponseError,
  EmumetUnavailableError,
  type RegistrationAdminState,
  type RegistrationDecision,
  type RegistrationGate,
  type RegistrationGateClient,
  type RegistrationGateEventKind,
  type RegistrationGateNotification,
  type RegistrationGateNotificationPage,
  type RegistrationGateNotificationQuery,
  type RegistrationHealthEpisode,
  type RegistrationObservation,
  type RegistrationProbeStatus,
  type RegistrationProtection,
  type RegistrationProtectionObservation,
  type InstanceRole,
  type RegistrationProtectionReadiness,
  type RegistrationProtectionStatus,
  type RegistrationProtectionVerification,
  type RegistrationProtectionVerifyDisposition,
  type RegistrationProtectionVerifyOutcome,
  type RegistrationWebhookConfiguration,
  type RegistrationWebhookDelivery,
  type RegistrationWebhookDeliveryStatus,
  type RegistrationWebhookStatus,
  type RegistrationWebhookTestResult,
  type Viewer,
  EmumetRegistrationTargetNotFoundError,
  EmumetWebhookUnavailableError,
} from "./registration-gate.ts";

export type WireRegistrationGate = components["schemas"]["RegistrationGateResponse"];
export type WireRegistrationGateNotification = components["schemas"]["RegistrationGateNotificationResponse"];
export type WireRegistrationGateNotificationList = components["schemas"]["RegistrationGateNotificationListResponse"];
export type WireRegistrationObservation = components["schemas"]["RegistrationObservationResponse"];
export type WireUnreadCount = components["schemas"]["UnreadCountResponse"];
export type WireProtectionReadiness = components["schemas"]["ProtectionReadinessResponse"];
export type WireProtectionList = components["schemas"]["ProtectionListResponse"];
export type WireVerifyProtection = components["schemas"]["VerifyProtectionResponse"];
export type WireWebhookStatus = components["schemas"]["WebhookStatusResponse"];
export type WireWebhookDelivery = components["schemas"]["WebhookDeliveryResponse"];
export type WireWebhookTest = components["schemas"]["WebhookTestResponse"];
export type WireWebhookRetry = components["schemas"]["WebhookRetryResponse"];
export type WireMe = components["schemas"]["MeResponse"];

export const REGISTRATION_GATE_BASE_PATH = "/api/v1/admin/registration-gate";
export const ME_PATH = "/api/v1/me";

/** 接続・応答待ちの上限。これを超えたら一時障害 (EmumetUnavailableError) として扱う */
export const DEFAULT_REGISTRATION_GATE_TIMEOUT_MS = 10_000;

/** GraphQL Int / JSON 安全整数に収まる範囲だけを受け入れる (revision・件数) */
const MAX_GRAPHQL_INT = 2 ** 31 - 1;

export type RegistrationGateTransport = {
  request(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response>;
};

function invalid(what: string, detail: string): EmumetInvalidResponseError {
  return new EmumetInvalidResponseError(`Emumet API ${what}: ${detail}`);
}

function vocabulary<T extends string>(what: string, value: string, table: Readonly<Record<string, T>>): T {
  const mapped = table[value];
  if (mapped === undefined) throw invalid(what, `unknown value ${JSON.stringify(value)}`);
  return mapped;
}

function toInt(what: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_GRAPHQL_INT) {
    throw invalid(what, `${value} is outside the supported integer range`);
  }
  return value;
}

const DECISIONS: Readonly<Record<string, RegistrationDecision>> = {
  accepting: "ACCEPTING",
  admin_closed: "ADMIN_CLOSED",
  stopped: "STOPPED",
  temporary_reject: "TEMPORARY_REJECT",
};
const ADMIN_STATES: Readonly<Record<string, RegistrationAdminState>> = { open: "OPEN", closed: "CLOSED" };
const EPISODES: Readonly<Record<string, RegistrationHealthEpisode>> = { none: "NONE", outage: "OUTAGE", degraded: "DEGRADED" };
const PROTECTIONS: Readonly<Record<string, RegistrationProtection>> = { email: "EMAIL", bot: "BOT" };
const PROBES: Readonly<Record<string, RegistrationProbeStatus>> = { healthy: "HEALTHY", unhealthy: "UNHEALTHY", unknown: "UNKNOWN" };
const EVENT_KINDS: Readonly<Record<string, RegistrationGateEventKind>> = {
  outage_started: "OUTAGE_STARTED",
  outage_recovered: "OUTAGE_RECOVERED",
  protection_degraded: "PROTECTION_DEGRADED",
  protection_lost_stopped: "PROTECTION_LOST_STOPPED",
  override_started: "OVERRIDE_STARTED",
  override_revoked: "OVERRIDE_REVOKED",
  enforcement_lost_stopped: "ENFORCEMENT_LOST_STOPPED",
  enforcement_restored: "ENFORCEMENT_RESTORED",
};
const PROTECTION_STATUSES: Readonly<Record<string, RegistrationProtectionStatus>> = {
  configuration_invalid: "CONFIGURATION_INVALID",
  operational: "OPERATIONAL",
  temporarily_unavailable: "TEMPORARILY_UNAVAILABLE",
  unverified: "UNVERIFIED",
};
const VERIFY_OUTCOMES: Readonly<Record<string, RegistrationProtectionVerifyOutcome>> = {
  business_success: "BUSINESS_SUCCESS",
  accepted: "ACCEPTED",
  configuration_invalid: "CONFIGURATION_INVALID",
  attempt_rejected: "ATTEMPT_REJECTED",
  temporarily_unavailable: "TEMPORARILY_UNAVAILABLE",
};
const VERIFY_DISPOSITIONS: Readonly<Record<string, RegistrationProtectionVerifyDisposition>> = {
  completed: "COMPLETED",
  pending_confirmation: "PENDING_CONFIRMATION",
  canary_not_configured: "CANARY_NOT_CONFIGURED",
};
const WEBHOOK_CONFIGURATIONS: Readonly<Record<string, RegistrationWebhookConfiguration>> = {
  not_configured: "NOT_CONFIGURED",
  misconfigured: "MISCONFIGURED",
  configured: "CONFIGURED",
};
const WEBHOOK_DELIVERY_STATUSES: Readonly<Record<string, RegistrationWebhookDeliveryStatus>> = {
  pending: "PENDING",
  in_flight: "IN_FLIGHT",
  retrying: "RETRYING",
  delivered: "DELIVERED",
  failed: "FAILED",
};
/** 未知のロールは UI の出し分けに使わないので捨てる (権限判断は各管理 API が行う) */
const INSTANCE_ROLES: Readonly<Record<string, InstanceRole>> = { admin: "ADMIN", moderator: "MODERATOR" };

function toProtectionObservation(wire: { configured: boolean; probe: string }): RegistrationProtectionObservation {
  return { configured: wire.configured, probe: vocabulary("probe", wire.probe, PROBES) };
}

export function toObservation(wire: WireRegistrationObservation): RegistrationObservation {
  return {
    enforcementVerified: wire.enforcement_verified,
    email: toProtectionObservation(wire.email),
    bot: toProtectionObservation(wire.bot),
  };
}

function toProtections(what: string, values: readonly string[]): readonly RegistrationProtection[] {
  return values.map((value) => vocabulary(what, value, PROTECTIONS));
}

export function toRegistrationGate(wire: WireRegistrationGate): RegistrationGate {
  const decision = vocabulary("decision", wire.decision, DECISIONS);
  // accepting / requires_manual_resume は decision から一意に決まる。食い違いは状態の混同になるので受け入れない
  if (wire.accepting !== (decision === "ACCEPTING")) {
    throw invalid("registration gate", `accepting=${wire.accepting} contradicts decision=${wire.decision}`);
  }
  if (wire.requires_manual_resume !== (decision === "STOPPED")) {
    throw invalid("registration gate", `requires_manual_resume=${wire.requires_manual_resume} contradicts decision=${wire.decision}`);
  }
  const override = wire.override;
  if (!override.active && (override.activated_by != null || override.activated_at != null)) {
    throw invalid("registration gate", "inactive override carries activation details");
  }
  return {
    revision: toInt("revision", wire.revision),
    adminState: vocabulary("admin_state", wire.admin_state, ADMIN_STATES),
    decision,
    accepting: wire.accepting,
    requiresManualResume: wire.requires_manual_resume,
    configLostLatch: wire.config_lost_latch,
    enforcementLostLatch: wire.enforcement_lost_latch,
    healthEpisode: vocabulary("health_episode", wire.health_episode, EPISODES),
    enforcedProtections: toProtections("enforced_protections", wire.enforced_protections),
    degradedProtections: toProtections("degraded_protections", wire.degraded_protections),
    override: {
      active: override.active,
      activatedBy: override.activated_by ?? null,
      activatedAt: override.activated_at ?? null,
    },
    observation: toObservation(wire.observation),
    updatedAt: wire.updated_at,
  };
}

export function toNotification(wire: WireRegistrationGateNotification): RegistrationGateNotification {
  return {
    id: wire.id,
    kind: vocabulary("kind", wire.kind, EVENT_KINDS),
    revision: toInt("notification revision", wire.revision),
    actor: wire.actor ?? null,
    observation: toObservation(wire.observation),
    createdAt: wire.created_at,
    read: wire.read,
    readAt: wire.read_at ?? null,
  };
}

export function toNotificationPage(wire: WireRegistrationGateNotificationList): RegistrationGateNotificationPage {
  return {
    notifications: wire.notifications.map(toNotification),
    unreadCount: toInt("unread_count", wire.unread_count),
    nextCursor: wire.next_cursor ?? null,
  };
}

export function toProtectionReadiness(wire: WireProtectionReadiness): RegistrationProtectionReadiness {
  const status = vocabulary("protection status", wire.status, PROTECTION_STATUSES);
  if (!wire.enabled && status === "OPERATIONAL") {
    throw invalid("protection readiness", "a disabled protection cannot be operational");
  }
  return {
    protection: vocabulary("protection", wire.protection, PROTECTIONS),
    enabled: wire.enabled,
    status,
    reason: wire.reason,
    checkedAt: wire.checked_at ?? null,
    validUntil: wire.valid_until ?? null,
  };
}

export function toProtectionList(wire: WireProtectionList): readonly RegistrationProtectionReadiness[] {
  const list = wire.protections.map(toProtectionReadiness);
  if (new Set(list.map((item) => item.protection)).size !== list.length) {
    throw invalid("protection list", "duplicate protection");
  }
  return list;
}

export function toVerification(wire: WireVerifyProtection): RegistrationProtectionVerification {
  return {
    outcome: vocabulary("verify outcome", wire.result.outcome, VERIFY_OUTCOMES),
    reason: wire.result.reason,
    recorded: wire.recorded,
    disposition: vocabulary("verify disposition", wire.disposition, VERIFY_DISPOSITIONS),
    readiness: toProtectionReadiness(wire.readiness),
  };
}

export function toWebhookDelivery(wire: WireWebhookDelivery): RegistrationWebhookDelivery {
  return {
    eventId: wire.event_id,
    eventType: vocabulary("webhook event_type", wire.event_type, EVENT_KINDS),
    status: vocabulary("webhook delivery status", wire.status, WEBHOOK_DELIVERY_STATUSES),
    attemptCount: toInt("attempt_count", wire.attempt_count),
    createdAt: wire.created_at,
    lastAttemptAt: wire.last_attempt_at ?? null,
    deliveredAt: wire.delivered_at ?? null,
    lastResult: wire.last_result ?? null,
    failureReason: wire.failure_reason ?? null,
  };
}

/** host のみ (ラベル列か角括弧の IPv6)。userinfo・port・path・query が混じった値は表示しない契約 */
const BARE_HOST = /^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$|^\[[0-9A-Fa-f:.]+\]$/;

export function toWebhookStatus(wire: WireWebhookStatus): RegistrationWebhookStatus {
  const configuration = vocabulary("webhook configuration", wire.configuration, WEBHOOK_CONFIGURATIONS);
  const host = wire.destination_host ?? null;
  if (host !== null && !BARE_HOST.test(host)) {
    throw invalid("webhook status", "destination_host is not a bare host");
  }
  return {
    configuration,
    issue: configuration === "MISCONFIGURED" ? (wire.issue ?? null) : null,
    destinationHost: configuration === "NOT_CONFIGURED" ? null : host,
    counts: {
      pending: toInt("counts.pending", wire.counts.pending),
      inFlight: toInt("counts.in_flight", wire.counts.in_flight),
      retrying: toInt("counts.retrying", wire.counts.retrying),
      delivered: toInt("counts.delivered", wire.counts.delivered),
      failed: toInt("counts.failed", wire.counts.failed),
    },
    lastSuccessAt: wire.last_success_at ?? null,
    lastFailureAt: wire.last_failure_at ?? null,
    recentDeliveries: wire.recent_deliveries.map(toWebhookDelivery),
  };
}

export function toWebhookTest(wire: WireWebhookTest): RegistrationWebhookTestResult {
  return {
    delivered: wire.delivered,
    result: wire.result,
    httpStatus: wire.http_status ?? null,
    attemptedAt: wire.attempted_at,
  };
}

export function toViewer(wire: WireMe): Viewer {
  const roles = wire.instance_roles.flatMap((role) => {
    const mapped = INSTANCE_ROLES[role];
    return mapped === undefined ? [] : [mapped];
  });
  return { accountId: wire.account_id, instanceRoles: [...new Set(roles)] };
}

export function createRealRegistrationGateClient(
  transport: RegistrationGateTransport,
  options: { readonly timeoutMs?: number } = {},
): RegistrationGateClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REGISTRATION_GATE_TIMEOUT_MS;

  /** 200 の JSON 本文だけを返す。それ以外は上記の分類で例外にする */
  async function call<T>(
    method: HttpMethod,
    suffix: string,
    body: unknown,
    convert: (wire: never) => T,
    statusErrors: Readonly<Record<number, () => Error>> = {},
    basePath: string = REGISTRATION_GATE_BASE_PATH,
  ): Promise<T> {
    const path = `${basePath}${suffix}`;
    let response: Response;
    try {
      response = await transport.request(method.toUpperCase(), path, body, timeoutMs);
    } catch (cause) {
      throw new EmumetUnavailableError(`Emumet API request failed: ${method.toUpperCase()} ${path}`, { cause });
    }
    if (!response.ok) {
      const mapped = statusErrors[response.status];
      if (mapped !== undefined) {
        await safeText(response);
        throw mapped();
      }
      throw new EmumetApiError(response.status, await safeText(response));
    }
    if (response.status !== 200) {
      throw invalid(`${method.toUpperCase()} ${path}`, `answered HTTP ${response.status}; the contract documents only a 200 JSON body`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      // 本文の読み取り中の切断・タイムアウトは一時障害。成功扱いにはしない
      throw new EmumetUnavailableError(`Emumet API response body could not be read: ${method.toUpperCase()} ${path}`, { cause });
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw invalid(`${method.toUpperCase()} ${path}`, "200 body is not valid JSON");
    }
    const openapiPath = contractPath(basePath, suffix);
    const violations = violationsForResponse({ path: openapiPath, method, status: "200" }, json);
    if (violations.length > 0) {
      throw invalid(`${method.toUpperCase()} ${path}`, `200 body violates the pinned OpenAPI contract: ${describeViolations(violations)}`);
    }
    return convert(json as never);
  }

  const gate = (wire: WireRegistrationGate) => toRegistrationGate(wire);
  const unread = (wire: WireUnreadCount) => toInt("unread_count", wire.unread_count);

  return {
    getRegistrationGate: () => call("get", "", undefined, gate),
    openRegistrationGate: (revision) => call("post", "/open", { revision }, gate),
    closeRegistrationGate: (revision) => call("post", "/close", { revision }, gate),
    enableRegistrationGateOverride: (revision, acknowledgeWarning) =>
      call("post", "/override", { revision, acknowledge_warning: acknowledgeWarning }, gate),
    revokeRegistrationGateOverride: (revision) => call("post", "/override/revoke", { revision }, gate),
    listRegistrationGateNotifications: (query) => call("get", `/notifications${notificationQueryString(query)}`, undefined, toNotificationPage),
    countUnreadRegistrationGateNotifications: () => call("get", "/notifications/unread-count", undefined, unread),
    markRegistrationGateNotificationsRead: (eventIds) =>
      call("post", "/notifications/read", { event_ids: [...eventIds] }, unread),
    markAllRegistrationGateNotificationsRead: () => call("post", "/notifications/read-all", undefined, unread),
    getViewer: () => call("get", "", undefined, (wire: WireMe) => toViewer(wire), {}, ME_PATH),
    listRegistrationProtections: () => call("get", "/protections", undefined, toProtectionList),
    verifyRegistrationProtection: (protection) =>
      call("post", `/protections/${protection === "EMAIL" ? "email" : "bot"}/verify`, {}, toVerification, {
        404: () => new EmumetRegistrationTargetNotFoundError(`unknown protection: ${protection}`),
      }),
    getRegistrationWebhookStatus: () => call("get", "/webhook", undefined, toWebhookStatus),
    sendRegistrationWebhookTest: () =>
      call("post", "/webhook/test", undefined, toWebhookTest, { 409: () => new EmumetWebhookUnavailableError() }),
    retryRegistrationWebhook: (eventId) =>
      call(
        "post",
        "/webhook/retry",
        eventId === undefined ? {} : { event_id: eventId },
        (wire: WireWebhookRetry) => toInt("requeued", wire.requeued),
        { 404: () => new EmumetRegistrationTargetNotFoundError("no failed webhook delivery with that event ID") },
      ),
  };
}

/** クエリ文字列を除いた OpenAPI 上のパス (`/api/v1/admin/registration-gate/...`) */
function contractPath(basePath: string, suffix: string): string {
  const withoutQuery = suffix.split("?")[0] ?? "";
  const path = `${basePath}${withoutQuery}`;
  // 契約はパステンプレートで定義されているので、具体値を {protection} に戻して照合する
  return path.replace(/\/protections\/(email|bot)\/verify$/, "/protections/{protection}/verify");
}

export function notificationQueryString(query: RegistrationGateNotificationQuery | undefined): string {
  const params = new URLSearchParams();
  if (query?.limit !== undefined) params.set("limit", String(query.limit));
  if (query?.before !== undefined) params.set("before", query.before);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
