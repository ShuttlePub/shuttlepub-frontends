import type { AppConfig } from "./config.ts";
import type { AuthConfig } from "./auth-config.ts";
import { AuthError } from "./auth-error.ts";
import { checkOrigin, createAuth, privateResponse, withCookies, type Auth, type FetchLike, type ViewerSession } from "./auth.ts";
import { createMockProfileContext, createRealProfileContext, type ProfileContextSource } from "./profile.ts";
import type { ShuttlePubApi } from "./rest/client.ts";
import { createMockApi } from "./rest/mock.ts";
import { createRealApi } from "./rest/real.ts";
import { createGraphqlHandler } from "./server.ts";

export type App = {
  config: AppConfig;
  api: ShuttlePubApi;
  profiles: ProfileContextSource;
  auth?: Auth;
  handleGraphql: (request: Request) => Promise<Response>;
  /**
   * Mock mode only: POST /__mock/reset restores the stateful mock (quick reaction
   * favourites / reactions) to its fixtures. Tests and the visual capture use it to
   * start every case from the same state. Real mode has no such route.
   */
  handleMockReset?: (request: Request) => Response;
};
export type AppDeps = {
  fetch?: (request: Request) => Promise<Response>;
  auth?: AuthConfig;
  authFetch?: FetchLike;
  emumetFetch?: FetchLike;
};

export function createApp(config: AppConfig, deps: AppDeps = {}): App {
  const mockApi = config.mode === "mock" ? createMockApi() : undefined;
  const api: ShuttlePubApi = config.mode === "mock" ? mockApi!
    : createRealApi({ baseUrl: config.apiUrl, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
  const auth = config.mode === "real" && deps.auth ? createAuth(deps.auth, { fetch: deps.authFetch }) : undefined;
  const profiles = config.mode === "mock" ? createMockProfileContext() : createRealProfileContext();
  // Without a session there is no bearer token: real S3 operations are UNAUTHENTICATED.
  const viewerAuth = config.mode === "mock"
    ? async () => ({ accessToken: undefined })
    : async (): Promise<{ accessToken: string | undefined }> => { throw new AuthError("UNAUTHENTICATED", 401); };
  const mockHandler = createGraphqlHandler({ api, profiles, viewerAuth });
  return { config, api, profiles, ...(auth ? { auth } : {}),
    ...(mockApi ? {
      handleMockReset(request: Request) {
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
        mockApi.reset();
        return new Response(null, { status: 204 });
      },
    } : {}),
    async handleGraphql(request) {
      if (config.mode === "mock") return mockHandler(request);
      // All POSTs are protected, including GraphQL queries. GET mutations are rejected by Yoga.
      if (request.method === "POST") {
        const rejected = checkOrigin(request, auth?.config.appOrigin ?? new URL(request.url).origin);
        if (rejected) return privateResponse(rejected);
      }
      if (!auth) return privateResponse(await mockHandler(request));
      const cookies: string[] = [];
      let resolved: Promise<ViewerSession> | undefined;
      const getSession = () => resolved ??= auth.resolveSession(request, cookies);
      const requestProfiles = createRealProfileContext({ baseUrl: auth.config.emumetApiUrl,
        session: getSession,
        async selected(session, id) {
          const selected = { ...session, activeProfileId: id };
          cookies.push(await auth.sealSession(selected));
          resolved = Promise.resolve(selected);
        },
        fetch: deps.emumetFetch,
        async invalidated() { cookies.push(await auth.clearSession()); },
      });
      try {
        const response = await createGraphqlHandler({ api, profiles: requestProfiles,
          viewerAuth: async () => ({ accessToken: (await getSession()).accessToken }) })(request);
        return privateResponse(withCookies(response, cookies));
      } catch (error) {
        return privateResponse(withCookies(Response.json({ error: error instanceof AuthError ? error.code : "UPSTREAM_UNAVAILABLE" }, { status: 502 }), cookies));
      }
    },
  };
}
