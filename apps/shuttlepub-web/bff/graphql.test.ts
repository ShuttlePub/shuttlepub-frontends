import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { profileContextFixture, availableProfilesFixture } from "./profile.ts";
import { apiStatusFixture, notImplementedFixture } from "./rest/fixtures.ts";
import { timelinePostFixtures, replyPostFixtures } from "./rest/post-fixtures.ts";

type GraphQLResponse = {
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown>; path?: string[] }[];
};

async function send(app: App, query: string, cookie?: string): Promise<Response> {
  return await app.handleGraphql(
    new Request("http://app.test/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://app.test", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ query }),
    }),
  );
}

async function run(app: App, query: string, cookie?: string): Promise<GraphQLResponse> {
  return (await (await send(app, query, cookie)).json()) as GraphQLResponse;
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

  const POST_FIELDS = "id text createdAt replyCount repostCount inReplyToId author { id handle displayName } repostedBy { id handle displayName }";

  test("serves the provisional timeline fixtures per tab", async () => {
    const home = await run(app, `{ timeline(kind: HOME) { ${POST_FIELDS} } }`);
    expect(home.errors).toBeUndefined();
    expect(home.data!.timeline).toEqual(timelinePostFixtures);

    const local = await run(app, "{ timeline(kind: LOCAL) { id author { handle } repostedBy { id } } }");
    const localPosts = local.data!.timeline as { author: { handle: string }; repostedBy: unknown }[];
    expect(localPosts.length).toBeGreaterThan(0);
    expect(localPosts.length).toBeLessThan(timelinePostFixtures.length);
    for (const entry of localPosts) {
      expect(entry.author.handle.endsWith("@shuttlepub.example")).toBe(true);
      expect(entry.repostedBy).toBeNull();
    }
  });

  test("post detail returns the post and its replies, and null for an unknown id", async () => {
    const detail = await run(app, `{ post(id: "post-sora-zine") { ${POST_FIELDS} } replies(postId: "post-sora-zine") { id inReplyToId } }`);
    expect(detail.errors).toBeUndefined();
    expect((detail.data!.post as { id: string }).id).toBe("post-sora-zine");
    expect(detail.data!.replies).toEqual(replyPostFixtures.map((reply) => ({ id: reply.id, inReplyToId: "post-sora-zine" })));

    const missing = await run(app, '{ post(id: "no-such-post") { id } replies(postId: "no-such-post") { id } }');
    expect(missing).toEqual({ data: { post: null, replies: [] } });
  });

  test("posting is not simulated: createPost is NOT_IMPLEMENTED even in mock mode", async () => {
    const result = await run(app, 'mutation { createPost(input: { text: "hi", visibility: PUBLIC }) { id } }');
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions).toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  test("lists every mock Profile; a selection is remembered by that browser only (cookie)", async () => {
    const list = await run(app, "{ availableProfiles { id handle displayName } }");
    expect(list.data!.availableProfiles).toEqual(availableProfilesFixture.map(({ profileId: _, ...visible }) => visible));
    const second = availableProfilesFixture[1]!;
    const response = await send(app, `mutation { selectProfile(id: "${second.id}") { activeProfile { id } } }`);
    expect(await response.json()).toEqual({ data: { selectProfile: { activeProfile: { id: second.id } } } });
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    const browserCookie = cookie.split(";")[0]!;
    // This browser keeps its selection; another browser (no cookie) still has the fixture default.
    expect((await run(app, "{ profileContext { activeProfile { id } } }", browserCookie)).data)
      .toEqual({ profileContext: { activeProfile: { id: second.id } } });
    expect((await run(app, "{ profileContext { activeProfile { id } } }")).data)
      .toEqual({ profileContext: { activeProfile: { id: profileContextFixture.activeProfile!.id } } });
    // An unknown remembered id falls back to the default; an unknown selection is refused and not remembered.
    expect((await run(app, "{ profileContext { activeProfile { id } } }", "sp_mock_profile=someone-else")).data)
      .toEqual({ profileContext: { activeProfile: { id: profileContextFixture.activeProfile!.id } } });
    const unknown = await send(app, 'mutation { selectProfile(id: "someone-else") { activeProfile { id } } }');
    expect(unknown.headers.get("Set-Cookie")).toBeNull();
    expect(((await unknown.json()) as GraphQLResponse).errors![0]!.extensions).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
  });

  test("mute/block settings follow this browser's selected Profile and stay separate per Profile", async () => {
    const [first, second] = availableProfilesFixture;
    const cookie = (await send(app, `mutation { selectProfile(id: "${second!.id}") { activeProfile { id } } }`)).headers.get("Set-Cookie")!.split(";")[0]!;
    const listB = await run(app, `{ domainControls(profile: "${second!.id}") { domain } }`, cookie);
    expect(listB).toEqual({ data: { domainControls: [] } });
    const saved = await run(app, `mutation { setDomainControl(profile: "${second!.id}", domain: "only-b.example", mode: MUTE) { domain revision } }`, cookie);
    expect(saved.data).toEqual({ setDomainControl: { domain: "only-b.example", revision: 1 } });
    // The page of another browser still on A cannot write as B, and A's list does not contain B's setting.
    const asA = await run(app, `{ domainControls(profile: "${first!.id}") { domain } }`);
    expect((asA.data!.domainControls as { domain: string }[]).map((c) => c.domain)).not.toContain("only-b.example");
    const stale = await run(app, `{ domainControls(profile: "${second!.id}") { domain } }`);
    expect(stale.errors![0]!.extensions).toMatchObject({ code: "PROFILE_CHANGED" });
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
      '{ post(id: "post-sora-zine") { id } }',
      '{ replies(postId: "post-sora-zine") { id } }',
      'mutation { createPost(input: { text: "hi", visibility: PUBLIC }) { id } }',
    ]) {
      const result = await run(app, query);
      // A nullable field (post) is null alongside the error; nothing carries data.
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
