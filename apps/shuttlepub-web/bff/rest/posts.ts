// App-owned, PROVISIONAL shapes for timeline / post data.
//
// The pinned OpenAPI schema (openapi/shuttlepub.json) has the S8 personal domain content
// contract (content.ts): which items a Profile sees and how one post is presented
// (hidden / visible / restricted, blocked operations). Its NoteContent is deliberately
// minimal (note_id + content): no author, time or counts. Those display fields, the post
// ids of the routes, threads and user pages have no endpoint yet, so they stay app-owned
// here. In mock mode the S8 projection decides what is shown and these fields are joined
// to the visible notes by note_id; nothing of a hidden note is joined.
//
// Real mode never invents these values: every operation below is reported as
// not_implemented (see real.ts) until the backend contract exists.

import type { ContentRestriction, DomainControlRef } from "./content.ts";

export type TimelineKind = "home" | "local" | "federated";

/**
 * Placeholder visibility choices mirroring Misskey (public / home / followers /
 * specified). ShuttlePub's own visibility model is undecided (ui-spec 投稿フォーム).
 */
export type PostVisibility = "public" | "home" | "followers" | "direct";

export type PostAuthor = {
  id: string;
  /** user@host without the leading "@". */
  handle: string;
  displayName: string;
  /** Canonical actor URL: what an individual mute/block targets (Emumet blocks/mutes). */
  actorUrl: string;
  /** Host of actorUrl: the domain a domain mute/block of this author would name (S8 matches only it). */
  domain: string;
  /** The author is on this server (its domain cannot be muted or blocked). */
  local: boolean;
};

/** S8 EmbeddedNotePresentation of a quote's target: exactly one field is set. */
export type QuotedPost = {
  post: Post | null;
  hidden: ContentControl | null;
  restriction: ContentRestriction | null;
};

export type Post = {
  id: string;
  /**
   * The ShuttlePub Note id (UUID) of this post: the `note_id` of the quick reaction
   * operations (S3) and of S8. Kept apart from `id` because the provisional post ids are
   * not Note ids; a real post endpoint is expected to make them the same value.
   */
  noteId: string;
  author: PostAuthor;
  text: string;
  /** ISO 8601 instant. */
  createdAt: string;
  replyCount: number;
  repostCount: number;
  /** Set when the timeline entry is a repost of someone else's post. */
  repostedBy: PostAuthor | null;
  inReplyToId: string | null;
  /** Set for a quote: its target as S8 presents it. */
  quoted: QuotedPost | null;
};

/** What S8 says about a control on content: mode, exact domain, E8 revision (nothing else). */
export type ContentControl = Pick<DomainControlRef, "mode" | "domain" | "revision">;

/** S8 PostOperationAvailability: null = allowed, else the block that refuses it. */
export type PostOperations = {
  reply: ContentControl | null;
  quote: ContentControl | null;
  repost: ContentControl | null;
  like: ContentControl | null;
  emojiReaction: ContentControl | null;
};

/**
 * One post seen directly (S8 DirectNoteResponse), addressed by its provisional id.
 * Exactly one of post / hidden / restriction is set; operations accompany a visible or
 * restricted post. hidden carries nothing but the control: no text, author or quote.
 */
export type PostView = {
  id: string;
  post: Post | null;
  hidden: ContentControl | null;
  restriction: ContentRestriction | null;
  operations: PostOperations | null;
};

/**
 * A user page (ui-spec 3-6). The person (name, bio) is always shown; their posts are
 * hidden behind `hidden` while their domain is muted/blocked by the Profile, until the
 * page explicitly asks to reveal them (each post through S8's single-note reveal).
 */
export type UserPage = {
  author: PostAuthor;
  bio: string;
  /** The Profile's control on the person's domain (the badge), or null. */
  control: ContentControl | null;
  /** Set while the posts are hidden (never together with posts). */
  hidden: ContentControl | null;
  posts: PostView[];
};

/** The Profile a content request is for, resolved lazily (real mode never asks). */
export type ContentViewer = {
  profileId(): Promise<string>;
  controls(): Promise<DomainControlRef[]>;
  /** This server's own actor domains (PostAuthor.local). */
  selfDomains: readonly string[];
};

export type CreatePostInput = {
  text: string;
  visibility: PostVisibility;
};
