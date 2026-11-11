// ============================================================
// GraphQL リゾルバ — Query / Mutation / Account フィールド
// データ取得は必ず context.emumet (EmumetClient) 経由とし、
// リゾルバ層から直接 fetch しない。
// エラー写像: 未認証 → UNAUTHENTICATED / EmumetNotFoundError → NOT_FOUND / 他 → INTERNAL_SERVER_ERROR
// ============================================================

import { GraphQLError } from "graphql";
import type {
  Account,
  CreateAccountInput,
  EmumetClient,
  MetadataInput,
  ProfileFields,
} from "./emumet/client.ts";
import { EmumetNotFoundError, EmumetUnsupportedError } from "./emumet/client.ts";
import { requireEmumet, type GraphQLContext } from "./context.ts";
import { registrationGateResolvers } from "./registration-gate-resolvers.ts";
import { classifyCreateAccountError, profileIdentityResolvers } from "./profile-identity-resolvers.ts";

export { requireEmumet };

function toGraphQLError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) return error;
  if (error instanceof EmumetNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: "NOT_FOUND" }, originalError: error });
  }
  if (error instanceof EmumetUnsupportedError) {
    // originalError を付けない: Yoga が INTERNAL_SERVER_ERROR にマスクして区別が消えるため
    return new GraphQLError("This operation is not supported yet", { extensions: { code: "UNSUPPORTED" } });
  }
  return new GraphQLError("Internal server error", {
    extensions: { code: "INTERNAL_SERVER_ERROR" },
    originalError: error instanceof Error ? error : undefined,
  });
}

/** EmumetClient 呼び出しを包み、ドメインエラーを GraphQL エラーコードに写像する */
async function withEmumetErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toGraphQLError(error);
  }
}

export const resolvers = {
  Query: {
    ...registrationGateResolvers.Query,
    ...profileIdentityResolvers.Query,
    accounts: (_parent: unknown, _args: unknown, context: GraphQLContext) =>
      withEmumetErrors(() => requireEmumet(context).listAccounts()),
    account: (_parent: unknown, args: { id: string }, context: GraphQLContext) =>
      withEmumetErrors(() => requireEmumet(context).getAccount(args.id)),
  },
  Account: {
    profile: (parent: Account, _args: unknown, context: GraphQLContext) =>
      withEmumetErrors(() => context.makeLoaders().profile.load(parent.id)),
    metadata: (parent: Account, _args: unknown, context: GraphQLContext) =>
      withEmumetErrors(() => context.makeLoaders().metadata.load(parent.id)),
  },
  Profile: profileIdentityResolvers.Profile,
  Mutation: {
    ...registrationGateResolvers.Mutation,
    ...profileIdentityResolvers.Mutation,
    createAccount: async (_parent: unknown, args: { input: CreateAccountInput }, context: GraphQLContext) => {
      // GraphQL の省略 (undefined) と null は同じ「送らない」。username を送った作成だけ、上流の拒否を username の種別で返す
      const { username, ...rest } = args.input as Omit<CreateAccountInput, "username"> & { username?: string | null };
      const input: CreateAccountInput = username == null ? rest : { ...rest, username };
      try {
        return await requireEmumet(context).createAccount(input);
      } catch (error) {
        throw classifyCreateAccountError(input, error) ?? toGraphQLError(error);
      }
    },
    updateProfile: (
      _parent: unknown,
      args: { accountId: string; input: ProfileFields },
      context: GraphQLContext,
    ) => withEmumetErrors(() => requireEmumet(context).upsertProfile(args.accountId, args.input)),
    createMetadata: (
      _parent: unknown,
      args: { accountId: string; input: MetadataInput },
      context: GraphQLContext,
    ) => withEmumetErrors(() => requireEmumet(context).createMetadata(args.accountId, args.input)),
    updateMetadata: (
      _parent: unknown,
      args: { accountId: string; nanoid: string; input: MetadataInput },
      context: GraphQLContext,
    ) =>
      withEmumetErrors(() => requireEmumet(context).updateMetadata(args.accountId, args.nanoid, args.input)),
    deleteMetadata: async (
      _parent: unknown,
      args: { accountId: string; nanoid: string },
      context: GraphQLContext,
    ) => {
      await withEmumetErrors(() => requireEmumet(context).deleteMetadata(args.accountId, args.nanoid));
      return true;
    },
  },
};
