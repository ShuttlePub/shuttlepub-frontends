// ============================================================
// Profile username の GraphQL リゾルバとエラー写像 (profile-identity-web-adaptation)
// 認可の正本は Emumet API。ここでは権限を判断せず、上流の 401/403 をそのまま区別して返す (fail closed)。
//
// extensions.code (UI が別々に扱う。HTTP ステータスの写しではない):
//   USERNAME_INVALID_FORMAT  形式違反 (400)
//   USERNAME_RESERVED        予約語 (400)
//   USERNAME_TAKEN           他の Profile が使用中 (409)
//   USERNAME_ALREADY_SET     この Profile は設定済みで変更できない (409。一回限り)
//   USERNAME_CONFLICT        409 だが TAKEN / ALREADY_SET を判別できない
//   ACCOUNT_RESTRICTED       所有 Account が停止中 (422)
//   UNAUTHENTICATED (401) / FORBIDDEN (403) / NOT_FOUND (404) / BAD_REQUEST (その他の 400)
//   TEMPORARILY_UNAVAILABLE (上流の一時障害。retryable) / INVALID_UPSTREAM_RESPONSE (契約違反の応答)
// 「未設定」は状態 (Profile.username が null / usernameState UNSET) でありエラーではない。
// 分類済みエラーに originalError を付けない (Yoga が INTERNAL_SERVER_ERROR にマスクして区別が消えるため)。
// 上流の本文は公開しない。
// ============================================================

import { GraphQLError } from "graphql";
import {
  EmumetAccountRestrictedError,
  EmumetApiError,
  EmumetNotFoundError,
  EmumetUsernameAlreadySetError,
  EmumetUsernameConflictError,
  EmumetUsernameInvalidError,
  EmumetUsernameTakenError,
  type CreateAccountInput,
  type Profile,
} from "./emumet/client.ts";
import { checkProfileUsername } from "./emumet/profile-username.ts";
import { EmumetInvalidResponseError, EmumetUnavailableError } from "./emumet/registration-gate.ts";
import { requireEmumet, type GraphQLContext } from "./context.ts";

export type ProfileIdentityErrorCode =
  | "USERNAME_INVALID_FORMAT"
  | "USERNAME_RESERVED"
  | "USERNAME_TAKEN"
  | "USERNAME_ALREADY_SET"
  | "USERNAME_CONFLICT"
  | "ACCOUNT_RESTRICTED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "TEMPORARILY_UNAVAILABLE"
  | "INVALID_UPSTREAM_RESPONSE";

function identityError(code: ProfileIdentityErrorCode, message: string, extensions: Record<string, unknown> = {}): GraphQLError {
  return new GraphQLError(message, { extensions: { code, ...extensions } });
}

/** 分類できるものだけ GraphQLError にする。分類外は null (呼び出し側が既存の写像へ回す) */
export function classifyProfileIdentityError(error: unknown): GraphQLError | null {
  if (error instanceof GraphQLError) return error;
  if (error instanceof EmumetUsernameInvalidError) {
    return error.reason === "FORMAT"
      ? identityError("USERNAME_INVALID_FORMAT", "Username must match ^[a-z0-9][a-z0-9._-]{0,63}$")
      : identityError("USERNAME_RESERVED", "Username is reserved");
  }
  if (error instanceof EmumetUsernameTakenError) return identityError("USERNAME_TAKEN", "Username is already taken");
  if (error instanceof EmumetUsernameAlreadySetError) {
    return identityError("USERNAME_ALREADY_SET", "Profile already has a username and it cannot be changed");
  }
  if (error instanceof EmumetUsernameConflictError) {
    return identityError("USERNAME_CONFLICT", "Username is already taken or the profile already has one");
  }
  if (error instanceof EmumetAccountRestrictedError) {
    return identityError("ACCOUNT_RESTRICTED", "The owning account is suspended or banned");
  }
  if (error instanceof EmumetNotFoundError) return identityError("NOT_FOUND", "Not found");
  if (error instanceof EmumetApiError) {
    switch (error.status) {
      case 400:
        return identityError("BAD_REQUEST", "Invalid request", { upstreamStatus: 400 });
      case 401:
        return identityError("UNAUTHENTICATED", "Unauthenticated", { upstreamStatus: 401 });
      case 403:
        return identityError("FORBIDDEN", "Forbidden", { upstreamStatus: 403 });
      default:
        return null;
    }
  }
  if (error instanceof EmumetUnavailableError) {
    return identityError("TEMPORARILY_UNAVAILABLE", "Emumet API is temporarily unavailable", { retryable: true });
  }
  if (error instanceof EmumetInvalidResponseError) {
    console.warn(`profile identity: ${error.message}`);
    return identityError("INVALID_UPSTREAM_RESPONSE", "Emumet API returned a response that violates its contract");
  }
  return null;
}

function internalError(error: unknown): GraphQLError {
  return new GraphQLError("Internal server error", {
    extensions: { code: "INTERNAL_SERVER_ERROR" },
    originalError: error instanceof Error ? error : undefined,
  });
}

/** setProfileUsername 専用: 分類外は INTERNAL_SERVER_ERROR (上流の本文・例外詳細は出さない) */
async function withIdentityErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw classifyProfileIdentityError(error) ?? internalError(error);
  }
}

export const profileIdentityResolvers = {
  Query: {
    /** 規則だけの判定 (Emumet は呼ばない)。重複は書き込み時にしか判明しないため含まない */
    checkProfileUsername: (_parent: unknown, args: { username: string }, context: GraphQLContext) => {
      requireEmumet(context);
      return checkProfileUsername(args.username) ?? "VALID";
    },
  },
  Profile: {
    usernameState: (parent: Profile) => (parent.username === null ? "UNSET" : "SET"),
  },
  Mutation: {
    setProfileUsername: (_parent: unknown, args: { profileId: string; username: string }, context: GraphQLContext) =>
      withIdentityErrors(() => requireEmumet(context).setProfileUsername(args.profileId, args.username)),
  },
};

/**
 * createAccount の username 関連の失敗だけ分類して返す。username を送っていない作成は
 * 既存の写像のまま (呼び出し側が処理する)。
 */
export function classifyCreateAccountError(input: CreateAccountInput, error: unknown): GraphQLError | null {
  if (input.username === undefined) return null;
  return classifyProfileIdentityError(error);
}
