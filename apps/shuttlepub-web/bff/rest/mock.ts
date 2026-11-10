import type { ShuttlePubApi } from "./client.ts";
import { apiStatusFixture } from "./fixtures.ts";

/** Serves contract-checked fixtures. Selected only by SHUTTLEPUB_API_MODE=mock. */
export function createMockApi(): ShuttlePubApi {
  return {
    mode: "mock",
    async getApiStatus() {
      return structuredClone(apiStatusFixture);
    },
  };
}
