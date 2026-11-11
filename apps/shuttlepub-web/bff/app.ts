import type { AppConfig } from "./config.ts";
import type { AuthConfig } from "./auth-config.ts";
import { AuthError } from "./auth-error.ts";
import { checkOrigin, createAuth, privateResponse, withCookies, type Auth, type FetchLike, type ViewerSession } from "./auth.ts";
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
};
export type AppDeps = {
  fetch?: (request: Request) => Promise<Response>;
  auth?: AuthConfig;
  authFetch?: FetchLike;
  emumetFetch?: FetchLike;
  /** Mock mode only: the Profile mute/block mock (tests inject a seeded one). */
  mockPolicy?: ProfilePolicySource;
};

/** Hosts of this deployment; a person cannot mute or block their own server as a domain. */
function selfDomainsOf(...origins: string[]): string[] {
  return [...new Set(origins.map((origin) => new URL(origin).hostname))];
}

export function createApp(config: AppConfig, deps: AppDeps = {}): App {
  const api: ShuttlePubApi = config.mode === "mock" ? createMockApi()
    : createRealApi({ baseUrl: config.apiUrl, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
  const auth = config.mode === "real" && deps.auth ? createAuth(deps.auth, { fetch: deps.authFetch }) : undefined;
  const profiles = config.mode === "mock" ? createMockProfileContext() : createRealProfileContext();
  // Mock mode: one stateful policy for the process. Real mode without an authenticated
  // session (no auth config) must never reach mock data: every call is UNAUTHENTICATED.
  const mockPolicy = config.mode === "mock" ? deps.mockPolicy ?? createMockProfilePolicy()
    : createRealProfilePolicy({ baseUrl: "http://unconfigured.invalid", session: () => Promise.reject(new AuthError("UNAUTHENTICATED", 401)) });
  const handlers = new Map<string, (request: Request) => Promise<Response>>();
  // The own host in mock mode is the one serving the page.
  const mockHandler = (request: Request) => {
    const selfDomains = selfDomainsOf(request.url);
    const key = selfDomains.join(",");
    let handler = handlers.get(key);
    if (!handler) handlers.set(key, handler = createGraphqlHandler({ api, profiles, policy: mockPolicy, selfDomains }));
    return handler(request);
  };
  return { config, api, profiles, ...(auth ? { auth } : {}),
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
      const selfDomains = selfDomainsOf(auth.config.appOrigin, auth.config.emumetApiUrl);
      try {
        const response = await createGraphqlHandler({ api, profiles: requestProfiles, policy, selfDomains })(request);
        return privateResponse(withCookies(response, cookies));
      } catch (error) {
        return privateResponse(withCookies(Response.json({ error: error instanceof AuthError ? error.code : "UPSTREAM_UNAVAILABLE" }, { status: 502 }), cookies));
      }
    },
  };
}
