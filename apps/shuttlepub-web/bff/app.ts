import type { AppConfig } from "./config.ts";
import type { AuthConfig } from "./auth-config.ts";
import { AuthError } from "./auth-error.ts";
import { checkOrigin, createAuth, privateResponse, withCookies, type Auth, type FetchLike, type ViewerSession } from "./auth.ts";
import { ownActorDomain } from "./policy/domain.ts";
import { createMockProfilePolicy } from "./policy/mock.ts";
import { createRealProfilePolicy } from "./policy/real.ts";
import type { ProfilePolicySource } from "./policy/source.ts";
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
   * Mock mode with `mockReset` only (SHUTTLEPUB_MOCK_RESET=1): POST /__mock/reset
   * restores the stateful mock (quick reaction favourites / reactions) to its fixtures.
   * The visual capture and verify turn it on to start every case from the same state;
   * a plain mock server and real mode have no such route.
   */
  handleMockReset?: (request: Request) => Response;
};
export type AppDeps = {
  fetch?: (request: Request) => Promise<Response>;
  auth?: AuthConfig;
  authFetch?: FetchLike;
  emumetFetch?: FetchLike;
  /** Mock mode only: the Profile mute/block mock (tests inject a seeded one). */
  mockPolicy?: ProfilePolicySource;
  /** Test-only: expose POST /__mock/reset (mock mode only). */
  mockReset?: boolean;
};

/** The mock deployment's actor domain (the agreed D08 mock's own server). */
export const MOCK_OWN_DOMAIN = "shuttle.example";

/** Our own actor domain from EMUMET_PUBLIC_HOST; null when not configured (nothing guessed). */
function selfDomainsOf(publicHost: string | undefined): string[] | null {
  if (!publicHost) return null;
  const domain = ownActorDomain(publicHost);
  return domain === null ? null : [domain];
}

export function createApp(config: AppConfig, deps: AppDeps = {}): App {
  const mockApi = config.mode === "mock" ? createMockApi() : undefined;
  const api: ShuttlePubApi = config.mode === "mock" ? mockApi!
    : createRealApi({ baseUrl: config.apiUrl, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
  const auth = config.mode === "real" && deps.auth ? createAuth(deps.auth, { fetch: deps.authFetch }) : undefined;
  const profiles = config.mode === "mock" ? createMockProfileContext() : createRealProfileContext();
  // Mock mode: one stateful policy for the process. Real mode without an authenticated
  // session (no auth config) must never reach mock data: every call is UNAUTHENTICATED.
  const mockPolicy = config.mode === "mock" ? deps.mockPolicy ?? createMockProfilePolicy()
    : createRealProfilePolicy({ baseUrl: "http://unconfigured.invalid", session: () => Promise.reject(new AuthError("UNAUTHENTICATED", 401)) });
  // Without a session there is no bearer token: real S3 operations are UNAUTHENTICATED.
  const viewerAuth = config.mode === "mock"
    ? async () => ({ accessToken: undefined })
    : async (): Promise<{ accessToken: string | undefined }> => { throw new AuthError("UNAUTHENTICATED", 401); };
  const mockHandler = createGraphqlHandler({ api, profiles, viewerAuth, policy: mockPolicy,
    selfDomains: config.mode === "mock" ? [MOCK_OWN_DOMAIN] : null });
  return { config, api, profiles, ...(auth ? { auth } : {}),
    ...(mockApi && deps.mockReset ? {
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
      const policy = createRealProfilePolicy({ baseUrl: auth.config.emumetApiUrl,
        session: getSession,
        fetch: deps.emumetFetch,
        async invalidated() { cookies.push(await auth.clearSession()); },
      });
      const selfDomains = selfDomainsOf(auth.config.emumetPublicHost);
      try {
        const response = await createGraphqlHandler({ api, profiles: requestProfiles, policy, selfDomains,
          viewerAuth: async () => ({ accessToken: (await getSession()).accessToken }) })(request);
        return privateResponse(withCookies(response, cookies));
      } catch (error) {
        return privateResponse(withCookies(Response.json({ error: error instanceof AuthError ? error.code : "UPSTREAM_UNAVAILABLE" }, { status: 502 }), cookies));
      }
    },
  };
}
