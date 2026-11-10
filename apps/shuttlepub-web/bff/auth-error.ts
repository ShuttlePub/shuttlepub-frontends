export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "UPSTREAM_UNAVAILABLE" | "INVALID_UPSTREAM_RESPONSE" | "PROFILE_UNAVAILABLE";

/** Only fixed, non-sensitive messages cross HTTP/GraphQL boundaries. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly status: number) {
    super(code);
  }
}
