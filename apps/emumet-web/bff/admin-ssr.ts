// ============================================================
// 管理画面 (/admin/*) の SSR 用の初期状態
//
// 強制開放中の警告帯を SSR・再読込の直後から出すため、管理画面の SSR に限って
// 呼び出し者 (GET /api/v1/me) と登録ゲートの状態を取得し、PureScript の初期 Model に渡す。
// 認可の正本は Emumet API: 管理者でない・権限なし (403) なら isAdmin=false で 404 を描画する。
// 呼び出し者が取れない (未認証・一時障害) ときと状態の取得が 401 のときは null を返し、従来どおりクライアントで取得させる。
// 管理者と分かったうえで状態の取得だけが一時障害のときは、管理者の枠だけ描画し (gate=null)、状態はクライアントで取り直す。
// secret は扱わない (状態チップと警告帯に要る値だけを渡す)。
// ============================================================

import { EmumetApiError } from "./emumet/client.ts";
import type { RegistrationGate, RegistrationGateClient } from "./emumet/registration-gate.ts";
import { registrationGateStatus, registrationMinimumMet, type RegistrationGateStatus } from "./registration-gate-status.ts";

/** PureScript 側 (App.Admin.Types.Gate) と同じ形 */
export type AdminSsrGate = {
  readonly revision: number;
  readonly status: RegistrationGateStatus;
  readonly minimumMet: boolean;
  readonly adminOpen: boolean;
  readonly overrideActive: boolean;
  readonly enforcementVerified: boolean;
};

export type AdminSsrState = {
  readonly username: string;
  readonly isAdmin: boolean;
  /** 管理 API が 403 を返した (管理者のヒントがあっても管理画面は出さない) */
  readonly forbidden: boolean;
  readonly gate: AdminSsrGate | null;
};

export function toAdminSsrGate(gate: RegistrationGate): AdminSsrGate {
  return {
    revision: gate.revision,
    status: registrationGateStatus(gate),
    minimumMet: registrationMinimumMet(gate.observation),
    adminOpen: gate.adminState === "OPEN",
    overrideActive: gate.override.active,
    enforcementVerified: gate.observation.enforcementVerified,
  };
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin/registration" || pathname === "/admin/webhook";
}

export async function loadAdminSsrState(client: RegistrationGateClient, username: string): Promise<AdminSsrState | null> {
  let isAdmin: boolean;
  try {
    isAdmin = (await client.getViewer()).instanceRoles.includes("ADMIN");
  } catch {
    return null;
  }
  if (!isAdmin) return { username, isAdmin: false, forbidden: false, gate: null };
  try {
    return { username, isAdmin: true, forbidden: false, gate: toAdminSsrGate(await client.getRegistrationGate()) };
  } catch (error) {
    if (error instanceof EmumetApiError && error.status === 403) return { username, isAdmin: false, forbidden: true, gate: null };
    if (error instanceof EmumetApiError && error.status === 401) return null;
    // 一時障害・契約違反: 管理者としての枠だけ描画し、状態はクライアントで取り直す
    return { username, isAdmin: true, forbidden: false, gate: null };
  }
}
