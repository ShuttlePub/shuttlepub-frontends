import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { profileContextFixture } from "./profile.ts";
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

  test("profile context fails closed without authentication (no invented profile)", async () => {
    const app = createApp(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://127.0.0.1:1" }));
    const result = await run(app, "{ profileContext { activeProfile { id } } }");
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
