// Types of the D04 post search (ShuttlePub #23 searchPersonalNotes, #27 author lookup), taken
// from the pinned OpenAPI schema. Mock and real adapters speak exactly these.

import type { components } from "../rest/generated/shuttlepub-api.ts";

type Schemas = components["schemas"];
export type NoteSearchResponse = Schemas["NoteSearchResponse"];
export type NoteSearchItem = Schemas["NoteSearchItem"];
export type SearchedNote = Schemas["SearchedNote"];
export type SearchAuthor = Schemas["SearchAuthor"];
export type ResolveAuthorResponse = Schemas["ResolveAuthorResponse"];
export type SuggestAuthorsResponse = Schemas["SuggestAuthorsResponse"];

export type SearchOperation = "searchPersonalNotes" | "resolveNoteSearchAuthor" | "suggestNoteSearchAuthors";

export const SEARCH_OPERATIONS: Record<SearchOperation, { path: string; method: "get"; query: readonly string[] }> = {
  searchPersonalNotes: { path: "/api/v1/profiles/{profile_nanoid}/notes/search", method: "get", query: ["author", "q", "limit", "cursor"] },
  resolveNoteSearchAuthor: { path: "/api/v1/profiles/{profile_nanoid}/search/authors/resolve", method: "get", query: ["acct"] },
  suggestNoteSearchAuthors: { path: "/api/v1/profiles/{profile_nanoid}/search/authors/suggestions", method: "get", query: ["prefix"] },
};

/** Query of searchPersonalNotes. author is a canonical actor URL, never an acct. */
export type NoteSearchQuery = {
  author?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** An individual mute/block of the viewing Profile (Emumet), as the mock's suggestions need it. */
export type ActorControl = { actorUrl: string; mode: "mute" | "block" };

export type RawReply = {
  status: number;
  /** Parsed JSON body; undefined when there was none or it was not JSON. */
  body: unknown;
};

export function errorReply(status: number, code: string, message: string, field?: string): RawReply {
  return {
    status,
    body: { code, message, ...(field === undefined ? {} : { details: [{ field, message }] }) },
  };
}
