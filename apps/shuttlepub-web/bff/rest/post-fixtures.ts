// Mock-mode timeline / post fixtures (app-owned, PROVISIONAL, see posts.ts).
//
// The pinned OpenAPI schema has no timeline/post endpoint, so these are NOT
// contract-checked (CONTRACT_FIXTURES only lists documented responses). The texts and
// people follow the agreed UI mock (host intents/shuttlepub/features/quick-reaction-ui
// mocks/index.html). Timestamps sit just before the visual capture clock
// (2026-01-15T12:00:00Z) so relative times are deterministic in screenshots.

import type { Post, PostAuthor, TimelineKind } from "./posts.ts";

const author = (id: string, handle: string, displayName: string): PostAuthor => ({ id, handle, displayName });

const mika = author("author-mika", "mika@misskey.example", "Mika");
const sora = author("author-sora", "sora@shuttlepub.example", "sora");
const nekota = author("author-nekota", "nekota@mstdn.example", "ねこ太");
const ren = author("author-ren", "ren@shuttlepub.example", "Ren");
const aoi = author("author-aoi", "aoi@shuttlepub.example", "あおい");
const kei = author("author-kei", "kei@shuttlepub.example", "Kei");
const taro = author("author-taro", "taro@mstdn.example", "Taro");
const hina = author("author-hina", "hina@shuttlepub.example", "hina");

/** The host this mock pretends to be; LOCAL lists only its users. */
export const MOCK_LOCAL_HOST = "shuttlepub.example";

const post = (fields: Omit<Post, "repostedBy" | "inReplyToId"> & Partial<Pick<Post, "repostedBy" | "inReplyToId">>): Post => ({
  repostedBy: null,
  inReplyToId: null,
  ...fields,
});

export const timelinePostFixtures: readonly Post[] = [
  post({
    id: "post-mika-picker", author: mika, createdAt: "2026-01-15T11:55:00.000Z", replyCount: 0, repostCount: 1,
    text: "新しいリアクションピッカー、いつもの絵文字がいちばん上に並ぶの便利そう。\n押すだけで反応できるのが良い。",
  }),
  post({
    id: "post-sora-zine", author: sora, createdAt: "2026-01-15T11:42:00.000Z", replyCount: 2, repostCount: 3,
    text: "週末に作った ZINE の表紙、ようやく入稿できた！",
  }),
  post({
    id: "post-nekota-coffee", author: nekota, createdAt: "2026-01-15T11:18:00.000Z", replyCount: 0, repostCount: 1,
    text: "朝の珈琲がうまい。今日は浅煎り。", repostedBy: ren,
  }),
  post({
    id: "post-aoi-profiles", author: aoi, createdAt: "2026-01-15T11:00:00.000Z", replyCount: 0, repostCount: 0,
    text: "仕事用と趣味用で Profile を分けて使えるの、思ってたより快適。",
  }),
  post({
    id: "post-kei-release", author: kei, createdAt: "2026-01-15T09:00:00.000Z", replyCount: 0, repostCount: 5,
    text: "リリースノート書き終わった。今回はリアクション周りの改善が中心です。\nフィードバックお待ちしてます！",
  }),
];

export const replyPostFixtures: readonly Post[] = [
  post({
    id: "post-taro-reply", author: taro, createdAt: "2026-01-15T11:50:00.000Z", replyCount: 0, repostCount: 0,
    text: "おめでとう！表紙の色すごく好き", inReplyToId: "post-sora-zine",
  }),
  post({
    id: "post-hina-reply", author: hina, createdAt: "2026-01-15T11:53:00.000Z", replyCount: 0, repostCount: 0,
    text: "通販あったら教えてください", inReplyToId: "post-sora-zine",
  }),
];

const allPosts = (): readonly Post[] => [...timelinePostFixtures, ...replyPostFixtures];

export function timelineFixture(kind: TimelineKind): Post[] {
  const posts = kind === "local"
    ? timelinePostFixtures.filter((entry) => entry.repostedBy === null && entry.author.handle.endsWith(`@${MOCK_LOCAL_HOST}`))
    : timelinePostFixtures;
  return structuredClone([...posts]);
}

export function postFixture(id: string): Post | null {
  const found = allPosts().find((entry) => entry.id === id);
  return found === undefined ? null : structuredClone(found);
}

export function repliesFixture(postId: string): Post[] {
  return structuredClone(replyPostFixtures.filter((entry) => entry.inReplyToId === postId));
}
