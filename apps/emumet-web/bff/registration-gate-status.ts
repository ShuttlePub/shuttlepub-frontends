// ============================================================
// 管理画面の状態チップ (ui-spec A-2) を GET /registration-gate の応答から導出する。
// 状態の判定はこのファイルの関数だけに置き、画面側は status / minimumMet を表示するだけにする。
//
// decision を優先する (E15d: 適用証明の喪失は override 中でも STOPPED になり、override.active は保持される):
//   STOPPED          → AUTO_STOPPED (設定喪失・適用証明喪失のどちらも手動再開が必要)
//   ADMIN_CLOSED     → NOT_OPENED (revision 0 = 一度も遷移していない初期状態) / ADMIN_STOPPED
//   override.active  → OVERRIDE
//   TEMPORARY_REJECT → TEMPORARILY_SUSPENDED
//   ACCEPTING        → OPEN (片方の保護が応答しない防御低下も OPEN。どの保護かは保護一覧で示す)
//
// 「未開放」と「停止中」を区別する情報は API に無い。Emumet の初期状態 (RegistrationGateState::initial) は
// closed / revision 0 で、開閉・override・観測による遷移は必ず revision を進めるため、revision 0 かつ closed を
// 未開放とみなす (親判断 question-c33d7e52)。
// ============================================================

import type { RegistrationGate, RegistrationObservation, RegistrationProtectionObservation } from "./emumet/registration-gate.ts";

export type RegistrationGateStatus =
  | "NOT_OPENED"
  | "OPEN"
  | "TEMPORARILY_SUSPENDED"
  | "AUTO_STOPPED"
  | "ADMIN_STOPPED"
  | "OVERRIDE";

export function registrationGateStatus(gate: Pick<RegistrationGate, "decision" | "revision" | "override">): RegistrationGateStatus {
  switch (gate.decision) {
    case "STOPPED":
      return "AUTO_STOPPED";
    case "ADMIN_CLOSED":
      return gate.revision === 0 ? "NOT_OPENED" : "ADMIN_STOPPED";
    case "TEMPORARY_REJECT":
      return gate.override.active ? "OVERRIDE" : "TEMPORARILY_SUSPENDED";
    case "ACCEPTING":
      return gate.override.active ? "OVERRIDE" : "OPEN";
  }
}

function effective(observation: RegistrationProtectionObservation): boolean {
  return observation.configured && observation.probe === "HEALTHY";
}

/** 開放・再開の最低条件 (kernel の meets_minimum と同じ: どちらかの保護が設定済みかつ応答あり) */
export function registrationMinimumMet(observation: RegistrationObservation): boolean {
  return effective(observation.email) || effective(observation.bot);
}
