// The app's view of the ShuttlePub REST backend: a small typed interface with a
// mock and a real implementation. Types come from the pinned OpenAPI schema
// (generated/shuttlepub-api.ts); nothing here is hand-copied from the backend.

import type { components } from "./generated/shuttlepub-api.ts";
import type { ContentViewer, CreatePostInput, Post, PostView, TimelineKind, UserPage } from "./posts.ts";
import type { EmojiRef, EmojiView, QuickReactionSettings, ReactionState, UpdateQuickReactionSettings } from "./quick-reaction.ts";
import type { ActorControl, NoteSearchQuery, NoteSearchResponse, ResolveAuthorResponse, SuggestAuthorsResponse } from "../search/types.ts";
import type { NoteReactionSummary } from "./reactions.ts";

export type ApiStatus = components["schemas"]["ApiStatus"];
export type ErrorBody = components["schemas"]["ErrorBody"];

export type ApiMode = "mock" | "real";

export type ShuttlePubApiErrorKind =
  /** The backend (or this app, for features that need an unbuilt dependency) says it is not implemented. HTTP 501. */
  | "not_implemented"
  /** The backend answered with an error status other than 501 (and other than the two below). */
  | "upstream_error"
  /** 409 revision_conflict: the settings changed since they were read (currentRevision is set). */
  | "revision_conflict"
  /** 422 emoji_unavailable: the emoji cannot be newly used; nothing was changed. */
  | "emoji_unavailable"
  /** 422 emoji_usage_not_allowed: an external emoji (usage existing_reaction_only) without a chip on the Note, or as a favourite. */
  | "emoji_usage_not_allowed"
  /** 409 conflict on the reaction PUT: an external emoji while another reaction is selected; the current reaction stays. */
  | "conflict"
  /** The backend could not be reached (connection refused, DNS, timeout...). */
  | "unavailable"
  /** The backend answered 2xx with a body that violates the pinned OpenAPI contract. */
  | "invalid_response"
  /** 400 invalid_request of the search operations (details name the field: acct, prefix, author, q, cursor). */
  | "invalid_request"
  /** 404 not_found of the search operations: the author (or acct) is not a fetched, referable author. */
  | "not_found"
  /** 409 conflict of resolveNoteSearchAuthor only: several verified accts match. Not the reaction `conflict`. */
  | "author_ambiguous"
  /** 429 rate_limited. */
  | "rate_limited"
  /** 503 search_timeout: the note search ran out of time without any resumable progress. */
  | "search_timeout"
  /** 503 author_lookup_timeout / author_lookup_unavailable: the internal author lookup, never a missing author. */
  | "author_lookup_unavailable";

/**
 * Every failure of the real adapter is surfaced as this error. Nothing in the app
 * turns it into a success value or into mock data.
 */
export class ShuttlePubApiError extends Error {
  readonly kind: ShuttlePubApiErrorKind;
  /** Upstream HTTP status, when there was a response. */
  readonly status: number | undefined;
  /** Upstream ErrorBody, when the backend sent a contract-shaped one. */
  readonly body: ErrorBody | undefined;
  /** revision_conflict only: the revision the backend has stored. */
  readonly currentRevision: number | undefined;

  constructor(
    kind: ShuttlePubApiErrorKind,
    message: string,
    options: { status?: number; body?: ErrorBody; cause?: unknown; currentRevision?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ShuttlePubApiError";
    this.kind = kind;
    this.status = options.status;
    this.body = options.body;
    this.currentRevision = options.currentRevision;
  }
}

/** Credentials of the signed-in viewer for bearer_auth operations (unused by mock). */
export type ViewerAuth = { accessToken: string | undefined };

export interface ShuttlePubApi {
  /** Fixed for the lifetime of the process. */
  readonly mode: ApiMode;
  /** GET /api/v1/status (operation getApiStatus). Resolves only with a 200 body; rejects with ShuttlePubApiError otherwise. */
  getApiStatus(): Promise<ApiStatus>;
  /**
   * Timeline / post operations use the PROVISIONAL app-owned types in posts.ts. The
   * pinned OpenAPI has S8 (which items and how they are presented) but no endpoint for
   * the display fields (author, time, counts), threads or user pages. Real mode rejects
   * them all with not_implemented without contacting the backend (no invented paths or
   * data); mock mode answers through the S8 projection (content-mock.ts).
   */
  getTimeline(kind: TimelineKind, viewer: ContentViewer): Promise<Post[]>;
  /**
   * One post as the viewer's Profile sees it (S8 direct view: hidden at first, visible
   * after an explicit reveal for this request only). Resolves null when it does not exist.
   */
  getPostView(id: string, viewer: ContentViewer, reveal: boolean): Promise<PostView | null>;
  /** Direct replies, oldest first, each as its S8 direct view (never revealed). */
  getReplies(postId: string, viewer: ContentViewer): Promise<PostView[]>;
  /** A person's page (ui-spec 3-6): their posts stay hidden unless reveal is asked. */
  getUserPage(handle: string, viewer: ContentViewer, reveal: boolean): Promise<UserPage | null>;
  /** Not implemented in either mode until the backend publishes a contract. */
  createPost(input: CreatePostInput): Promise<Post>;

  /**
   * Quick reaction (S3 contract, quick-reaction.ts). `profile` is the acting
   * Profile's profile_nanoid. Each resolves only with a contract-conformant 200 body;
   * 409 / 422 reject as revision_conflict / emoji_unavailable, 501 as not_implemented.
   */
  getQuickReactionSettings(auth: ViewerAuth, profile: string): Promise<QuickReactionSettings>;
  putQuickReactionSettings(auth: ViewerAuth, profile: string, body: UpdateQuickReactionSettings): Promise<QuickReactionSettings>;
  getNoteReaction(auth: ViewerAuth, profile: string, noteId: string): Promise<ReactionState>;
  putNoteReaction(auth: ViewerAuth, profile: string, noteId: string, emoji: EmojiRef): Promise<ReactionState>;
  deleteNoteReaction(auth: ViewerAuth, profile: string, noteId: string): Promise<ReactionState>;
  /**
   * PROVISIONAL (reactions.ts): other people's reactions and the custom emoji
   * catalogue. No endpoint exists; real mode rejects with not_implemented.
   */
  getReactionSummaries(auth: ViewerAuth, profile: string, noteIds: string[]): Promise<NoteReactionSummary[]>;
  getCustomEmojis(auth: ViewerAuth): Promise<EmojiView[]>;

  /**
   * Post search (D04, ShuttlePub #23) and the author lookup behind `from:@acct` (#27). `profile` is the
   * acting Profile's profile_nanoid (already checked against the selection). Each resolves only with a
   * contract-conformant 200 body; every other answer rejects (501 not_implemented, 400/404/409/429/503
   * as their own kinds) and never becomes mock data. `viewer` is read by the mock only (its
   * suppression follows the Profile's controls); real mode never uses it.
   */
  searchNotes(auth: ViewerAuth, profile: string, query: NoteSearchQuery, viewer: SearchViewer): Promise<NoteSearchResponse>;
  resolveSearchAuthor(auth: ViewerAuth, profile: string, acct: string, viewer: SearchViewer): Promise<ResolveAuthorResponse>;
  suggestSearchAuthors(auth: ViewerAuth, profile: string, prefix: string, viewer: SearchViewer): Promise<SuggestAuthorsResponse>;
}

/** What the mock needs of the viewing Profile (its domain controls and individual mutes/blocks). */
export type SearchViewer = ContentViewer & { actorControls(): Promise<ActorControl[]> };

/** Error for an operation whose endpoint is not in the pinned OpenAPI schema. */
export function missingEndpoint(operation: string): ShuttlePubApiError {
  return new ShuttlePubApiError(
    "not_implemented",
    `${operation} has no endpoint in the pinned ShuttlePub OpenAPI schema yet`,
  );
}
