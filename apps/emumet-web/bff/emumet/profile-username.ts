// ============================================================
// Profile username の入力規則 (Emumet E8/P1 で確定した契約)
//   形式   ^[a-z0-9][a-z0-9._-]{0,63}$ (ASCII 小文字 1〜64 文字)
//   予約語 下記 17 語 (完全一致)
//   暗黙の trim・小文字化は行わない (大文字・前後空白は形式違反のまま)
// 正本は Emumet (kernel::ProfileUsername)。ここは「どの違反か」を区別するための写し:
// 上流の 400 は本文が自由文で形式/予約語を構造化して返さないため、送信した値をこの規則で
// 分類して別の種別にする。判定結果が VALID なのに上流が 400 を返した場合は、規則のずれ
// (または別原因の不正リクエスト) として一般の BAD_REQUEST に落とす (種別を推測しない)。
// ============================================================

export const PROFILE_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PROFILE_USERNAME_MAX_LENGTH = 64;

export const RESERVED_PROFILE_USERNAMES: readonly string[] = [
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "security",
  "moderator",
  "api",
  "ap",
  "auth",
  "oauth",
  "oauth2",
  "login",
  "logout",
  "register",
  "settings",
  "well-known",
];

/** 入力規則の違反種別。重複・既設定は上流の状態に依存するため、ここには含めない */
export type ProfileUsernameViolation = "FORMAT" | "RESERVED";

/** 違反なら種別、有効なら null。形式を先に判定する (Emumet と同じ順序) */
export function checkProfileUsername(username: string): ProfileUsernameViolation | null {
  if (!PROFILE_USERNAME_PATTERN.test(username)) return "FORMAT";
  if (RESERVED_PROFILE_USERNAMES.includes(username)) return "RESERVED";
  return null;
}
