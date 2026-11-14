// S8 personal domain content contract (ShuttlePub PR #19, extended by #23 post search and
// #25 hidden quote cause; pinned in openapi/shuttlepub.json): how a Profile's Emumet
// domain mute/block applies to timeline, post search, notifications and the direct view
// of one post.
//
// ShuttlePub does not implement it yet (every S8 route answers 501). This module is the
// mock's reference projection: pure functions that turn content candidates and the
// Profile's domain controls into S8 response bodies. The producer's own contract fixtures
// (openapi/personal-domain-fixtures, vendored at the pinned commit) are replayed against
// it in content-fixtures.test.ts, and every body it builds validates against the pinned
// schema. Nothing here is used in real mode (see client.ts / real.ts).
//
// Semantics fixed by S8:
//  - Controls belong to one Profile (E8 profile_id) and match only the exact canonical
//    actor-ID host (never a claimed/display domain, never a subdomain).
//  - Timeline / search / notifications omit suppressed items without any trace; a
//    third-party quote or a pure repost is omitted whole when its immediate target is
//    suppressed. Hidden notifications do not count as unread.
//  - The direct view is hidden at first (only state, cause, mode, domain, revision). The
//    cause is `direct` when the note's own author is controlled and `quote` when only the
//    note it directly quotes is (then mode/domain/revision are the quoted source's, #25).
//    A quote whose target is deleted or not viewable is never hidden because of the
//    quote: its target is `restricted` instead (it would disclose the domain of a note
//    the caller cannot see). An explicit reveal shows this one note AND, for a quote, its
//    directly quoted target (visible, or restricted by an independent gate), for the
//    current page only, and never clears a block (operations stay blocked) or a
//    CW/sensitive/deleted/visibility gate (restricted stays content-free).

import type { components } from "./generated/shuttlepub-api.ts";

type Schemas = components["schemas"];
export type DomainControlRef = Schemas["DomainControlRef"];
export type FeedItem = Schemas["FeedItem"];
export type NoteContent = Schemas["NoteContent"];
export type DirectItem = Schemas["DirectItem"];
export type DirectNoteResponse = Schemas["DirectNoteResponse"];
export type NotePresentation = Schemas["NotePresentation"];
export type EmbeddedNotePresentation = Schemas["EmbeddedNotePresentation"];
export type PostOperationAvailability = Schemas["PostOperationAvailability"];
export type DomainOperationPermission = Schemas["DomainOperationPermission"];
export type ContentRestriction = Schemas["ContentRestriction"];
export type ReactionCounts = Schemas["ReactionCounts"];
export type TimelineResponse = Schemas["TimelineResponse"];
export type HiddenCause = Schemas["HiddenCause"];
export type NoteSearchResponse = Schemas["NoteSearchResponse"];
export type NoteSearchItem = Schemas["NoteSearchItem"];
export type SearchedNote = Schemas["SearchedNote"];
export type ContentNotificationsResponse = Schemas["ContentNotificationsResponse"];

/**
 * One piece of content as the producer's surface fixtures describe it: the item, the
 * canonical actor URL of its author and, for a quote or repost, of its immediate target.
 * claimed_domain is what the item says about itself; it never decides a match.
 */
export type ContentCandidate = {
  actor_url: string;
  target_actor_url?: string;
  claimed_domain?: string;
  payload: FeedItem;
  unread?: boolean;
};

/** The host of a verified canonical actor ID (lowercase, as URL parsing yields it). */
export function actorHost(actorUrl: string): string | null {
  try {
    return new URL(actorUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The Profile's control that matches this actor exactly, if any. */
export function controlFor(profileId: string, controls: readonly DomainControlRef[], actorUrl: string | undefined): DomainControlRef | undefined {
  if (actorUrl === undefined) return undefined;
  const host = actorHost(actorUrl);
  if (host === null) return undefined;
  return controls.find((control) => control.profile_id === profileId && control.domain === host);
}

/** Why a feed candidate is omitted: its author's domain, or the target it quotes/reposts. */
export function suppressingControl(profileId: string, controls: readonly DomainControlRef[], candidate: ContentCandidate): DomainControlRef | undefined {
  return controlFor(profileId, controls, candidate.actor_url)
    ?? (candidate.payload.kind === "quote" || candidate.payload.kind === "repost"
      ? controlFor(profileId, controls, candidate.target_actor_url)
      : undefined);
}

export function feedFor(profileId: string, controls: readonly DomainControlRef[], candidates: readonly ContentCandidate[]): FeedItem[] {
  return candidates
    .filter((candidate) => suppressingControl(profileId, controls, candidate) === undefined)
    .map((candidate) => structuredClone(candidate.payload));
}

export function timelineFor(profileId: string, controls: readonly DomainControlRef[], candidates: readonly ContentCandidate[]): TimelineResponse {
  return { profile_id: profileId, items: feedFor(profileId, controls, candidates), page: {} };
}

/**
 * One note the search can reach (the producer's search fixtures call it a note of a
 * known author). Reposts are not searchable and have no candidate shape. `quoted_author`
 * is the canonical actor URL of a quote's directly quoted note.
 */
export type SearchCandidate = {
  note_id: string;
  author: string;
  kind: "post" | "reply" | "quote";
  created_at: string;
  content: string;
  content_warning?: string;
  quoted_author?: string;
};

function searchedNote(candidate: SearchCandidate): SearchedNote {
  // A content-warned note exposes its CW only, never the body (the UI keeps it folded).
  const body: SearchedNote["body"] = candidate.content_warning === undefined
    ? { display: "text", content: candidate.content }
    : { display: "content_warning", content_warning: candidate.content_warning };
  return { note_id: candidate.note_id, author: candidate.author, created_at: candidate.created_at, body };
}

/** Newest first by the instant created_at denotes, then by note_id descending (the contract's order). */
function searchOrder(a: SearchCandidate, b: SearchCandidate): number {
  const delta = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (delta !== 0) return delta;
  return a.note_id < b.note_id ? 1 : a.note_id > b.note_id ? -1 : 0;
}

/**
 * Post search surface (D04, #23): the already matched notes the Profile may view, without
 * the ones its controls suppress and without any trace of them (no count, no placeholder):
 * a note whose author's domain is controlled, and a quote whose directly quoted note's is
 * (the comment goes with it). Matching (author / q), paging, the time limit and the errors
 * belong to the search engine and are not modelled here; the page is one untruncated page.
 */
export function searchFor(profileId: string, controls: readonly DomainControlRef[], candidates: readonly SearchCandidate[]): NoteSearchResponse {
  const items = candidates
    .filter((candidate) => controlFor(profileId, controls, candidate.author) === undefined
      && (candidate.kind !== "quote" || controlFor(profileId, controls, candidate.quoted_author) === undefined))
    .sort(searchOrder)
    .map((candidate): NoteSearchItem => ({ kind: candidate.kind, note: searchedNote(candidate) }));
  return { profile_id: profileId, items, page: { truncated: false } };
}

/** The item's own note id (the wrapper's for a repost). */
export function itemNoteId(item: FeedItem): string {
  return item.kind === "repost" ? item.note_id : item.note.note_id;
}

export function notificationsFor(profileId: string, controls: readonly DomainControlRef[], candidates: readonly ContentCandidate[]): ContentNotificationsResponse {
  const visible = candidates.filter((candidate) => suppressingControl(profileId, controls, candidate) === undefined);
  return {
    profile_id: profileId,
    items: visible.map((candidate) => ({
      notification_id: itemNoteId(candidate.payload),
      item: structuredClone(candidate.payload),
      unread: candidate.unread ?? false,
    })),
    unread_count: visible.filter((candidate) => candidate.unread === true).length,
    page: {},
  };
}

/**
 * One note as the direct view sees it. A quote names its target's author (for the match)
 * and the target's own gate, if any. A pure repost wrapper has no direct view: S8 leaves
 * the boost-wrapper reveal undecided; the original note's URL is the one that is opened.
 */
export type DirectNote = {
  actor_url: string;
  item: DirectSource;
  restriction?: ContentRestriction;
  reaction_counts: ReactionCounts;
};

export type DirectSource =
  | { kind: "post" | "reply"; note: NoteContent }
  | { kind: "quote"; note: NoteContent; quoted: { actor_url: string; note: NoteContent; restriction?: ContentRestriction } };

const OPERATIONS = ["reply", "quote", "repost", "like", "emoji_reaction"] as const;

/** Domain-only permissions: blocked by a block of the note's own author, never by a mute or an embedded target. */
export function operationsFor(profileId: string, controls: readonly DomainControlRef[], actorUrl: string): PostOperationAvailability {
  const control = controlFor(profileId, controls, actorUrl);
  const permission = (): DomainOperationPermission => control?.mode === "block"
    ? { status: "blocked", control: { profile_id: control.profile_id, domain: control.domain, mode: "block", revision: control.revision } }
    : { status: "allowed" };
  return Object.fromEntries(OPERATIONS.map((name) => [name, permission()])) as PostOperationAvailability;
}

function hidden(control: DomainControlRef, cause: HiddenCause): { state: "hidden"; cause: HiddenCause; mode: DomainControlRef["mode"]; domain: string; revision: number } {
  return { state: "hidden", cause, mode: control.mode, domain: control.domain, revision: control.revision };
}

/** The directly quoted target of a revealed quote. It has no hidden variant: the quote was hidden together with it. */
function embedded(quoted: { note: NoteContent; restriction?: ContentRestriction }): EmbeddedNotePresentation {
  if (quoted.restriction !== undefined) return { state: "restricted", reason: quoted.restriction };
  return { state: "visible", note: structuredClone(quoted.note) };
}

/** A deleted or not viewable target is never the cause of a hiding: that would disclose the domain of a note the caller cannot see. */
function seeable(restriction: ContentRestriction | undefined): boolean {
  return restriction !== "deleted" && restriction !== "visibility";
}

/**
 * GET (revealed = false) or POST reveal (revealed = true) of one note. It is hidden by its
 * own author's control (cause `direct`) or, when its author is not controlled and it quotes
 * a viewable note of a controlled domain, by that quoted source's control (cause `quote`).
 * A reveal shows the note and its quoted target together. Nothing is remembered: a later
 * GET (hide, reload, revisit) is hidden again.
 */
export function directView(profileId: string, controls: readonly DomainControlRef[], note: DirectNote, revealed: boolean): DirectNoteResponse {
  const own = controlFor(profileId, controls, note.actor_url);
  const quoted = note.item.kind === "quote" ? note.item.quoted : undefined;
  const viaQuote = own === undefined && quoted !== undefined && seeable(quoted.restriction)
    ? controlFor(profileId, controls, quoted.actor_url)
    : undefined;
  if (!revealed && own !== undefined) return { profile_id: profileId, presentation: hidden(own, "direct") };
  if (!revealed && viaQuote !== undefined) return { profile_id: profileId, presentation: hidden(viaQuote, "quote") };
  const operations = operationsFor(profileId, controls, note.actor_url);
  if (note.restriction !== undefined) {
    return { profile_id: profileId, presentation: { state: "restricted", reason: note.restriction, operations } };
  }
  const item: DirectItem = note.item.kind === "quote"
    ? { kind: "quote", note: structuredClone(note.item.note), quoted_note: embedded(note.item.quoted) }
    : { kind: note.item.kind, note: structuredClone(note.item.note) };
  return {
    profile_id: profileId,
    presentation: { state: "visible", item, operations, reaction_counts: structuredClone(note.reaction_counts) },
  };
}
