// Mock-mode timeline / post fixtures (app-owned, PROVISIONAL, see posts.ts).
//
// The texts and people follow the agreed UI mocks (host intents/shuttlepub/features/
// quick-reaction-ui mocks/index.html, personal-domain-controls-ui mocks/d08-v5.html).
// Timestamps sit just before the visual capture clock (2026-01-15T12:00:00Z) so
// relative times are deterministic in screenshots.
//
// What a Profile sees is decided by the S8 projection (content.ts) in content-mock.ts:
// these records only supply the notes (S8 NoteContent) and the display fields joined to
// the visible ones. The D08 records below (noisy.social, bot-farm.example) are muted /
// blocked by the default mock Profile's seed (policy/fixtures.ts), so its timeline is the
// same as before; another Profile (no controls) sees them.

import type { ContentRestriction } from "./content.ts";

/** The host this mock pretends to be; LOCAL lists only its users and it cannot be muted or blocked. */
export const MOCK_LOCAL_HOST = "shuttlepub.example";

export type MockPerson = {
  id: string;
  handle: string;
  displayName: string;
  actorUrl: string;
  bio: string;
};

const person = (id: string, user: string, host: string, displayName: string, bio: string): MockPerson =>
  ({ id, handle: `${user}@${host}`, displayName, actorUrl: `https://${host}/users/${user}`, bio });

export const PEOPLE = {
  mika: person("author-mika", "mika", "misskey.example", "Mika", "絵文字とリアクションが好き。"),
  sora: person("author-sora", "sora", MOCK_LOCAL_HOST, "sora", "ZINE を作っています。"),
  nekota: person("author-nekota", "nekota", "mstdn.example", "ねこ太", "珈琲と猫。"),
  ren: person("author-ren", "ren", MOCK_LOCAL_HOST, "Ren", "週末は写真散歩。"),
  aoi: person("author-aoi", "aoi", MOCK_LOCAL_HOST, "あおい", "仕事用と趣味用の Profile を使い分けています。"),
  kei: person("author-kei", "kei", MOCK_LOCAL_HOST, "Kei", "ShuttlePub の開発をしています。"),
  taro: person("author-taro", "taro", "mstdn.example", "Taro", "本と文房具。"),
  hina: person("author-hina", "hina", MOCK_LOCAL_HOST, "hina", "イラストを描いています。"),
  // D08 (personal domain controls): muted / blocked by the default mock Profile.
  nana: person("author-nana", "nana", "noisy.social", "Nana", "作業用 BGM とプレイリストの話をします。"),
  deals: person("author-deals", "deals", "bot-farm.example", "Deals Bot", "セール情報を自動でお届けします。"),
  ken: person("author-ken", "ken", "other.example", "Ken", "アニメの感想を書いています。"),
  hiro: person("author-hiro", "hiro", "other.example", "Hiro", "新しいカメラを買いました。"),
} as const;

/** The Note (UUID) behind each provisional post: what S3 and S8 address. */
export const NOTE_IDS = {
  "post-mika-picker": "5f0c1a2e-7b3d-4e21-9c55-000000000001",
  "post-sora-zine": "5f0c1a2e-7b3d-4e21-9c55-000000000002",
  "post-nekota-coffee": "5f0c1a2e-7b3d-4e21-9c55-000000000003",
  "post-aoi-profiles": "5f0c1a2e-7b3d-4e21-9c55-000000000004",
  "post-kei-release": "5f0c1a2e-7b3d-4e21-9c55-000000000005",
  "post-taro-reply": "5f0c1a2e-7b3d-4e21-9c55-000000000006",
  "post-hina-reply": "5f0c1a2e-7b3d-4e21-9c55-000000000007",
  "post-nana-playlist": "5f0c1a2e-7b3d-4e21-9c55-000000000008",
  "post-deals-sale": "5f0c1a2e-7b3d-4e21-9c55-000000000009",
  "post-deals-cw": "5f0c1a2e-7b3d-4e21-9c55-00000000000a",
  "post-ken-quote": "5f0c1a2e-7b3d-4e21-9c55-00000000000b",
  "post-nana-reply": "5f0c1a2e-7b3d-4e21-9c55-00000000000c",
  "post-deals-reply": "5f0c1a2e-7b3d-4e21-9c55-00000000000d",
} as const;

export type MockPostId = keyof typeof NOTE_IDS;

/** Pure repost wrappers (S8 FeedItem repost: their own note id and the reposted note). */
export const REPOST_NOTE_IDS = {
  "repost-ren-nekota": "5f0c1a2e-7b3d-4e21-9c55-000000000101",
  "repost-hiro-deals": "5f0c1a2e-7b3d-4e21-9c55-000000000102",
} as const;

export type MockNote = {
  id: MockPostId;
  author: MockPerson;
  text: string;
  createdAt: string;
  replyCount: number;
  repostCount: number;
  inReplyToId?: MockPostId;
  /** A quote of this post (S8 quote: the whole quote is hidden with its target). */
  quotes?: MockPostId;
  /** An independent gate a reveal never clears (S8 ContentRestriction). */
  restriction?: ContentRestriction;
};

const at = (time: string) => `2026-01-15T${time}:00.000Z`;

export const MOCK_NOTES: readonly MockNote[] = [
  { id: "post-mika-picker", author: PEOPLE.mika, createdAt: at("11:55"), replyCount: 0, repostCount: 1,
    text: "新しいリアクションピッカー、いつもの絵文字がいちばん上に並ぶの便利そう。\n押すだけで反応できるのが良い。" },
  { id: "post-sora-zine", author: PEOPLE.sora, createdAt: at("11:42"), replyCount: 4, repostCount: 3,
    text: "週末に作った ZINE の表紙、ようやく入稿できた！" },
  { id: "post-nekota-coffee", author: PEOPLE.nekota, createdAt: at("11:18"), replyCount: 0, repostCount: 1,
    text: "朝の珈琲がうまい。今日は浅煎り。" },
  { id: "post-aoi-profiles", author: PEOPLE.aoi, createdAt: at("11:00"), replyCount: 0, repostCount: 0,
    text: "仕事用と趣味用で Profile を分けて使えるの、思ってたより快適。" },
  { id: "post-kei-release", author: PEOPLE.kei, createdAt: at("09:00"), replyCount: 0, repostCount: 5,
    text: "リリースノート書き終わった。今回はリアクション周りの改善が中心です。\nフィードバックお待ちしてます！" },
  { id: "post-taro-reply", author: PEOPLE.taro, createdAt: at("11:50"), replyCount: 0, repostCount: 0,
    text: "おめでとう！表紙の色すごく好き", inReplyToId: "post-sora-zine" },
  { id: "post-hina-reply", author: PEOPLE.hina, createdAt: at("11:53"), replyCount: 0, repostCount: 0,
    text: "通販あったら教えてください", inReplyToId: "post-sora-zine" },
  { id: "post-nana-playlist", author: PEOPLE.nana, createdAt: at("11:30"), replyCount: 0, repostCount: 0,
    text: "今日の作業用プレイリスト、全部アップテンポにしてみた" },
  { id: "post-deals-sale", author: PEOPLE.deals, createdAt: at("10:40"), replyCount: 0, repostCount: 1,
    text: "期間限定セール実施中！今すぐチェック" },
  { id: "post-deals-cw", author: PEOPLE.deals, createdAt: at("10:20"), replyCount: 0, repostCount: 0,
    text: "（閲覧注意の本文）", restriction: "cw" },
  { id: "post-ken-quote", author: PEOPLE.ken, createdAt: at("10:55"), replyCount: 0, repostCount: 0,
    text: "これめちゃくちゃ分かる", quotes: "post-nana-playlist" },
  { id: "post-nana-reply", author: PEOPLE.nana, createdAt: at("11:51"), replyCount: 0, repostCount: 0,
    text: "通販あるなら絶対買う", inReplyToId: "post-sora-zine" },
  { id: "post-deals-reply", author: PEOPLE.deals, createdAt: at("11:52"), replyCount: 0, repostCount: 0,
    text: "フォロワー限定クーポン配布中", inReplyToId: "post-sora-zine" },
];

/** A timeline entry: a note itself, or a pure repost of one. */
export type TimelineEntry =
  | { kind: "note"; id: MockPostId }
  | { kind: "repost"; id: keyof typeof REPOST_NOTE_IDS; by: MockPerson; of: MockPostId };

/** Newest first, as the timelines show them (the repost sits at its original's place). */
export const TIMELINE: readonly TimelineEntry[] = [
  { kind: "note", id: "post-mika-picker" },
  { kind: "note", id: "post-sora-zine" },
  { kind: "note", id: "post-nana-playlist" },
  { kind: "repost", id: "repost-ren-nekota", by: PEOPLE.ren, of: "post-nekota-coffee" },
  { kind: "note", id: "post-aoi-profiles" },
  { kind: "note", id: "post-ken-quote" },
  { kind: "repost", id: "repost-hiro-deals", by: PEOPLE.hiro, of: "post-deals-sale" },
  { kind: "note", id: "post-kei-release" },
];

export function mockNote(id: string): MockNote | undefined {
  return MOCK_NOTES.find((note) => note.id === id);
}

/** Every Note id of the mock (S3 knows them all). */
export function allMockNoteIds(): string[] {
  return MOCK_NOTES.map((note) => NOTE_IDS[note.id]);
}

/** Direct replies of a post, oldest first. */
export function mockReplies(postId: string): MockNote[] {
  return MOCK_NOTES.filter((note) => note.inReplyToId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function mockPerson(handle: string): MockPerson | undefined {
  return Object.values(PEOPLE).find((entry) => entry.handle === handle);
}

/** A person's own posts (no replies), newest first. */
export function mockPostsBy(person: MockPerson): MockNote[] {
  return MOCK_NOTES.filter((note) => note.author.id === person.id && note.inReplyToId === undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
