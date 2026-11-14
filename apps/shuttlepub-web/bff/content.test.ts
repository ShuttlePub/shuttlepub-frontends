// D08 / F8 second stage: what the Profile sees of posts in mock mode, through GraphQL.
// The S8 projection itself is replayed against the producer's fixtures in
// rest/content-fixtures.test.ts; these tests pin how the BFF joins it with the app-owned
// display data, follows the Profile's Emumet domain controls (mute/block written through
// the same GraphQL API the screens use) and never sends anything of a hidden post.

import { describe, expect, test } from "bun:test";
import { createApp, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMockProfilePolicy } from "./policy/mock.ts";
import { availableProfilesFixture } from "./profile.ts";
import { mockNote, PEOPLE } from "./rest/post-fixtures.ts";

type GraphQLResponse = {
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

async function run(app: App, query: string): Promise<GraphQLResponse> {
  const response = await app.handleGraphql(new Request("http://app.test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://app.test" },
    body: JSON.stringify({ query }),
  }));
  return (await response.json()) as GraphQLResponse;
}

const fresh = () => createApp(loadConfig({}), { mockPolicy: createMockProfilePolicy() });
const [A, B] = availableProfilesFixture.map((profile) => profile.id);

const timelineIds = async (app: App, profile: string, kind = "HOME") => {
  const result = await run(app, `{ timeline(profile: "${profile}", kind: ${kind}) { id quoted { post { id } } repostedBy { displayName } } }`);
  expect(result.errors).toBeUndefined();
  return (result.data!.timeline as { id: string }[]).map((post) => post.id);
};

const controlOf = async (app: App, profile: string, domain: string) => {
  const list = (await run(app, `{ domainControls(profile: "${profile}") { domain mode revision } }`)).data!.domainControls as { domain: string; revision: number }[];
  return list.find((control) => control.domain === domain);
};

const VIEW = "id post { id text author { handle displayName domain local actorUrl } quoted { post { id text } restriction } } hidden { cause control { mode domain revision } } restriction operations { reply { domain revision } quote { domain } repost { domain } like { domain } emojiReaction { domain } }";

describe("timeline (ui-spec 5-1, S8 surfaces)", () => {
  test("the default mock Profile's mute (noisy.social) and block (bot-farm.example) leave no trace", async () => {
    const app = fresh();
    const result = await run(app, `{ timeline(profile: "${A}", kind: HOME) { id text author { handle } quoted { post { id } } repostedBy { handle } } }`);
    const body = JSON.stringify(result);
    for (const hidden of ["post-nana-playlist", "post-ken-quote", "post-deals-sale", "noisy.social", "bot-farm.example", "Hiro", "これめちゃくちゃ分かる"]) {
      expect(body).not.toContain(hidden);
    }
    expect(await timelineIds(app, A!)).toEqual(["post-mika-picker", "post-sora-zine", "post-nekota-coffee", "post-aoi-profiles", "post-kei-release"]);
  });

  test("another Profile has no controls: the same items, including the whole quote and the repost, are shown", async () => {
    const app = fresh();
    const result = await run(app, `{ timeline(profile: "${B}", kind: HOME) { id quoted { post { id } } repostedBy { displayName } } }`);
    expect(result.data!.timeline).toContainEqual({ id: "post-ken-quote", quoted: { post: { id: "post-nana-playlist" } }, repostedBy: null });
    expect(result.data!.timeline).toContainEqual({ id: "post-deals-sale", quoted: null, repostedBy: { displayName: "Hiro" } });
    expect(await timelineIds(app, B!)).toContain("post-nana-playlist");
  });

  test("muting a domain from the post menu removes its posts, quotes of them and reposts of them; unmuting brings them back", async () => {
    const app = fresh();
    expect(await timelineIds(app, B!)).toContain("post-ken-quote");
    const muted = await run(app, `mutation { setDomainControl(profile: "${B}", domain: "noisy.social", mode: MUTE) { domain revision } }`);
    expect(muted.errors).toBeUndefined();
    const after = await timelineIds(app, B!);
    expect(after).not.toContain("post-nana-playlist");
    // The whole third-party quote goes (the quoter's comment too); the quoter is not muted.
    expect(after).not.toContain("post-ken-quote");
    expect(after).toContain("post-deals-sale");
    await run(app, `mutation { setDomainControl(profile: "${B}", domain: "bot-farm.example", mode: BLOCK) { domain } }`);
    // The pure repost of a blocked post goes as a whole.
    expect(await timelineIds(app, B!)).not.toContain("post-deals-sale");
    const control = await controlOf(app, B!, "noisy.social");
    await run(app, `mutation { removeDomainControl(profile: "${B}", domain: "noisy.social", expectedRevision: ${control!.revision}) { key } }`);
    expect(await timelineIds(app, B!)).toContain("post-ken-quote");
    // Profile A was never touched.
    expect(await timelineIds(app, A!)).toEqual(["post-mika-picker", "post-sora-zine", "post-nekota-coffee", "post-aoi-profiles", "post-kei-release"]);
  });

  test("exact domain only: a control on a parent domain does not hide a subdomain, and vice versa", async () => {
    const app = fresh();
    await run(app, `mutation { setDomainControl(profile: "${B}", domain: "social", mode: MUTE) { domain } }`);
    await run(app, `mutation { setDomainControl(profile: "${B}", domain: "sub.noisy.social", mode: MUTE) { domain } }`);
    expect(await timelineIds(app, B!)).toContain("post-nana-playlist");
  });

  test("authors carry their canonical actor URL, its host as the domain, and whether it is this server", async () => {
    const app = fresh();
    const result = await run(app, `{ timeline(profile: "${A}", kind: HOME) { id author { actorUrl domain local } } }`);
    const posts = result.data!.timeline as { id: string; author: { actorUrl: string; domain: string; local: boolean } }[];
    expect(posts.find((post) => post.id === "post-mika-picker")!.author).toEqual({ actorUrl: "https://misskey.example/users/mika", domain: "misskey.example", local: false });
    expect(posts.find((post) => post.id === "post-sora-zine")!.author).toEqual({ actorUrl: "https://shuttlepub.example/users/sora", domain: "shuttlepub.example", local: true });
  });
});

describe("one post by its URL (ui-spec 3-1 … 3-4, S8 direct view)", () => {
  const SECRETS = (id: string) => {
    const note = mockNote(id)!;
    return [note.text, note.author.displayName, note.author.handle, note.author.actorUrl];
  };

  test("a muted domain's post is hidden first: only cause, mode, domain and revision; nothing of the post is sent", async () => {
    const app = fresh();
    const result = await run(app, `{ postView(profile: "${A}", id: "post-nana-playlist") { ${VIEW} } }`);
    expect(result.errors).toBeUndefined();
    const control = await controlOf(app, A!, "noisy.social");
    expect(result.data!.postView).toEqual({ id: "post-nana-playlist", post: null, hidden: { cause: "DIRECT", control: { mode: "MUTE", domain: "noisy.social", revision: control!.revision } }, restriction: null, operations: null });
    for (const secret of SECRETS("post-nana-playlist")) expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("the explicit reveal shows this post only, for this request: a later read hides it again and the setting is unchanged", async () => {
    const app = fresh();
    const before = await controlOf(app, A!, "noisy.social");
    const revealed = await run(app, `mutation { revealPost(profile: "${A}", id: "post-nana-playlist") { ${VIEW} } }`);
    expect(revealed.data!.revealPost).toMatchObject({ post: { id: "post-nana-playlist", text: mockNote("post-nana-playlist")!.text }, hidden: null });
    // Mute adds no operation restriction.
    expect((revealed.data!.revealPost as { operations: Record<string, unknown> }).operations)
      .toEqual({ reply: null, quote: null, repost: null, like: null, emojiReaction: null });
    const again = await run(app, `{ postView(profile: "${A}", id: "post-nana-playlist") { hidden { control { domain } } post { id } } }`);
    expect(again.data!.postView).toEqual({ hidden: { control: { domain: "noisy.social" } }, post: null });
    // Another post of the same domain is still hidden; the E8 revision did not move.
    const other = await run(app, `{ postView(profile: "${A}", id: "post-nana-reply") { hidden { control { domain } } post { id } } }`);
    expect(other.data!.postView).toEqual({ hidden: { control: { domain: "noisy.social" } }, post: null });
    expect(await controlOf(app, A!, "noisy.social")).toEqual(before);
  });

  test("a revealed blocked post keeps every operation locked (3-3); the block's revision is reported", async () => {
    const app = fresh();
    const control = await controlOf(app, A!, "bot-farm.example");
    const revealed = await run(app, `mutation { revealPost(profile: "${A}", id: "post-deals-sale") { ${VIEW} } }`);
    const view = revealed.data!.revealPost as { post: { id: string }; operations: Record<string, { domain: string } | null> };
    expect(view.post.id).toBe("post-deals-sale");
    expect(Object.values(view.operations)).toEqual(Array(5).fill(expect.objectContaining({ domain: "bot-farm.example" })));
    expect((revealed.data!.revealPost as { operations: { reply: { revision: number } } }).operations.reply.revision).toBe(control!.revision);
  });

  test("a reveal never clears a CW: the post stays restricted and content-free, the block stays", async () => {
    const app = fresh();
    const revealed = await run(app, `mutation { revealPost(profile: "${A}", id: "post-deals-cw") { ${VIEW} } }`);
    expect(revealed.data!.revealPost).toMatchObject({ post: null, hidden: null, restriction: "CW", operations: { reply: { domain: "bot-farm.example" } } });
    for (const secret of SECRETS("post-deals-cw")) expect(JSON.stringify(revealed)).not.toContain(secret);
  });

  test("a third-party quote of a muted post is hidden whole because of the quote (cause QUOTE, the quoted source's domain); one reveal shows the quote with its target and the quoter is actionable", async () => {
    const app = fresh();
    const direct = await run(app, `{ postView(profile: "${A}", id: "post-ken-quote") { ${VIEW} } }`);
    expect(direct.data!.postView).toMatchObject({ post: null, hidden: { cause: "QUOTE", control: { mode: "MUTE", domain: "noisy.social" } } });
    for (const secret of [...SECRETS("post-ken-quote"), ...SECRETS("post-nana-playlist")]) expect(JSON.stringify(direct)).not.toContain(secret);
    const revealed = await run(app, `mutation { revealPost(profile: "${A}", id: "post-ken-quote") { ${VIEW} } }`);
    expect(revealed.data!.revealPost).toMatchObject({
      post: { id: "post-ken-quote", text: "これめちゃくちゃ分かる", quoted: { post: { id: "post-nana-playlist", text: mockNote("post-nana-playlist")!.text }, restriction: null } },
      hidden: null,
      operations: { reply: null, quote: null, repost: null, like: null, emojiReaction: null },
    });
  });

  test("a post that no control matches is simply visible, with nothing locked", async () => {
    const app = fresh();
    const view = await run(app, `{ postView(profile: "${A}", id: "post-mika-picker") { ${VIEW} } }`);
    expect(view.data!.postView).toMatchObject({ post: { id: "post-mika-picker" }, hidden: null, operations: { reply: null } });
  });
});

describe("replies (ui-spec 3-5) and user pages (3-6)", () => {
  test("replies from controlled domains come back hidden one by one, without content", async () => {
    const app = fresh();
    const result = await run(app, `{ replies(profile: "${A}", postId: "post-sora-zine") { ${VIEW} } }`);
    const replies = result.data!.replies as { id: string; post: unknown; hidden: { cause: string; control: { mode: string; domain: string } } | null }[];
    expect(replies.map((reply) => [reply.id, reply.hidden?.cause ?? null, reply.hidden?.control.mode ?? null, reply.hidden?.control.domain ?? null])).toEqual([
      ["post-taro-reply", null, null, null],
      ["post-nana-reply", "DIRECT", "MUTE", "noisy.social"],
      ["post-deals-reply", "DIRECT", "BLOCK", "bot-farm.example"],
      ["post-hina-reply", null, null, null],
    ]);
    for (const id of ["post-nana-reply", "post-deals-reply"]) {
      for (const secret of [mockNote(id)!.text, mockNote(id)!.author.handle]) expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  test("a controlled person's page shows the person and the badge, not their posts, until revealed", async () => {
    const app = fresh();
    const page = await run(app, `{ userPage(profile: "${A}", handle: "${PEOPLE.deals.handle}") { author { displayName handle } bio control { mode domain } hidden { mode domain } posts { id } } }`);
    expect(page.data!.userPage).toEqual({
      author: { displayName: "Deals Bot", handle: "deals@bot-farm.example" },
      bio: PEOPLE.deals.bio,
      control: { mode: "BLOCK", domain: "bot-farm.example" },
      hidden: { mode: "BLOCK", domain: "bot-farm.example" },
      posts: [],
    });
    expect(JSON.stringify(page)).not.toContain(mockNote("post-deals-sale")!.text);
    const revealed = await run(app, `mutation { revealUserPage(profile: "${A}", handle: "${PEOPLE.deals.handle}") { control { mode } hidden { mode } posts { ${VIEW} } } }`);
    const data = revealed.data!.revealUserPage as { hidden: unknown; posts: { id: string; post: { id: string } | null; restriction: string | null; operations: { reply: unknown } }[] };
    expect(data.hidden).toBeNull();
    expect(data.posts.map((post) => [post.id, post.post?.id ?? null, post.restriction])).toEqual([
      ["post-deals-sale", "post-deals-sale", null],
      ["post-deals-cw", null, "CW"],
    ]);
    expect(data.posts.every((post) => post.operations.reply !== null)).toBe(true);
    // Reading the page again hides the posts again.
    const again = await run(app, `{ userPage(profile: "${A}", handle: "${PEOPLE.deals.handle}") { hidden { mode } posts { id } } }`);
    expect(again.data!.userPage).toEqual({ hidden: { mode: "BLOCK" }, posts: [] });
  });

  test("an uncontrolled person's page lists their posts with no badge; an unknown handle is null", async () => {
    const app = fresh();
    const page = await run(app, `{ userPage(profile: "${A}", handle: "${PEOPLE.mika.handle}") { control { mode } hidden { mode } posts { id } } }`);
    expect(page.data!.userPage).toEqual({ control: null, hidden: null, posts: [{ id: "post-mika-picker" }] });
    expect((await run(app, `{ userPage(profile: "${A}", handle: "nobody@nowhere.example") { bio } }`)).data).toEqual({ userPage: null });
  });
});

describe("Profile scope", () => {
  test("a person's block names only that actor's follows (not the rest of its domain)", async () => {
    const app = fresh();
    const result = await run(app, `{ actorBlockImpact(profile: "${A}", actorUrl: "https://example.social/users/alice") { domain following followers } }`);
    expect(result.data!.actorBlockImpact).toEqual({
      domain: "example.social",
      following: ["https://example.social/users/alice"],
      followers: ["https://example.social/users/alice"],
    });
  });
  test("content needs one of the viewer's Profiles", async () => {
    const app = fresh();
    for (const query of [
      '{ timeline(kind: HOME) { id } }',
      '{ timeline(profile: "someone-else", kind: HOME) { id } }',
      '{ postView(profile: "someone-else", id: "post-mika-picker") { id } }',
    ]) {
      const result = await run(app, query);
      expect(result.errors![0]!.extensions!.code).toMatch(/^PROFILE_(REQUIRED|UNAVAILABLE)$/);
      expect(JSON.stringify(result.data)).not.toContain("post-mika-picker\",\"");
    }
  });
});
