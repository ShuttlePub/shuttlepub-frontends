// ============================================================
// 登録ゲート管理画面のシナリオ (mock 専用)。ui-spec (モック A v5) の各状態に対応する
// 状態・保護・通知・Webhook の組合せ。開発用 mock サーバーと frontend visual の撮影で同じ定義を使う。
// 実 Emumet 接続 (USE_MOCK=false) では使われない。
// ============================================================

import { PROTECTION_LIST_FIXTURES } from "./registration-gate-fixtures.ts";
import type { MockRegistrationGateOptions } from "./registration-gate-mock.ts";

export const REGISTRATION_GATE_SCENARIOS = {
  /** mock の起動直後と同じ (未開放・保護なし・通知なし・Webhook 未設定・管理者)。一般画面の撮影はこれに戻してから行う */
  default: {},
  /** 1. 未開放・条件未達 (メール認証は未確認、BOT 保護は未設定) */
  "not-opened": {
    fixture: "not_ready_unverified",
    notifications: "mixed",
  },
  /** 2. 開放中 */
  open: { fixture: "accepting_protected", notifications: "mixed", webhook: "healthy" },
  /** 3. 開放中・片方の保護が応答なし */
  "open-degraded": { fixture: "accepting_degraded_bot", notifications: "all_unread", webhook: "healthy" },
  /** 4. 一時停止中 (準備済みの保護がすべて応答なし) */
  suspended: { fixture: "temporary_reject", notifications: "all_unread", webhook: "retrying" },
  /** 5. 自動停止 (設定の喪失。メール認証は未設定、BOT 保護は設定エラー) */
  "auto-stopped": {
    fixture: "stopped_config_lost",
    protections: [...PROTECTION_LIST_FIXTURES.email_unset_bot_invalid.protections],
    notifications: "all_unread",
  },
  /** 6. 自動停止・保護は復旧 (手動再開待ち) */
  "auto-stopped-recovered": { fixture: "stopped_awaiting_resume", notifications: "all_read" },
  /** 7. 管理者による停止 */
  "admin-stopped": { fixture: "admin_closed", notifications: "all_read", webhook: "healthy" },
  /** 8. 強制開放中 (準備済みの保護なし) */
  override: { fixture: "override_unprotected", notifications: "mixed", webhook: "failed" },
  /** 9. 強制開放中・保護は準備済み */
  "override-ready": { fixture: "override_protected", notifications: "mixed", webhook: "healthy" },
  /** E15d: 登録の保護の適用証明が失われた停止 (強制開放の値は保持) */
  "enforcement-lost": { fixture: "stopped_enforcement_lost", notifications: "enforcement" },
  /** Webhook: 未設定 */
  "webhook-unset": { fixture: "accepting_protected", webhook: "not_configured" },
  /** Webhook: 設定エラー */
  "webhook-misconfigured": { fixture: "accepting_protected", webhook: "misconfigured" },
  /** 非管理者 (管理画面の導線を出さない。管理 API は 403) */
  member: { fixture: "accepting_protected", role: "non-admin" },
} as const satisfies Record<string, MockRegistrationGateOptions>;

export type RegistrationGateScenarioName = keyof typeof REGISTRATION_GATE_SCENARIOS;

export function isRegistrationGateScenario(name: string): name is RegistrationGateScenarioName {
  return Object.hasOwn(REGISTRATION_GATE_SCENARIOS, name);
}
