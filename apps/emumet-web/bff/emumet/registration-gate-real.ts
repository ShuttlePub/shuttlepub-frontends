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
} from "./registration-gate.ts";

export type WireRegistrationGate = components["schemas"]["RegistrationGateResponse"];
export type WireRegistrationGateNotification = components["schemas"]["RegistrationGateNotificationResponse"];
export type WireRegistrationGateNotificationList = components["schemas"]["RegistrationGateNotificationListResponse"];
export type WireRegistrationObservation = components["schemas"]["RegistrationObservationResponse"];
export type WireUnreadCount = components["schemas"]["UnreadCountResponse"];

export const REGISTRATION_GATE_BASE_PATH = "/api/v1/admin/registration-gate";

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
};

function toProtectionObservation(wire: { configured: boolean; probe: string }): RegistrationProtectionObservation {
  return { configured: wire.configured, probe: vocabulary("probe", wire.probe, PROBES) };
}

export function toObservation(wire: WireRegistrationObservation): RegistrationObservation {
  return { email: toProtectionObservation(wire.email), bot: toProtectionObservation(wire.bot) };
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

export function createRealRegistrationGateClient(
  transport: RegistrationGateTransport,
  options: { readonly timeoutMs?: number } = {},
): RegistrationGateClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REGISTRATION_GATE_TIMEOUT_MS;

  /** 200 の JSON 本文だけを返す。それ以外は上記の分類で例外にする */
  async function call<T>(method: HttpMethod, suffix: string, body: unknown, convert: (wire: never) => T): Promise<T> {
    const path = `${REGISTRATION_GATE_BASE_PATH}${suffix}`;
    let response: Response;
    try {
      response = await transport.request(method.toUpperCase(), path, body, timeoutMs);
    } catch (cause) {
      throw new EmumetUnavailableError(`Emumet API request failed: ${method.toUpperCase()} ${path}`, { cause });
    }
    if (!response.ok) {
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
    const openapiPath = contractPath(suffix);
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
  };
}

/** クエリ文字列を除いた OpenAPI 上のパス (`/api/v1/admin/registration-gate/...`) */
function contractPath(suffix: string): string {
  const withoutQuery = suffix.split("?")[0] ?? "";
  return `${REGISTRATION_GATE_BASE_PATH}${withoutQuery}`;
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
