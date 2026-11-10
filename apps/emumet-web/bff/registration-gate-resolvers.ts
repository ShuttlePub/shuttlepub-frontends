// ============================================================
// 登録ゲートの GraphQL リゾルバ (管理者向け)
// 認可の正本は Emumet API。ここでは権限を判断せず、上流の 401/403 をそのまま区別して返す (fail closed)。
// エラー写像は登録ゲート専用で、既存リゾルバ (accounts 等) の挙動は変えない。
// 上流の応答本文・内部エラーの詳細はクライアントへ出さない (固定メッセージ + extensions のみ)。
// 分類済みエラーに originalError を付けないこと (Yoga が INTERNAL_SERVER_ERROR にマスクする)。
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

/**
 * 分類済みの公開エラー。originalError は意図的に付けない: Yoga の既定マスキングは originalError が
 * 通常の Error の GraphQLError を INTERNAL_SERVER_ERROR に置換するため、付けると HTTP 経路で
 * 401/403/409/422/一時障害の区別 (code・retryable) が消える。公開してよい情報は message/extensions のみで、
 * 上流の本文や例外の詳細はここに渡さない。
 */
function gateError(code: RegistrationGateErrorCode, message: string, extensions: Record<string, unknown> = {}): GraphQLError {
  return new GraphQLError(message, { extensions: { code, ...extensions } });
}

function statusError(error: EmumetApiError): GraphQLError {
  const status = error.status;
  switch (status) {
    case 400:
      return gateError("BAD_REQUEST", "Invalid request", { upstreamStatus: status });
    case 401:
      return gateError("UNAUTHENTICATED", "Unauthenticated", { upstreamStatus: status });
    case 403:
      return gateError("FORBIDDEN", "Forbidden", { upstreamStatus: status });
    case 409:
      return gateError("REVISION_CONFLICT", "Registration gate was changed by someone else; reload and retry", { upstreamStatus: status });
    case 422:
      return gateError("PRECONDITION_FAILED", "Operation is not applicable to the current registration gate state", { upstreamStatus: status });
    default:
      if (status === 408 || status === 429 || status >= 500) {
        return gateError("TEMPORARILY_UNAVAILABLE", "Emumet API is temporarily unavailable", { retryable: true, upstreamStatus: status });
      }
      return gateError("UPSTREAM_ERROR", "Unexpected response from Emumet API", { upstreamStatus: status });
  }
}

export function toRegistrationGateError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) return error;
  if (error instanceof EmumetApiError) return statusError(error);
  if (error instanceof EmumetUnavailableError) {
    return gateError("TEMPORARILY_UNAVAILABLE", "Emumet API is temporarily unavailable", { retryable: true });
  }
  if (error instanceof EmumetInvalidResponseError) {
    console.warn(`registration gate: ${error.message}`);
    return gateError("INVALID_UPSTREAM_RESPONSE", "Emumet API returned a response that violates its contract");
  }
  // 想定外の例外は公開しない: originalError を付けたままにして Yoga のマスキングとログに任せる (既存リゾルバと同じ)
  return new GraphQLError("Internal server error", {
    extensions: { code: "INTERNAL_SERVER_ERROR" },
    originalError: error instanceof Error ? error : undefined,
  });
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
