// Quick reaction (D03) through the BFF: the S3-contract adapters, the stateful mock
// shared by every session acting as a Profile, and the GraphQL mapping (errors keep
// their codes; real mode never turns 501 into data).

import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { availableProfilesFixture } from "./profile.ts";
import { createGraphqlHandler } from "./server.ts";
import { ShuttlePubApiError } from "./rest/client.ts";
import { NOTE_IDS } from "./rest/post-fixtures.ts";
import { createRealApi } from "./rest/real.ts";

type GraphQLResponse = {
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

async function run(handle: (request: Request) => Promise<Response>, query: string, variables: Record<string, unknown> = {}, cookie?: string) {
  const response = await handle(new Request("http://app.test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://app.test", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ query, variables }),
  }));
  return (await response.json()) as GraphQLResponse;
}

const [p1, p2, p3] = availableProfilesFixture.map((profile) => profile.id) as [string, string, string];
const SORA = NOTE_IDS["post-sora-zine"];
const MIKA = NOTE_IDS["post-mika-picker"];

const SETTINGS = `query($p: ID!) { quickReactionSettings(profileId: $p) { profileId revision favorites { kind value shortcode available unavailableReason } } }`;
const UPDATE = `mutation($p: ID!, $r: Int!, $f: [EmojiInput!]!) {
  updateQuickReactionSettings(profileId: $p, expectedRevision: $r, favorites: $f) { revision favorites { kind value available } } }`;
const REACTIONS = `query($p: ID!, $n: [ID!]!) { postReactions(profileId: $p, noteIds: $n) {
  profileId noteId mine { kind value available } others { emoji { kind value } count reactors { displayName } } } }`;
const SET = `mutation($p: ID!, $n: ID!, $e: EmojiInput!) { setNoteReaction(profileId: $p, noteId: $n, emoji: $e) { noteId emoji { kind value } } }`;
const REMOVE = `mutation($p: ID!, $n: ID!) { removeNoteReaction(profileId: $p, noteId: $n) { noteId emoji { value } } }`;

const unicode = (value: string) => ({ kind: "UNICODE", value });
const custom = (value: string) => ({ kind: "CUSTOM", value });

describe("mock mode: stateful S3 mock", () => {
  let app: App;
  const gql = (query: string, variables: Record<string, unknown> = {}, cookie?: string) => run((request) => app.handleGraphql(request), query, variables, cookie);
  afterEach(() => app?.handleMockReset?.(new Request("http://app.test/__mock/reset", { method: "POST" })));

  test("favourites: 5 with one unavailable, none (never saved), 3 — per Profile", async () => {
    app = createApp(loadConfig({}));
    const first = await gql(SETTINGS, { p: p1 });
    expect(first.errors).toBeUndefined();
    const settings = first.data!.quickReactionSettings as { revision: number; favorites: { value: string; available: boolean; unavailableReason: string | null }[] };
    expect(settings.revision).toBe(3);
    expect(settings.favorites.map((emoji) => emoji.value)).toEqual(["👍", "🎉", "neko_yes", "🙏", "old_blob"]);
    expect(settings.favorites.at(-1)).toMatchObject({ available: false, unavailableReason: "DISABLED" });
    expect((await gql(SETTINGS, { p: p2 })).data).toEqual({ quickReactionSettings: { profileId: p2, revision: 0, favorites: [] } });
    expect(((await gql(SETTINGS, { p: p3 })).data!.quickReactionSettings as { favorites: unknown[] }).favorites).toHaveLength(3);
  });

  test("two sessions acting as the same Profile share favourites and reactions; other Profiles do not see them", async () => {
    app = createApp(loadConfig({}));
    const deviceA = "session=device-a";
    const deviceB = "session=device-b";
    const saved = await gql(UPDATE, { p: p2, r: 0, f: [unicode("👍"), custom("kusa")] }, deviceA);
    expect(saved.errors).toBeUndefined();
    const onB = await gql(SETTINGS, { p: p2 }, deviceB);
    expect(onB.data!.quickReactionSettings).toMatchObject({ revision: 1, favorites: [{ value: "👍" }, { value: "kusa" }] });
    expect(await gql(SET, { p: p2, n: MIKA, e: unicode("🎉") }, deviceA)).toEqual({ data: { setNoteReaction: { noteId: MIKA, emoji: { kind: "UNICODE", value: "🎉" } } } });
    const seenByB = await gql(REACTIONS, { p: p2, n: [MIKA] }, deviceB);
    expect((seenByB.data!.postReactions as { mine: unknown }[])[0]!.mine).toEqual({ kind: "UNICODE", value: "🎉", available: true });
    // Profile 1 sees Profile 2's reaction as somebody else's, never as its own.
    const seenByP1 = (await gql(REACTIONS, { p: p1, n: [MIKA] }, deviceB)).data!.postReactions as { mine: unknown; others: { emoji: { value: string }; count: number; reactors: { displayName: string }[] }[] }[];
    expect(seenByP1[0]!.mine).toBeNull();
    const party = seenByP1[0]!.others.find((group) => group.emoji.value === "🎉")!;
    expect(party.count).toBe(2);
    expect(party.reactors[0]!.displayName).toBe("Fixture Dev");
    expect((await gql(SETTINGS, { p: p1 })).data!.quickReactionSettings).toMatchObject({ revision: 3 });
  });

  test("a stale revision is REVISION_CONFLICT with the current revision; an equal list is an idempotent retry", async () => {
    app = createApp(loadConfig({}));
    const current = [unicode("👍"), unicode("🎉"), custom("neko_yes"), unicode("🙏"), custom("old_blob")];
    const conflict = await gql(UPDATE, { p: p1, r: 2, f: [unicode("👍")] });
    expect(conflict.data).toBeNull();
    expect(conflict.errors![0]!.extensions).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 3, upstreamStatus: 409 });
    const retry = await gql(UPDATE, { p: p1, r: 0, f: current });
    expect(retry.errors).toBeUndefined();
    expect(retry.data!.updateQuickReactionSettings).toMatchObject({ revision: 3 });
    // Reordering keeps the unavailable favourite (allowed); adding one is EMOJI_UNAVAILABLE.
    const reordered = await gql(UPDATE, { p: p1, r: 3, f: [current[4], ...current.slice(0, 4)] });
    expect(reordered.data!.updateQuickReactionSettings).toMatchObject({ revision: 4 });
    const added = await gql(UPDATE, { p: p3, r: 1, f: [unicode("✨"), custom("old_blob")] });
    expect(added.errors![0]!.extensions).toMatchObject({ code: "EMOJI_UNAVAILABLE", upstreamStatus: 422 });
    // More than five or duplicates are rejected by the contract (400), never stored.
    const six = await gql(UPDATE, { p: p2, r: 0, f: ["😀", "😂", "🥹", "😊", "😍", "🤔"].map(unicode) });
    expect(six.errors![0]!.extensions).toMatchObject({ code: "UPSTREAM_ERROR", upstreamStatus: 400 });
    const duplicate = await gql(UPDATE, { p: p2, r: 0, f: [unicode("😀"), unicode("😀")] });
    expect(duplicate.errors![0]!.extensions).toMatchObject({ code: "UPSTREAM_ERROR", upstreamStatus: 400 });
    expect((await gql(SETTINGS, { p: p2 })).data!.quickReactionSettings).toMatchObject({ revision: 0, favorites: [] });
  });

  test("one reaction per Profile and Note; an unavailable emoji is refused but a selected one can always be removed", async () => {
    app = createApp(loadConfig({}));
    const before = (await gql(REACTIONS, { p: p1, n: [SORA, MIKA] })).data!.postReactions as { noteId: string; mine: { value: string } | null }[];
    expect(before.map((entry) => [entry.noteId, entry.mine?.value ?? null])).toEqual([[SORA, "🎉"], [MIKA, null]]);
    const refused = await gql(SET, { p: p1, n: MIKA, e: custom("old_blob") });
    expect(refused.errors![0]!.extensions).toMatchObject({ code: "EMOJI_UNAVAILABLE" });
    expect(((await gql(REACTIONS, { p: p1, n: [MIKA] })).data!.postReactions as { mine: unknown }[])[0]!.mine).toBeNull();
    // The server side mutation that makes a selected emoji unavailable.
    expect((await gql(SET, { p: p1, n: MIKA, e: custom("neko_yes") })).errors).toBeUndefined();
    (app.api as unknown as { quickReaction: { mutateEmoji: (id: string, a: string, r: string) => void } }).quickReaction.mutateEmoji("neko_yes", "unavailable", "deleted");
    const flagged = (await gql(REACTIONS, { p: p1, n: [MIKA] })).data!.postReactions as { mine: { available: boolean } }[];
    expect(flagged[0]!.mine.available).toBe(false);
    expect((await gql(SET, { p: p1, n: MIKA, e: custom("neko_yes") })).errors![0]!.extensions).toMatchObject({ code: "EMOJI_UNAVAILABLE" });
    expect(await gql(REMOVE, { p: p1, n: MIKA })).toEqual({ data: { removeNoteReaction: { noteId: MIKA, emoji: null } } });
    expect(await gql(REMOVE, { p: p1, n: MIKA })).toEqual({ data: { removeNoteReaction: { noteId: MIKA, emoji: null } } });
  });

  test("emoji carry their origin, image state and usage end to end (D09 data; no display here)", async () => {
    app = createApp(loadConfig({}));
    const favorites = ((await gql(`query($p: ID!) { quickReactionSettings(profileId: $p) { favorites { kind value origin imageState usage } } }`, { p: p1 })).data!.quickReactionSettings as { favorites: Record<string, unknown>[] }).favorites;
    // This server's own emoji: no origin, image present, usable anywhere (a disabled one keeps its image).
    expect(favorites.find((emoji) => emoji.value === "neko_yes")).toEqual({ kind: "CUSTOM", value: "neko_yes", origin: null, imageState: "PRESENT", usage: "ANYWHERE" });
    expect(favorites.find((emoji) => emoji.value === "old_blob")).toMatchObject({ origin: null, imageState: "PRESENT", usage: "ANYWHERE" });
    expect(favorites.find((emoji) => emoji.value === "👍")).toMatchObject({ kind: "UNICODE", origin: null });
    const catalogue = (await gql("{ customEmojis { value origin imageState usage } }")).data!.customEmojis as { origin: string | null; usage: string }[];
    expect(catalogue.every((emoji) => emoji.origin === null && emoji.usage === "ANYWHERE")).toBe(true);
  });

  test("other people's reactions exclude the acting Profile's own and list the custom emoji catalogue", async () => {
    app = createApp(loadConfig({}));
    const sora = ((await gql(REACTIONS, { p: p1, n: [SORA] })).data!.postReactions as { others: { emoji: { value: string }; count: number }[] }[])[0]!;
    expect(sora.others.map((group) => [group.emoji.value, group.count])).toEqual([["🎉", 4], ["✨", 2], ["💜", 1]]);
    const emojis = (await gql("{ customEmojis { value available imageUrl } }")).data!.customEmojis as { value: string; available: boolean; imageUrl: string }[];
    expect(emojis.map((emoji) => emoji.value).sort()).toEqual(["kusa", "neko_yes", "ok_sign", "old_blob", "shuttle", "tea_time"]);
    expect(emojis.find((emoji) => emoji.value === "old_blob")!.available).toBe(false);
    expect(emojis.every((emoji) => emoji.imageUrl.startsWith("data:image/svg+xml,"))).toBe(true);
  });

  test("only the viewer's own Profiles can act (PROFILE_UNAVAILABLE)", async () => {
    app = createApp(loadConfig({}));
    for (const [query, variables] of [
      [SETTINGS, { p: "someone-else" }],
      [SET, { p: "someone-else", n: MIKA, e: unicode("👍") }],
      [REACTIONS, { p: "someone-else", n: [MIKA] }],
    ] as const) {
      expect((await gql(query, variables)).errors![0]!.extensions).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
    }
  });

  test("POST /__mock/reset restores the fixtures; only when enabled, never in real mode", async () => {
    expect(createApp(loadConfig({})).handleMockReset).toBeUndefined();
    app = createApp(loadConfig({}), { mockReset: true });
    await gql(UPDATE, { p: p2, r: 0, f: [unicode("👍")] });
    expect(app.handleMockReset!(new Request("http://app.test/__mock/reset")).status).toBe(405);
    expect(app.handleMockReset!(new Request("http://app.test/__mock/reset", { method: "POST" })).status).toBe(204);
    expect((await gql(SETTINGS, { p: p2 })).data!.quickReactionSettings).toMatchObject({ revision: 0 });
    expect(createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://127.0.0.1:1" }), { mockReset: true }).handleMockReset).toBeUndefined();
  });
});

type Recorded = { method: string; path: string; authorization: string | null; body: unknown };

function stubBackend(answer: (request: Request) => Response) {
  const recorded: Recorded[] = [];
  const fetch = async (request: Request) => {
    const text = await request.clone().text();
    recorded.push({
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get("authorization"),
      body: text === "" ? undefined : JSON.parse(text),
    });
    return answer(request);
  };
  return { fetch, recorded };
}

async function failure(promise: Promise<unknown>): Promise<ShuttlePubApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ShuttlePubApiError);
    return error as ShuttlePubApiError;
  }
  throw new Error("expected the call to fail");
}

const auth = { accessToken: "token-of-the-viewer" };
const NOT_IMPLEMENTED = { code: "not_implemented", message: "not implemented yet" };

describe("real adapter: S3 endpoints", () => {
  test("calls exactly the documented paths with the viewer's bearer token", async () => {
    const { fetch, recorded } = stubBackend(() => Response.json(NOT_IMPLEMENTED, { status: 501 }));
    const api = createRealApi({ baseUrl: "http://backend.test", fetch });
    await failure(api.getQuickReactionSettings(auth, p1));
    await failure(api.putQuickReactionSettings(auth, p1, { expected_revision: 3, favorites: [{ type: "unicode", value: "👍" }] }));
    await failure(api.getNoteReaction(auth, p1, SORA));
    await failure(api.putNoteReaction(auth, p1, SORA, { type: "custom", id: "kusa" }));
    await failure(api.deleteNoteReaction(auth, p1, SORA));
    expect(recorded).toEqual([
      { method: "GET", path: `/api/v1/profiles/${p1}/quick-reaction-settings`, authorization: "Bearer token-of-the-viewer", body: undefined },
      { method: "PUT", path: `/api/v1/profiles/${p1}/quick-reaction-settings`, authorization: "Bearer token-of-the-viewer", body: { expected_revision: 3, favorites: [{ type: "unicode", value: "👍" }] } },
      { method: "GET", path: `/api/v1/profiles/${p1}/notes/${SORA}/reaction`, authorization: "Bearer token-of-the-viewer", body: undefined },
      { method: "PUT", path: `/api/v1/profiles/${p1}/notes/${SORA}/reaction`, authorization: "Bearer token-of-the-viewer", body: { emoji: { type: "custom", id: "kusa" } } },
      { method: "DELETE", path: `/api/v1/profiles/${p1}/notes/${SORA}/reaction`, authorization: "Bearer token-of-the-viewer", body: undefined },
    ]);
    // Never the legacy development API (POST /api/notes/{id}/reactions).
    expect(recorded.some((request) => request.path.startsWith("/api/notes"))).toBe(false);
  });

  test("501 is not_implemented for every operation (never success, never mock data)", async () => {
    const { fetch } = stubBackend(() => Response.json(NOT_IMPLEMENTED, { status: 501 }));
    const api = createRealApi({ baseUrl: "http://backend.test", fetch });
    for (const call of [
      () => api.getQuickReactionSettings(auth, p1),
      () => api.putQuickReactionSettings(auth, p1, { expected_revision: 0, favorites: [] }),
      () => api.getNoteReaction(auth, p1, SORA),
      () => api.putNoteReaction(auth, p1, SORA, { type: "unicode", value: "👍" }),
      () => api.deleteNoteReaction(auth, p1, SORA),
    ]) {
      const error = await failure(call());
      expect(error.kind).toBe("not_implemented");
      expect(error.status).toBe(501);
      expect(error.body).toEqual(NOT_IMPLEMENTED as never);
    }
    // No endpoint at all for the provisional parts: refused without a request.
    expect((await failure(api.getReactionSummaries(auth, p1, [SORA]))).kind).toBe("not_implemented");
    expect((await failure(api.getCustomEmojis(auth))).kind).toBe("not_implemented");
  });

  test("409 / 422 / other statuses / contract violations keep their meaning", async () => {
    const answers: Response[] = [
      Response.json({ code: "revision_conflict", message: "stale", current_revision: 7 }, { status: 409 }),
      Response.json({ code: "emoji_unavailable", message: "gone", details: [{ field: "/emoji", message: "emoji is unavailable" }] }, { status: 422 }),
      Response.json({ code: "emoji_usage_not_allowed", message: "external", details: [{ field: "/emoji", message: "no existing reaction chip" }] }, { status: 422 }),
      Response.json({ code: "conflict", message: "remove the current reaction first" }, { status: 409 }),
      Response.json({ code: "forbidden", message: "not yours" }, { status: 403 }),
      Response.json({ revision: "seven", favorites: [] }),
      new Response("<html>", { status: 200 }),
    ];
    const { fetch } = stubBackend(() => answers.shift()!);
    const api = createRealApi({ baseUrl: "http://backend.test", fetch });
    const conflict = await failure(api.putQuickReactionSettings(auth, p1, { expected_revision: 6, favorites: [] }));
    expect([conflict.kind, conflict.currentRevision]).toEqual(["revision_conflict", 7]);
    expect((await failure(api.putNoteReaction(auth, p1, SORA, { type: "custom", id: "gone" }))).kind).toBe("emoji_unavailable");
    expect((await failure(api.putNoteReaction(auth, p1, SORA, { type: "custom", id: "far", origin: "far.example" } as never))).kind).toBe("emoji_usage_not_allowed");
    const reactedConflict = await failure(api.putNoteReaction(auth, p1, SORA, { type: "custom", id: "far", origin: "far.example" } as never));
    expect([reactedConflict.kind, reactedConflict.status]).toEqual(["conflict", 409]);
    const forbidden = await failure(api.getNoteReaction(auth, p1, SORA));
    expect([forbidden.kind, forbidden.status]).toEqual(["upstream_error", 403]);
    expect((await failure(api.getQuickReactionSettings(auth, p1))).kind).toBe("invalid_response");
    expect((await failure(api.getQuickReactionSettings(auth, p1))).kind).toBe("invalid_response");
  });

  test("a contract-conformant 200 is returned as data", async () => {
    const body = { revision: 2, favorites: [{ emoji: { type: "unicode", value: "👍" }, availability: "available" }] };
    const { fetch } = stubBackend(() => Response.json(body));
    expect(await createRealApi({ baseUrl: "http://backend.test", fetch }).getQuickReactionSettings(auth, p1)).toEqual(body as never);
  });

  test("through GraphQL, the backend's 501 is NOT_IMPLEMENTED and an unauthenticated viewer is UNAUTHENTICATED", async () => {
    const { fetch, recorded } = stubBackend(() => Response.json(NOT_IMPLEMENTED, { status: 501 }));
    const api = createRealApi({ baseUrl: "http://backend.test", fetch });
    const profiles = {
      mode: "real" as const,
      getProfileContext: async () => ({ activeProfile: availableProfilesFixture[0]! }),
      availableProfiles: async () => [...availableProfilesFixture],
      selectProfile: async () => ({ activeProfile: availableProfilesFixture[0]! }),
    };
    const handler = createGraphqlHandler({ api, profiles, viewerAuth: async () => auth });
    for (const [query, variables] of [
      [SETTINGS, { p: p1 }],
      [UPDATE, { p: p1, r: 0, f: [unicode("👍")] }],
      [REACTIONS, { p: p1, n: [SORA] }],
      [SET, { p: p1, n: SORA, e: unicode("👍") }],
      [REMOVE, { p: p1, n: SORA }],
    ] as const) {
      const result = await run(handler, query, variables);
      expect(result.data).toBeNull();
      expect(result.errors![0]!.extensions).toMatchObject({ code: "NOT_IMPLEMENTED" });
    }
    expect(recorded.length).toBeGreaterThanOrEqual(4);
    const anonymous = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://127.0.0.1:1" }));
    const refused = await run((request) => anonymous.handleGraphql(request), SETTINGS, { p: p1 });
    expect(refused.errors![0]!.extensions).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("the legacy development reaction API is never used", () => {
  test("no source of the app refers to POST /api/notes/{id}/reactions", async () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    async function scan(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "output", "dist", ".spago", "generated"].includes(entry.name)) continue;
          await scan(path);
        } else if (/\.(ts|purs|js)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          if (/\/api\/notes\//.test(await readFile(path, "utf8"))) offenders.push(path);
        }
      }
    }
    await scan(join(root, "bff"));
    await scan(join(root, "src"));
    expect(offenders).toEqual([]);
  });
});
