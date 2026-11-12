import { GraphQLError } from "graphql";
import { AuthError } from "./auth-error.ts";
import { policyResolvers } from "./policy/resolvers.ts";
import type { ProfilePolicySource } from "./policy/source.ts";
import type { ProfileContextSource } from "./profile.ts";
import { ShuttlePubApiError, type ShuttlePubApi, type ShuttlePubApiErrorKind, type ViewerAuth } from "./rest/client.ts";
import type { PostVisibility, TimelineKind } from "./rest/posts.ts";
import type { EmojiRef, EmojiView } from "./rest/quick-reaction.ts";
import type { ReactionGroup } from "./rest/reactions.ts";

export type GraphQLContext = {
  api: ShuttlePubApi;
  profiles: ProfileContextSource;
  /** Emumet Profile mute/block settings (mock or real, fixed at startup like api). */
  policy: ProfilePolicySource;
  /** This server's own actor domain(s) (EMUMET_PUBLIC_HOST), refused as a muted/blocked domain; null = not configured. */
  selfDomains: readonly string[] | null;
  /** Bearer credentials of the viewer for S3 operations (mock: none; real: the session's token). */
  viewerAuth: () => Promise<ViewerAuth>;
};

export const ERROR_CODES: Record<ShuttlePubApiErrorKind, string> = {
  not_implemented: "NOT_IMPLEMENTED",
  upstream_error: "UPSTREAM_ERROR",
  revision_conflict: "REVISION_CONFLICT",
  emoji_unavailable: "EMOJI_UNAVAILABLE",
  unavailable: "UPSTREAM_UNAVAILABLE",
  invalid_response: "INVALID_UPSTREAM_RESPONSE",
};

/**
 * Adapter errors keep their identity across the GraphQL boundary (extensions.code).
 * originalError is intentionally not attached: Yoga masks errors that wrap a non-GraphQL error.
 */
export function toGraphQLError(error: unknown): unknown {
  if (error instanceof AuthError) {
    return new GraphQLError(error.code, { extensions: { code: error.code, ...(error.reason ? { reason: error.reason } : {}) } });
  }
  if (!(error instanceof ShuttlePubApiError)) return error;
  return new GraphQLError(error.message, {
    extensions: {
      code: ERROR_CODES[error.kind],
      ...(error.status === undefined ? {} : { upstreamStatus: error.status }),
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
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

/** At most this many Notes per postReactions request (one S3 read each). */
export const MAX_REACTION_NOTES = 100;

type EmojiInput = { kind: "UNICODE" | "CUSTOM"; value: string };

export const toEmojiRef = (input: EmojiInput): EmojiRef =>
  input.kind === "UNICODE" ? { type: "unicode", value: input.value } : { type: "custom", id: input.value };

export const toEmoji = (view: EmojiView) => ({
  kind: view.emoji.type === "unicode" ? "UNICODE" : "CUSTOM",
  value: view.emoji.type === "unicode" ? view.emoji.value : view.emoji.id,
  shortcode: view.shortcode ?? null,
  imageUrl: view.image_url ?? null,
  available: view.availability === "available",
  unavailableReason: view.unavailable_reason == null ? null : view.unavailable_reason.toUpperCase(),
});

const toGroup = (group: ReactionGroup) => ({ emoji: toEmoji(group.emoji), count: group.count, reactors: group.reactors });

/**
 * The acting Profile must be one the viewer owns (mock: the fixtures; real: the
 * viewer's Emumet accounts). The backend checks again (403), this only avoids
 * sending another person's Profile id upstream.
 */
async function actingAs(context: GraphQLContext, profileId: string): Promise<ViewerAuth> {
  const auth = await context.viewerAuth();
  const owned = await context.profiles.availableProfiles();
  if (!owned.some((profile) => profile.id === profileId)) throw new AuthError("PROFILE_UNAVAILABLE", 403);
  return auth;
}

export const resolvers = {
  Mutation: {
    ...policyResolvers.Mutation,
    selectProfile: (_root: unknown, args: { id: string }, context: GraphQLContext) =>
      guarded(() => context.profiles.selectProfile(args.id)),
    createPost: (_root: unknown, args: { input: { text: string; visibility: string } }, context: GraphQLContext) =>
      guarded(() => context.api.createPost({ text: args.input.text, visibility: VISIBILITIES[args.input.visibility]! })),
    updateQuickReactionSettings: (
      _root: unknown,
      args: { profileId: string; expectedRevision: number; favorites: EmojiInput[] },
      context: GraphQLContext,
    ) =>
      guarded(async () => {
        const auth = await actingAs(context, args.profileId);
        const settings = await context.api.putQuickReactionSettings(auth, args.profileId, {
          expected_revision: args.expectedRevision,
          favorites: args.favorites.map(toEmojiRef),
        });
        return { profileId: args.profileId, revision: settings.revision, favorites: settings.favorites.map(toEmoji) };
      }),
    setNoteReaction: (_root: unknown, args: { profileId: string; noteId: string; emoji: EmojiInput }, context: GraphQLContext) =>
      guarded(async () => {
        const auth = await actingAs(context, args.profileId);
        const state = await context.api.putNoteReaction(auth, args.profileId, args.noteId, toEmojiRef(args.emoji));
        return { profileId: args.profileId, noteId: state.note_id, emoji: state.emoji === null ? null : toEmoji(state.emoji) };
      }),
    removeNoteReaction: (_root: unknown, args: { profileId: string; noteId: string }, context: GraphQLContext) =>
      guarded(async () => {
        const auth = await actingAs(context, args.profileId);
        const state = await context.api.deleteNoteReaction(auth, args.profileId, args.noteId);
        return { profileId: args.profileId, noteId: state.note_id, emoji: state.emoji === null ? null : toEmoji(state.emoji) };
      }),
  },
  Query: {
    timeline: (_root: unknown, args: { kind: string }, context: GraphQLContext) =>
      guarded(() => context.api.getTimeline(TIMELINE_KINDS[args.kind]!)),
    post: (_root: unknown, args: { id: string }, context: GraphQLContext) =>
      guarded(() => context.api.getPost(args.id)),
    replies: (_root: unknown, args: { postId: string }, context: GraphQLContext) =>
      guarded(() => context.api.getReplies(args.postId)),
    ...policyResolvers.Query,
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
    quickReactionSettings: (_root: unknown, args: { profileId: string }, context: GraphQLContext) =>
      guarded(async () => {
        const auth = await actingAs(context, args.profileId);
        const settings = await context.api.getQuickReactionSettings(auth, args.profileId);
        return { profileId: args.profileId, revision: settings.revision, favorites: settings.favorites.map(toEmoji) };
      }),
    postReactions: (_root: unknown, args: { profileId: string; noteIds: string[] }, context: GraphQLContext) =>
      guarded(async () => {
        if (args.noteIds.length > MAX_REACTION_NOTES) {
          throw new GraphQLError(`postReactions accepts at most ${MAX_REACTION_NOTES} notes`, { extensions: { code: "BAD_USER_INPUT" } });
        }
        const auth = await actingAs(context, args.profileId);
        const [states, summaries] = await Promise.all([
          Promise.all(args.noteIds.map((noteId) => context.api.getNoteReaction(auth, args.profileId, noteId))),
          context.api.getReactionSummaries(auth, args.profileId, args.noteIds),
        ]);
        return args.noteIds.map((noteId, index) => {
          const mine = states[index]!.emoji;
          const summary = summaries.find((entry) => entry.note_id === noteId);
          return {
            profileId: args.profileId,
            noteId,
            mine: mine === null ? null : toEmoji(mine),
            others: (summary?.groups ?? []).map(toGroup),
          };
        });
      }),
    customEmojis: (_root: unknown, _args: unknown, context: GraphQLContext) =>
      guarded(async () => (await context.api.getCustomEmojis(await context.viewerAuth())).map(toEmoji)),
  },
};
