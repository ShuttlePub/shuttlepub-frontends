// The mock's answer to searchPersonalNotes (ShuttlePub #23): matching, paging, the time limit and the
// errors, on top of the S8 suppression projection (content.ts searchFor). Real mode never uses it.
//
// What the contract fixes and this reproduces: author (a canonical actor URL, 404 when not a fetched
// author) and q (literal substring of the body AND the content warning, `%`/`_`/`\` plain) are both
// optional but not both absent (400); newest first; limit 1..50, default 20; an opaque cursor bound
// to Profile, author and q (anything else is 400 on `cursor`); an author whose domain the Profile
// mutes/blocks is an ordinary empty 200 (no trace); a partial 200 with `page.truncated` and a
// resumable cursor when the time limit is hit (simulated by MOCK_TIMEOUT_KEYWORD).
// UNDECIDED by the contract (clients must not rely on it): matching here is case-insensitive and the
// whole q is one substring (no AND of words).

import type { DomainControlRef, NoteSearchResponse, SearchCandidate } from "../rest/content.ts";
import { searchFor } from "../rest/content.ts";
import { foldForMatch, type Directory } from "./author-directory.ts";
import { MOCK_TIMEOUT_KEYWORD, MOCK_TIMEOUT_PAGE } from "./fixtures.ts";
import { errorReply, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, type ActorControl, type NoteSearchQuery, type RawReply } from "./types.ts";

type CursorState = { profile: string; author: string | null; q: string | null; offset: number };

const encodeCursor = (state: CursorState) => Buffer.from(JSON.stringify(state), "utf8").toString("base64url");

function decodeCursor(cursor: string): CursorState | null {
  try {
    const state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorState>;
    if (typeof state.profile !== "string" || typeof state.offset !== "number" || !Number.isInteger(state.offset) || state.offset < 0) return null;
    if (state.author !== null && typeof state.author !== "string") return null;
    if (state.q !== null && typeof state.q !== "string") return null;
    return state as CursorState;
  } catch {
    return null;
  }
}

export type MockSearchInput = {
  profileId: string;
  query: NoteSearchQuery;
  candidates: readonly SearchCandidate[];
  directory: Directory;
  controls: readonly DomainControlRef[];
  actorControls: readonly ActorControl[];
};

export function searchNotes(input: MockSearchInput): RawReply {
  const { profileId, query, candidates, directory, controls, actorControls } = input;
  const q = query.q ?? null;
  const author = query.author ?? null;
  if (q !== null && (Array.from(q).length < 1 || Array.from(q).length > 256)) {
    return errorReply(400, "invalid_request", "q must be 1..256 characters", "q");
  }
  const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    return errorReply(400, "invalid_request", "limit must be 1..50", "limit");
  }
  if (author === null && q === null) {
    return errorReply(400, "invalid_request", "author or q is required", "q");
  }
  let offset = 0;
  if (query.cursor !== undefined) {
    const state = decodeCursor(query.cursor);
    if (state === null || state.profile !== profileId || state.author !== author || state.q !== q) {
      return errorReply(400, "invalid_request", "cursor does not belong to this search", "cursor");
    }
    offset = state.offset;
  }
  if (author !== null && !directory.authors.some((entry) => entry.actor_url === author && entry.fetched)) {
    return errorReply(404, "not_found", "no such author", "author");
  }

  const needle = q === null ? null : foldForMatch(q);
  const individually = new Set(actorControls.map((control) => control.actorUrl));
  const matching = candidates.filter((candidate) =>
    (author === null || candidate.author === author)
    && !individually.has(candidate.author)
    && (candidate.kind !== "quote" || candidate.quoted_author === undefined || !individually.has(candidate.quoted_author))
    && (needle === null
      || foldForMatch(candidate.content_warning ?? "").includes(needle)
      || foldForMatch(candidate.content).includes(needle)));
  const visible = searchFor(profileId, controls, matching);

  const slow = q !== null && q.includes(MOCK_TIMEOUT_KEYWORD);
  const size = slow ? Math.min(limit, MOCK_TIMEOUT_PAGE) : limit;
  const items = visible.items.slice(offset, offset + size);
  const next = offset + items.length;
  const more = next < visible.items.length;
  const cursor = more ? encodeCursor({ profile: profileId, author, q, offset: next }) : undefined;
  const body: NoteSearchResponse = {
    profile_id: profileId,
    items,
    page: slow && cursor !== undefined
      ? { truncated: true, next_cursor: cursor }
      : { truncated: false, ...(cursor === undefined ? {} : { next_cursor: cursor }) },
  };
  return { status: 200, body };
}
