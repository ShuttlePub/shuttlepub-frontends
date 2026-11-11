export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "UPSTREAM_UNAVAILABLE" | "INVALID_UPSTREAM_RESPONSE" | "PROFILE_UNAVAILABLE";
/**
 * Why a viewer is unauthenticated, when the BFF knows. SESSION_EXPIRED: the browser
 * sent a session cookie that is no longer usable (expired, unrefreshable, rotated key
 * or rejected by Emumet) and the BFF cleared it. Lets the UI say "log in again"
 * instead of "not logged in"; it never makes a request succeed.
 */
export type AuthErrorReason = "SESSION_EXPIRED";

/** Only fixed, non-sensitive messages cross HTTP/GraphQL boundaries. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly status: number, readonly reason?: AuthErrorReason) {
    super(code);
  }
}
