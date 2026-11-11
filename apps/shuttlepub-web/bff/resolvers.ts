import { GraphQLError } from "graphql";
import { AuthError } from "./auth-error.ts";
import type { ProfileContextSource } from "./profile.ts";
import { ShuttlePubApiError, type ShuttlePubApi, type ShuttlePubApiErrorKind } from "./rest/client.ts";
import type { PostVisibility, TimelineKind } from "./rest/posts.ts";

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
  if (error instanceof AuthError) return new GraphQLError(error.code, { extensions: { code: error.code } });
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

const TIMELINE_KINDS: Record<string, TimelineKind> = { HOME: "home", LOCAL: "local", FEDERATED: "federated" };
const VISIBILITIES: Record<string, PostVisibility> = { PUBLIC: "public", HOME: "home", FOLLOWERS: "followers", DIRECT: "direct" };

export const resolvers = {
  Mutation: {
    selectProfile: (_root: unknown, args: { id: string }, context: GraphQLContext) =>
      guarded(() => context.profiles.selectProfile(args.id)),
    createPost: (_root: unknown, args: { input: { text: string; visibility: string } }, context: GraphQLContext) =>
      guarded(() => context.api.createPost({ text: args.input.text, visibility: VISIBILITIES[args.input.visibility]! })),
  },
  Query: {
    timeline: (_root: unknown, args: { kind: string }, context: GraphQLContext) =>
      guarded(() => context.api.getTimeline(TIMELINE_KINDS[args.kind]!)),
    post: (_root: unknown, args: { id: string }, context: GraphQLContext) =>
      guarded(() => context.api.getPost(args.id)),
    replies: (_root: unknown, args: { postId: string }, context: GraphQLContext) =>
      guarded(() => context.api.getReplies(args.postId)),
    availableProfiles: (_root: unknown, _args: unknown, context: GraphQLContext) =>
      guarded(() => context.profiles.availableProfiles()),
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
