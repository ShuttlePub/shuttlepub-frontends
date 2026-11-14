import { GraphQLError } from "graphql";
import { AuthError } from "./auth-error.ts";
import { activeProfileId, policyError, policyResolvers } from "./policy/resolvers.ts";
import { PolicyError, type ProfilePolicySource } from "./policy/source.ts";
import type { ProfileContextSource } from "./profile.ts";
import { ShuttlePubApiError, type ShuttlePubApi, type ShuttlePubApiErrorKind, type ViewerAuth } from "./rest/client.ts";
import type { DomainControlRef } from "./rest/content.ts";
import type { ContentControl, ContentViewer, HiddenContent, Post, PostOperations, PostReactionCounts, PostView, PostVisibility, QuotedPost, TimelineKind, UserPage } from "./rest/posts.ts";
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
  emoji_usage_not_allowed: "EMOJI_USAGE_NOT_ALLOWED",
  conflict: "CONFLICT",
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
    throw error instanceof PolicyError ? policyError(error) : toGraphQLError(error);
  }
}

/**
 * The Profile a content request is for (the Profile context the page shows, checked like the
 * mute/block settings) and its Emumet domain controls, both read only when the content
 * source asks: real mode answers NOT_IMPLEMENTED before touching either.
 */
function contentViewer(context: GraphQLContext, shown: string | null | undefined): ContentViewer {
  let resolved: Promise<string> | undefined;
  const profileId = () => resolved ??= shown == null
    ? Promise.reject(new GraphQLError("No Profile is shown", { extensions: { code: "PROFILE_REQUIRED" } }))
    : activeProfileId(context, shown);
  return {
    profileId,
    async controls(): Promise<DomainControlRef[]> {
      const profile = await profileId();
      return (await context.policy.listDomainControls(profile))
        .map((control) => ({ profile_id: profile, domain: control.domain, mode: control.mode, revision: control.revision }));
    },
    selfDomains: context.selfDomains ?? [],
  };
}

const controlOut = (control: ContentControl | null) =>
  control === null ? null : { mode: control.mode.toUpperCase(), domain: control.domain, revision: control.revision };

const restrictionOut = (restriction: string | null) => restriction === null ? null : restriction.toUpperCase();

function postOut(post: Post): unknown {
  return { ...post, quoted: post.quoted === null ? null : quotedOut(post.quoted) };
}

function quotedOut(quoted: QuotedPost): unknown {
  return { post: quoted.post === null ? null : postOut(quoted.post), restriction: restrictionOut(quoted.restriction) };
}

const operationsOut = (operations: PostOperations | null) => operations === null ? null : {
  reply: controlOut(operations.reply),
  quote: controlOut(operations.quote),
  repost: controlOut(operations.repost),
  like: controlOut(operations.like),
  emojiReaction: controlOut(operations.emojiReaction),
};

const hiddenOut = (hidden: HiddenContent | null) =>
  hidden === null ? null : { cause: hidden.cause.toUpperCase(), control: controlOut(hidden.control) };

const reactionCountsOut = (counts: PostReactionCounts | null) =>
  counts === null ? null : { likes: counts.likes, emoji: counts.emoji.map((chip) => ({ emoji: toEmoji(chip.emoji), count: chip.count })) };

const viewOut = (view: PostView) => ({
  id: view.id,
  post: view.post === null ? null : postOut(view.post),
  hidden: hiddenOut(view.hidden),
  restriction: restrictionOut(view.restriction),
  operations: operationsOut(view.operations),
  reactionCounts: reactionCountsOut(view.reactionCounts),
});

const userPageOut = (page: UserPage) => ({
  author: page.author,
  bio: page.bio,
  control: controlOut(page.control),
  hidden: controlOut(page.hidden),
  posts: page.posts.map(viewOut),
});

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
  origin: view.origin ?? null,
  imageState: view.image_state == null ? null : view.image_state.toUpperCase(),
  usage: view.usage == null ? null : view.usage.toUpperCase(),
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
    revealPost: (_root: unknown, args: { profile?: string | null; id: string }, context: GraphQLContext) =>
      guarded(async () => {
        const view = await context.api.getPostView(args.id, contentViewer(context, args.profile), true);
        return view === null ? null : viewOut(view);
      }),
    revealUserPage: (_root: unknown, args: { profile?: string | null; handle: string }, context: GraphQLContext) =>
      guarded(async () => {
        const page = await context.api.getUserPage(args.handle, contentViewer(context, args.profile), true);
        return page === null ? null : userPageOut(page);
      }),
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
    timeline: (_root: unknown, args: { profile?: string | null; kind: string }, context: GraphQLContext) =>
      guarded(async () => (await context.api.getTimeline(TIMELINE_KINDS[args.kind]!, contentViewer(context, args.profile))).map(postOut)),
    postView: (_root: unknown, args: { profile?: string | null; id: string }, context: GraphQLContext) =>
      guarded(async () => {
        const view = await context.api.getPostView(args.id, contentViewer(context, args.profile), false);
        return view === null ? null : viewOut(view);
      }),
    replies: (_root: unknown, args: { profile?: string | null; postId: string }, context: GraphQLContext) =>
      guarded(async () => (await context.api.getReplies(args.postId, contentViewer(context, args.profile))).map(viewOut)),
    userPage: (_root: unknown, args: { profile?: string | null; handle: string }, context: GraphQLContext) =>
      guarded(async () => {
        const page = await context.api.getUserPage(args.handle, contentViewer(context, args.profile), false);
        return page === null ? null : userPageOut(page);
      }),
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
