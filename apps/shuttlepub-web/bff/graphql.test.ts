import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { profileContextFixture, availableProfilesFixture } from "./profile.ts";
import { apiStatusFixture, notImplementedFixture } from "./rest/fixtures.ts";

type GraphQLResponse = {
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown>; path?: string[] }[];
};

async function run(app: App, query: string): Promise<GraphQLResponse> {
  const response = await app.handleGraphql(
    new Request("http://app.test/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://app.test" },
      body: JSON.stringify({ query }),
    }),
  );
  return (await response.json()) as GraphQLResponse;
}

const servers: { stop: (closeActiveConnections?: boolean) => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function backend(handler: (request: Request) => Response) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

describe("mock mode", () => {
  const app = createApp(loadConfig({}));

  test("serves contract-checked fixtures without any backend", async () => {
    const result = await run(app, "{ apiMode apiStatus { apiVersion } profileContext { activeProfile { id handle displayName } } }");
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      apiMode: "MOCK",
      apiStatus: { apiVersion: apiStatusFixture.api_version },
      profileContext: { activeProfile: { id: profileContextFixture.activeProfile!.id, handle: profileContextFixture.activeProfile!.handle, displayName: profileContextFixture.activeProfile!.displayName } },
    });
  });

  const PROFILE = profileContextFixture.activeProfile!.id;

  test("serves the provisional timeline fixtures per tab (the mock Profile's controls applied, see content.test.ts)", async () => {
    const home = await run(app, `{ timeline(profile: "${PROFILE}", kind: HOME) { id author { handle } repostedBy { displayName } } }`);
    expect(home.errors).toBeUndefined();
    expect((home.data!.timeline as { id: string }[]).map((post) => post.id))
      .toEqual(["post-mika-picker", "post-sora-zine", "post-nekota-coffee", "post-aoi-profiles", "post-kei-release"]);

    const local = await run(app, `{ timeline(profile: "${PROFILE}", kind: LOCAL) { id author { handle } repostedBy { id } } }`);
    const localPosts = local.data!.timeline as { author: { handle: string }; repostedBy: unknown }[];
    expect(localPosts.length).toBeGreaterThan(0);
    expect(localPosts.length).toBeLessThan((home.data!.timeline as unknown[]).length);
    for (const entry of localPosts) {
      expect(entry.author.handle.endsWith("@shuttlepub.example")).toBe(true);
      expect(entry.repostedBy).toBeNull();
    }
  });

  test("post detail returns the post and its replies, and null for an unknown id", async () => {
    const detail = await run(app, `{ postView(profile: "${PROFILE}", id: "post-sora-zine") { id post { id text } } replies(profile: "${PROFILE}", postId: "post-sora-zine") { id post { inReplyToId } hidden { control { domain } } } }`);
    expect(detail.errors).toBeUndefined();
    expect((detail.data!.postView as { post: { id: string } }).post.id).toBe("post-sora-zine");
    expect((detail.data!.replies as { id: string }[]).map((reply) => reply.id))
      .toEqual(["post-taro-reply", "post-nana-reply", "post-deals-reply", "post-hina-reply"]);

    const missing = await run(app, `{ postView(profile: "${PROFILE}", id: "no-such-post") { id } replies(profile: "${PROFILE}", postId: "no-such-post") { id } }`);
    expect(missing).toEqual({ data: { postView: null, replies: [] } });
  });

  test("posting is not simulated: createPost is NOT_IMPLEMENTED even in mock mode", async () => {
    const result = await run(app, 'mutation { createPost(input: { text: "hi", visibility: PUBLIC }) { id } }');
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions).toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  test("lists every mock Profile and selects one without persisting it", async () => {
    const list = await run(app, "{ availableProfiles { id handle displayName } }");
    expect(list.data!.availableProfiles).toEqual(availableProfilesFixture.map(({ profileId: _, ...visible }) => visible));
    const second = availableProfilesFixture[1]!;
    const selected = await run(app, `mutation { selectProfile(id: "${second.id}") { activeProfile { id } } }`);
    expect(selected.data).toEqual({ selectProfile: { activeProfile: { id: second.id } } });
    const after = await run(app, "{ profileContext { activeProfile { id } } }");
    expect(after.data).toEqual({ profileContext: { activeProfile: { id: profileContextFixture.activeProfile!.id } } });
    const unknown = await run(app, 'mutation { selectProfile(id: "someone-else") { activeProfile { id } } }');
    expect(unknown.errors![0]!.extensions).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
  });

  test("mute/block settings act as the Profile the page shows (any mock Profile) and stay separate per Profile", async () => {
    const [first, second] = availableProfilesFixture;
    // The page switched to the second Profile (stateless mock selection): its own, empty settings.
    await run(app, `mutation { selectProfile(id: "${second!.id}") { activeProfile { id } } }`);
    expect(await run(app, `{ domainControls(profile: "${second!.id}") { domain } }`)).toEqual({ data: { domainControls: [] } });
    const saved = await run(app, `mutation { setDomainControl(profile: "${second!.id}", domain: "only-b.example", mode: MUTE) { domain revision } }`);
    expect(saved.data).toEqual({ setDomainControl: { domain: "only-b.example", revision: 1 } });
    // The first Profile does not see it; the second still does.
    const asA = await run(app, `{ domainControls(profile: "${first!.id}") { domain } }`);
    expect((asA.data!.domainControls as { domain: string }[]).map((c) => c.domain)).not.toContain("only-b.example");
    expect((await run(app, `{ domainControls(profile: "${second!.id}") { domain } }`)).data).toEqual({ domainControls: [{ domain: "only-b.example" }] });
    // Someone else's Profile is refused.
    const foreign = await run(app, '{ domainControls(profile: "someone-else") { domain } }');
    expect(foreign.errors![0]!.extensions).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
  });
});

describe("real mode", () => {
  test("a 200 from the backend is returned as data", async () => {
    const seen: string[] = [];
    const url = backend((request) => {
      seen.push(new URL(request.url).pathname);
      return Response.json(apiStatusFixture);
    });
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: url }));
    const result = await run(app, "{ apiMode apiStatus { apiVersion } }");
    expect(result).toEqual({ data: { apiMode: "REAL", apiStatus: { apiVersion: "v1" } } });
    expect(seen).toEqual(["/api/v1/status"]);
  });

  test("the backend's 501 propagates as a NOT_IMPLEMENTED error and is not replaced by mock data", async () => {
    const url = backend(() => Response.json(notImplementedFixture, { status: 501 }));
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: url }));
    const result = await run(app, "{ apiStatus { apiVersion } }");
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.extensions).toMatchObject({ code: "NOT_IMPLEMENTED", upstreamStatus: 501 });
    expect(result.errors![0]!.message).toBe(notImplementedFixture.message);
    expect(JSON.stringify(result)).not.toContain("apiVersion");
  });

  test("other backend failures propagate with their own codes", async () => {
    const failing = backend(() => Response.json({ code: "internal", message: "boom" }, { status: 500 }));
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: failing }));
    const result = await run(app, "{ apiStatus { apiVersion } }");
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions).toMatchObject({ code: "UPSTREAM_ERROR", upstreamStatus: 500 });

    const unreachable = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://127.0.0.1:1" }));
    const down = await run(unreachable, "{ apiStatus { apiVersion } }");
    expect(down.data).toBeNull();
    expect(down.errors![0]!.extensions).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  test("timeline / post operations have no endpoint: NOT_IMPLEMENTED without contacting the backend", async () => {
    const seen: string[] = [];
    const url = backend((request) => {
      seen.push(new URL(request.url).pathname);
      return Response.json(apiStatusFixture);
    });
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: url }));
    for (const query of [
      "{ timeline(kind: HOME) { id } }",
      '{ postView(id: "post-sora-zine") { id } }',
      '{ replies(postId: "post-sora-zine") { id } }',
      '{ userPage(handle: "nana@noisy.social") { bio } }',
      'mutation { revealPost(id: "post-nana-playlist") { id } }',
      'mutation { revealUserPage(handle: "nana@noisy.social") { bio } }',
      'mutation { createPost(input: { text: "hi", visibility: PUBLIC }) { id } }',
    ]) {
      const result = await run(app, query);
      // A nullable field (postView) is null alongside the error; nothing carries data.
      expect(Object.values(result.data ?? {}).every((value) => value === null)).toBe(true);
      expect(result.errors![0]!.extensions).toMatchObject({ code: "NOT_IMPLEMENTED" });
    }
    expect(seen).toEqual([]);
  });

  test("profile context fails closed without authentication (no invented profile)", async () => {
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://127.0.0.1:1" }));
    const result = await run(app, "{ profileContext { activeProfile { id } } }");
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
