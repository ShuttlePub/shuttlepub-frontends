// S8 personal domain content contract (ShuttlePub PR #19, pinned in openapi/shuttlepub.json):
// how a Profile's Emumet domain mute/block applies to timeline, post search,
// notifications and the direct view of one post.
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
//  - The direct view is hidden at first (only state, mode, domain, revision). An explicit
//    reveal shows this one note for the current page only and never clears a block
//    (operations stay blocked), a CW/sensitive/deleted/visibility gate (restricted stays
//    content-free) or the hidden target of a revealed quote.

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
export type NoteSearchResponse = Schemas["NoteSearchResponse"];
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

export function searchFor(profileId: string, controls: readonly DomainControlRef[], candidates: readonly ContentCandidate[]): NoteSearchResponse {
  return { profile_id: profileId, items: feedFor(profileId, controls, candidates), page: {} };
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

function hidden(control: DomainControlRef): { state: "hidden"; mode: DomainControlRef["mode"]; domain: string; revision: number } {
  return { state: "hidden", mode: control.mode, domain: control.domain, revision: control.revision };
}

function embedded(profileId: string, controls: readonly DomainControlRef[], quoted: { actor_url: string; note: NoteContent; restriction?: ContentRestriction }): EmbeddedNotePresentation {
  const control = controlFor(profileId, controls, quoted.actor_url);
  if (control !== undefined) return hidden(control);
  if (quoted.restriction !== undefined) return { state: "restricted", reason: quoted.restriction };
  return { state: "visible", note: structuredClone(quoted.note) };
}

/**
 * GET (revealed = false) or POST reveal (revealed = true) of one note. The control that
 * hides it is its author's, or for a quote the target's. Nothing is remembered: a later
 * GET (hide, reload, revisit) is hidden again.
 */
export function directView(profileId: string, controls: readonly DomainControlRef[], note: DirectNote, revealed: boolean): DirectNoteResponse {
  const hiding = controlFor(profileId, controls, note.actor_url)
    ?? (note.item.kind === "quote" ? controlFor(profileId, controls, note.item.quoted.actor_url) : undefined);
  if (hiding !== undefined && !revealed) return { profile_id: profileId, presentation: hidden(hiding) };
  const operations = operationsFor(profileId, controls, note.actor_url);
  if (note.restriction !== undefined) {
    return { profile_id: profileId, presentation: { state: "restricted", reason: note.restriction, operations } };
  }
  const item: DirectItem = note.item.kind === "quote"
    ? { kind: "quote", note: structuredClone(note.item.note), quoted_note: embedded(profileId, controls, note.item.quoted) }
    : { kind: note.item.kind, note: structuredClone(note.item.note) };
  return {
    profile_id: profileId,
    presentation: { state: "visible", item, operations, reaction_counts: structuredClone(note.reaction_counts) },
  };
}
