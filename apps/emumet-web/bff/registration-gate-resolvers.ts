// ============================================================
// 登録ゲートの GraphQL リゾルバ (管理者向け)
// 認可の正本は Emumet API。ここでは権限を判断せず、上流の 401/403 をそのまま区別して返す (fail closed)。
// エラー写像は登録ゲート専用で、既存リゾルバ (accounts 等) の挙動は変えない。
// 上流の応答本文・内部エラーの詳細はクライアントへ出さない (固定メッセージ + extensions のみ)。
// ============================================================

import { GraphQLError } from "graphql";
import { EmumetApiError } from "./emumet/client.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./emumet/registration-gate.ts";
import { requireEmumet, type GraphQLContext } from "./context.ts";

export type RegistrationGateErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "REVISION_CONFLICT"
  | "PRECONDITION_FAILED"
  | "TEMPORARILY_UNAVAILABLE"
  | "INVALID_UPSTREAM_RESPONSE"
  | "UPSTREAM_ERROR"
  | "INTERNAL_SERVER_ERROR";

function gateError(
  code: RegistrationGateErrorCode,
  message: string,
  original: unknown,
  extensions: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code, ...extensions },
    originalError: original instanceof Error ? original : undefined,
  });
}

function statusError(error: EmumetApiError): GraphQLError {
  const status = error.status;
  switch (status) {
    case 400:
      return gateError("BAD_REQUEST", "Invalid request", error, { upstreamStatus: status });
    case 401:
      return gateError("UNAUTHENTICATED", "Unauthenticated", error, { upstreamStatus: status });
    case 403:
      return gateError("FORBIDDEN", "Forbidden", error, { upstreamStatus: status });
    case 409:
      return gateError("REVISION_CONFLICT", "Registration gate was changed by someone else; reload and retry", error, { upstreamStatus: status });
    case 422:
      return gateError("PRECONDITION_FAILED", "Operation is not applicable to the current registration gate state", error, { upstreamStatus: status });
    default:
      if (status === 408 || status === 429 || status >= 500) {
        return gateError("TEMPORARILY_UNAVAILABLE", "Emumet API is temporarily unavailable", error, { retryable: true, upstreamStatus: status });
      }
      return gateError("UPSTREAM_ERROR", "Unexpected response from Emumet API", error, { upstreamStatus: status });
  }
}

export function toRegistrationGateError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) return error;
  if (error instanceof EmumetApiError) return statusError(error);
  if (error instanceof EmumetUnavailableError) {
    return gateError("TEMPORARILY_UNAVAILABLE", "Emumet API is temporarily unavailable", error, { retryable: true });
  }
  if (error instanceof EmumetInvalidResponseError) {
    return gateError("INVALID_UPSTREAM_RESPONSE", "Emumet API returned a response that violates its contract", error);
  }
  return gateError("INTERNAL_SERVER_ERROR", "Internal server error", error);
}

async function withGateErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toRegistrationGateError(error);
  }
}

export const registrationGateResolvers = {
  Query: {
    registrationGate: (_parent: unknown, _args: unknown, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).getRegistrationGate()),
    registrationGateNotifications: (
      _parent: unknown,
      args: { limit?: number | null; before?: string | null },
      context: GraphQLContext,
    ) =>
      withGateErrors(() =>
        requireEmumet(context).listRegistrationGateNotifications({
          ...(args.limit == null ? {} : { limit: args.limit }),
          ...(args.before == null ? {} : { before: args.before }),
        }),
      ),
    registrationGateUnreadCount: (_parent: unknown, _args: unknown, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).countUnreadRegistrationGateNotifications()),
  },
  Mutation: {
    openRegistrationGate: (_parent: unknown, args: { revision: number }, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).openRegistrationGate(args.revision)),
    closeRegistrationGate: (_parent: unknown, args: { revision: number }, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).closeRegistrationGate(args.revision)),
    enableRegistrationGateOverride: (
      _parent: unknown,
      args: { revision: number; acknowledgeWarning: boolean },
      context: GraphQLContext,
    ) =>
      withGateErrors(() =>
        requireEmumet(context).enableRegistrationGateOverride(args.revision, args.acknowledgeWarning),
      ),
    revokeRegistrationGateOverride: (_parent: unknown, args: { revision: number }, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).revokeRegistrationGateOverride(args.revision)),
    markRegistrationGateNotificationsRead: (
      _parent: unknown,
      args: { eventIds: readonly string[] },
      context: GraphQLContext,
    ) => withGateErrors(() => requireEmumet(context).markRegistrationGateNotificationsRead(args.eventIds)),
    markAllRegistrationGateNotificationsRead: (_parent: unknown, _args: unknown, context: GraphQLContext) =>
      withGateErrors(() => requireEmumet(context).markAllRegistrationGateNotificationsRead()),
  },
};
