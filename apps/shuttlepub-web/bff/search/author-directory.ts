// Reference projection of the author lookup (ShuttlePub #27, resolveNoteSearchAuthor and
// suggestNoteSearchAuthors) that the mock answers with. ShuttlePub's own routes are contract-only
// (always 501); the producer ships a test-only projection and its expected answers
// (openapi/note-search-author-fixtures, replayed against this module in author-directory.test.ts).
//
// Rules fixed by the contract (server/docs/note-search-author-lookup-contract.md):
//  - target set: authors already fetched AND publicly referable by the viewing Profile;
//  - suggestions never contain an author the Profile mutes/blocks (individually or by domain);
//    resolve does not apply that exclusion (the acct was typed explicitly);
//  - an acct resolves only through this server's confirmed username or a verified remote acct
//    mapping, never through the acct shown for display, never through an external lookup;
//  - a host-less acct is this server's own user, and so is one naming this server's host.

import { domainToASCII } from "node:url";
import { errorReply, type RawReply, type SearchAuthor } from "./types.ts";

export type DirectoryAuthor = SearchAuthor & {
  fetched: boolean;
  publicly_referable: boolean;
  /** The username this server confirmed for itself (a local author). */
  local_username: string | null;
};

export type Directory = {
  local_host: string;
  authors: readonly DirectoryAuthor[];
  /** The only basis of a remote acct: acct (user@host, host normalised) -> actor URL. */
  verified_acct_mappings: readonly { acct: string; actor_url: string }[];
};

export type ViewerControls = {
  muted_domains: readonly string[];
  blocked_domains: readonly string[];
  muted_actors: readonly string[];
  blocked_actors: readonly string[];
};

const MAX_RAW = 513;
const MAX_NORMALISED = 512;
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const URL_SYNTAX = /[\\/?#:<>[\]%]/u;

const length = (text: string) => Array.from(text).length;

export type NormalisedAcct = { username: string; host: string | null };

/**
 * `user@host`, `@user@host`, `user`, `@user`. One leading `@` goes; the username is kept verbatim
 * (no case folding); the host becomes lowercase ASCII (IDNA). Null is a 400 on `acct`.
 */
export function normalizeAcct(raw: string): NormalisedAcct | null {
  if (raw === "" || length(raw) > MAX_RAW) return null;
  if (/\s/u.test(raw) || CONTROL.test(raw) || BIDI.test(raw) || raw.includes("\ufffd") || URL_SYNTAX.test(raw)) return null;
  const text = raw.startsWith("@") ? raw.slice(1) : raw;
  const parts = text.split("@");
  if (parts.length > 2) return null;
  const username = parts[0]!;
  if (username === "") return null;
  let host: string | null = null;
  if (parts.length === 2) {
    host = normalizeHost(parts[1]!);
    if (host === null) return null;
  }
  const normalised = host === null ? username : `${username}@${host}`;
  if (length(normalised) > MAX_NORMALISED) return null;
  return { username, host };
}

function normalizeHost(raw: string): string | null {
  if (raw === "" || raw.endsWith(".")) return null;
  const ascii = domainToASCII(raw);
  if (ascii === "" || ascii.length > 253) return null;
  const labels = ascii.split(".");
  if (labels.some((label) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  // IP addresses, also the numeric shorthand (1.2.3, 0x7f.1), are not DNS names.
  if (/^(0x[0-9a-f]*|[0-9]+)$/i.test(labels[labels.length - 1]!)) return null;
  return ascii;
}

/** Unicode NFKC then lowercase, for comparing only. */
export const foldForMatch = (text: string) => text.normalize("NFKC").toLowerCase();

/** One leading `@` removed, 1..=512 characters, no control characters or U+FFFD. Null is a 400 on `prefix`. */
export function normalizePrefix(raw: string): string | null {
  if (raw === "" || length(raw) > MAX_RAW) return null;
  const text = raw.startsWith("@") ? raw.slice(1) : raw;
  if (text === "" || length(text) > MAX_NORMALISED) return null;
  if (CONTROL.test(text) || text.includes("\ufffd")) return null;
  return text;
}

const toAuthor = (author: DirectoryAuthor, acct = author.acct): SearchAuthor =>
  ({ actor_url: author.actor_url, acct, display_name: author.display_name, icon_url: author.icon_url });

const referable = (author: DirectoryAuthor) => author.fetched && author.publicly_referable;

const hostOf = (actorUrl: string): string => {
  try {
    return new URL(actorUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export function resolveAuthor(directory: Directory, profileId: string, raw: string): RawReply {
  const acct = normalizeAcct(raw);
  if (acct === null) return errorReply(400, "invalid_request", "acct is not a valid account", "acct");
  const notFound = () => errorReply(404, "not_found", "no such author", "acct");
  const found = (author: DirectoryAuthor, confirmed: string): RawReply =>
    ({ status: 200, body: { profile_id: profileId, author: toAuthor(author, confirmed) } });

  if (acct.host === null || acct.host === directory.local_host) {
    const local = directory.authors.find((author) => author.local_username === acct.username && referable(author));
    return local === undefined ? notFound() : found(local, `${acct.username}@${directory.local_host}`);
  }
  const key = `${acct.username}@${acct.host}`;
  const matches = new Map<string, DirectoryAuthor>();
  for (const mapping of directory.verified_acct_mappings) {
    if (mapping.acct !== key) continue;
    const author = directory.authors.find((candidate) => candidate.actor_url === mapping.actor_url && referable(candidate));
    if (author !== undefined) matches.set(author.actor_url, author);
  }
  if (matches.size === 0) return notFound();
  if (matches.size > 1) return errorReply(409, "conflict", "the acct matches several authors", "acct");
  return found([...matches.values()][0]!, key);
}

export function suggestAuthors(directory: Directory, controls: ViewerControls, profileId: string, raw: string): RawReply {
  const prefix = normalizePrefix(raw);
  if (prefix === null) return errorReply(400, "invalid_request", "prefix is not valid", "prefix");
  const needle = foldForMatch(prefix);
  const hidden = (author: DirectoryAuthor) => {
    const host = hostOf(author.actor_url);
    return controls.muted_domains.includes(host) || controls.blocked_domains.includes(host) ||
      controls.muted_actors.includes(author.actor_url) || controls.blocked_actors.includes(author.actor_url);
  };
  const ranked: { rank: number; acct: string; author: DirectoryAuthor }[] = [];
  for (const author of directory.authors) {
    if (!referable(author) || hidden(author)) continue;
    const acct = foldForMatch(author.acct);
    const name = author.display_name === null ? null : foldForMatch(author.display_name);
    const rank = acct === needle ? 1 : acct.startsWith(needle) ? 2 : name !== null && name.startsWith(needle) ? 3 : 0;
    if (rank !== 0) ranked.push({ rank, acct, author });
  }
  ranked.sort((a, b) => a.rank - b.rank
    || (a.acct < b.acct ? -1 : a.acct > b.acct ? 1 : 0)
    || (a.author.actor_url < b.author.actor_url ? -1 : a.author.actor_url > b.author.actor_url ? 1 : 0));
  const seen = new Set<string>();
  const items: SearchAuthor[] = [];
  for (const entry of ranked) {
    if (seen.has(entry.author.actor_url)) continue;
    seen.add(entry.author.actor_url);
    items.push(toAuthor(entry.author));
    if (items.length === 5) break;
  }
  return { status: 200, body: { profile_id: profileId, items } };
}
