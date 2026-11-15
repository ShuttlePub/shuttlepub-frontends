// Mock-mode search fixtures (app-owned, PROVISIONAL like post-fixtures.ts): the notes the mock
// search can reach and the authors its lookup knows. The timeline fixtures are reused (same people
// and texts); the extra notes only exist for search (paging, HTML-looking text, emoji, Japanese,
// a content-warned note, several matches in one note, notes of a domain the default mock Profile
// mutes). What a Profile may see is decided by searchFor (content.ts), as for the timeline.

import type { SearchCandidate } from "../rest/content.ts";
import { MOCK_LOCAL_HOST, MOCK_NOTES, NOTE_IDS, PEOPLE, type MockPerson } from "../rest/post-fixtures.ts";
import type { Directory, DirectoryAuthor } from "./author-directory.ts";

const byId = (id: string) => MOCK_NOTES.find((note) => note.id === id);

const FROM_TIMELINE: SearchCandidate[] = MOCK_NOTES
  // A restricted note (deleted / not viewable / CW gate) is never searchable.
  .filter((note) => note.restriction === undefined)
  .map((note): SearchCandidate => {
    const target = note.quotes === undefined ? undefined : byId(note.quotes);
    const parent = note.inReplyToId === undefined ? undefined : byId(note.inReplyToId);
    return {
      note_id: NOTE_IDS[note.id],
      author: note.author.actorUrl,
      kind: target !== undefined ? "quote" : parent !== undefined ? "reply" : "post",
      created_at: note.createdAt,
      content: note.text,
      ...(target === undefined ? {} : { quoted_author: target.author.actorUrl }),
    };
  });

const noteId = (n: number) => `5f0c1a2e-7b3d-4e21-9c55-${n.toString(16).padStart(12, "0")}`;
const at = (day: string, minute: number) =>
  `2026-01-${day}T${String(23 - Math.floor(minute / 60)).padStart(2, "0")}:${String(59 - (minute % 60)).padStart(2, "0")}:00.000Z`;
const at2 = (day: string, time: string) => `2026-01-${day}T${time}:00.000Z`;

const EXTRA: SearchCandidate[] = [
  { note_id: noteId(0x201), author: PEOPLE.nekota.actorUrl, kind: "post", created_at: at2("14", "10:00"),
    content: "<script>alert(\"検索\")</script> <b>太字</b> &amp; &lt;img src=x onerror=alert(1)&gt; 検索" },
  { note_id: noteId(0x202), author: PEOPLE.sora.actorUrl, kind: "post", created_at: at2("14", "09:30"),
    content: "検索テスト 🔍🎉 日本語の検索語、検索 検索 検索" },
  { note_id: noteId(0x203), author: PEOPLE.hina.actorUrl, kind: "post", created_at: at2("14", "09:00"),
    content: "本文にも 検索 が入っています", content_warning: "ネタバレ注意: 検索" },
  { note_id: noteId(0x204), author: PEOPLE.ren.actorUrl, kind: "post", created_at: at2("14", "08:30"),
    content: "Search search SEARCH — case を気にしない検索語" },
  { note_id: noteId(0x205), author: PEOPLE.taro.actorUrl, kind: "reply", created_at: at2("14", "08:00"),
    content: "検索のコツ、ありがとう！" },
  { note_id: noteId(0x206), author: PEOPLE.mika.actorUrl, kind: "quote", created_at: at2("14", "07:30"),
    quoted_author: PEOPLE.nekota.actorUrl, content: "引用しつつ検索の話" },
  { note_id: noteId(0x207), author: PEOPLE.nana.actorUrl, kind: "post", created_at: at2("14", "07:00"),
    content: "ミュート中のドメインの投稿にも 検索 の語が入っています" },
  { note_id: noteId(0x208), author: PEOPLE.ken.actorUrl, kind: "quote", created_at: at2("14", "06:30"),
    quoted_author: PEOPLE.nana.actorUrl, content: "検索の話を引用します" },
  { note_id: noteId(0x209), author: PEOPLE.aoi.actorUrl, kind: "post", created_at: at2("14", "06:00"),
    content: "この投稿はどの検索語にも一致しません" },
  ...Array.from({ length: 40 }, (_, index): SearchCandidate => ({
    note_id: noteId(0x300 + index + 1),
    author: PEOPLE.sora.actorUrl,
    kind: "post",
    created_at: at("13", index),
    content: `ZINE の試し刷り #${index + 1}`,
  })),
  ...Array.from({ length: 12 }, (_, index): SearchCandidate => ({
    note_id: noteId(0x400 + index + 1),
    author: PEOPLE.aoi.actorUrl,
    kind: "post",
    created_at: at("12", index),
    content: `時間切れデモの投稿 #${index + 1}`,
  })),
];

export const SEARCH_CANDIDATES: readonly SearchCandidate[] = [...FROM_TIMELINE, ...EXTRA];

/** The keyword that simulates the server's time limit: every page stops after a few notes with truncated=true. */
export const MOCK_TIMEOUT_KEYWORD = "時間切れ";
export const MOCK_TIMEOUT_PAGE = 5;

const isLocal = (person: MockPerson) => person.handle.endsWith(`@${MOCK_LOCAL_HOST}`);

const authorOf = (person: MockPerson, extra: Partial<DirectoryAuthor> = {}): DirectoryAuthor => ({
  actor_url: person.actorUrl,
  acct: person.handle,
  display_name: person.displayName === "" ? null : person.displayName,
  icon_url: null,
  fetched: true,
  publicly_referable: true,
  local_username: isLocal(person) ? person.handle.split("@")[0]! : null,
  ...extra,
});

const lookupOnly = (id: string, handle: string, displayName: string, path: string): MockPerson => {
  const host = handle.split("@")[1]!;
  return { id, handle, displayName, actorUrl: `https://${host}/${path}`, bio: "" };
};

export const MOCK_AUTHORS: readonly DirectoryAuthor[] = [
  // Icons exist as URLs on purpose: the app must never load them (d09-q06).
  ...Object.values(PEOPLE).map((person) => authorOf(person, {
    icon_url: person.handle.startsWith("mika@") || person.handle.startsWith("kei@")
      ? `https://${person.handle.split("@")[1]}/icons/${person.handle.split("@")[0]}.png`
      : null,
  })),
  authorOf(lookupOnly("author-quiet", `quiet@${MOCK_LOCAL_HOST}`, "", "users/quiet")),
  authorOf(lookupOnly("author-tomo", "tomo@mstdn.example", "ともこ", "users/tomo")),
  authorOf(lookupOnly("author-pat1", "pat@dup.example", "Pat One", "users/pat")),
  authorOf(lookupOnly("author-pat2", "pat@dup.example", "Pat Two", "actors/pat")),
  authorOf(lookupOnly("author-ghost", "ghost@unfetched.example", "Ghost", "users/ghost"), { fetched: false }),
];

/** Verified remote acct mappings: the only basis of resolving a remote acct (Taro and Tomo are suggested but not verified). */
export const MOCK_VERIFIED_ACCTS: readonly { acct: string; actor_url: string }[] = [
  ...Object.values(PEOPLE)
    .filter((person) => !isLocal(person) && person.handle !== PEOPLE.taro.handle)
    .map((person) => ({ acct: person.handle, actor_url: person.actorUrl })),
  { acct: "pat@dup.example", actor_url: "https://dup.example/users/pat" },
  { acct: "pat@dup.example", actor_url: "https://dup.example/actors/pat" },
];

export const MOCK_DIRECTORY: Directory = {
  local_host: MOCK_LOCAL_HOST,
  authors: MOCK_AUTHORS,
  verified_acct_mappings: MOCK_VERIFIED_ACCTS,
};
