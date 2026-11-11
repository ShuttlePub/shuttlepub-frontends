// App-owned, PROVISIONAL shapes for timeline / post data.
//
// The pinned OpenAPI schema (openapi/shuttlepub.json) does not define any timeline or
// post endpoint yet, so there is no generated REST type to derive these from. They
// exist only so the screen layout (ui-spec L1-L4) can be built against fixtures in
// mock mode. When ShuttlePub publishes the endpoints, replace these with types from
// generated/shuttlepub-api.ts and contract-check the fixtures (fixtures.test.ts).
//
// Real mode never invents these values: every operation below is reported as
// not_implemented (see real.ts) until the backend contract exists.

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
};

export type Post = {
  id: string;
  author: PostAuthor;
  text: string;
  /** ISO 8601 instant. */
  createdAt: string;
  replyCount: number;
  repostCount: number;
  /** Set when the timeline entry is a repost of someone else's post. */
  repostedBy: PostAuthor | null;
  inReplyToId: string | null;
};

export type CreatePostInput = {
  text: string;
  visibility: PostVisibility;
};
