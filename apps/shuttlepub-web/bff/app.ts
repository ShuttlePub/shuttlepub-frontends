import type { AppConfig } from "./config.ts";
import { createMockProfileContext, createRealProfileContext, type ProfileContextSource } from "./profile.ts";
import type { ShuttlePubApi } from "./rest/client.ts";
import { createMockApi } from "./rest/mock.ts";
import { createRealApi } from "./rest/real.ts";
import { createGraphqlHandler } from "./server.ts";

export type App = {
  config: AppConfig;
  api: ShuttlePubApi;
  profiles: ProfileContextSource;
  handleGraphql: (request: Request) => Promise<Response>;
};

export type AppDeps = {
  /** Injected in tests for the real adapter. */
  fetch?: (request: Request) => Promise<Response>;
};

/** The single place where mock vs real is decided, from the already validated config. */
export function createApp(config: AppConfig, deps: AppDeps = {}): App {
  const api: ShuttlePubApi =
    config.mode === "mock"
      ? createMockApi()
      : createRealApi({ baseUrl: config.apiUrl, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
  const profiles = config.mode === "mock" ? createMockProfileContext() : createRealProfileContext();
  return { config, api, profiles, handleGraphql: createGraphqlHandler({ api, profiles }) };
}
