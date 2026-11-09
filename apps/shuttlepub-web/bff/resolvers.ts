import { GraphQLError } from "graphql";
import type { ProfileContextSource } from "./profile.ts";
import { ShuttlePubApiError, type ShuttlePubApi, type ShuttlePubApiErrorKind } from "./rest/client.ts";

export type GraphQLContext = {
  api: ShuttlePubApi;
  profiles: ProfileContextSource;
};

export const ERROR_CODES: Record<ShuttlePubApiErrorKind, string> = {
  not_implemented: "NOT_IMPLEMENTED",
  upstream_error: "UPSTREAM_ERROR",
  unavailable: "UPSTREAM_UNAVAILABLE",
  invalid_response: "INVALID_UPSTREAM_RESPONSE",
};

/**
 * Adapter errors keep their identity across the GraphQL boundary (extensions.code).
 * originalError is intentionally not attached: Yoga masks errors that wrap a non-GraphQL error.
 */
export function toGraphQLError(error: unknown): unknown {
  if (!(error instanceof ShuttlePubApiError)) return error;
  return new GraphQLError(error.message, {
    extensions: {
      code: ERROR_CODES[error.kind],
      ...(error.status === undefined ? {} : { upstreamStatus: error.status }),
    },
  });
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toGraphQLError(error);
  }
}

export const resolvers = {
  Query: {
    apiMode: (_root: unknown, _args: unknown, context: GraphQLContext) => context.api.mode.toUpperCase(),
    apiStatus: (_root: unknown, _args: unknown, context: GraphQLContext) =>
      guarded(async () => {
        const status = await context.api.getApiStatus();
        return { apiVersion: status.api_version };
      }),
    profileContext: (_root: unknown, _args: unknown, context: GraphQLContext) =>
      guarded(() => context.profiles.getProfileContext()),
  },
};
