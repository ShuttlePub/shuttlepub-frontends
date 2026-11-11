import { missingEndpoint, type ShuttlePubApi } from "./client.ts";
import { apiStatusFixture } from "./fixtures.ts";
import { postFixture, repliesFixture, timelineFixture } from "./post-fixtures.ts";

/**
 * Serves fixtures. Selected only by SHUTTLEPUB_API_MODE=mock. The status fixture is
 * contract-checked; timeline/post fixtures are app-owned and provisional (post-fixtures.ts).
 * Posting is not simulated: there is no contract to model it on.
 */
export function createMockApi(): ShuttlePubApi {
  return {
    mode: "mock",
    async getApiStatus() {
      return structuredClone(apiStatusFixture);
    },
    async getTimeline(kind) {
      return timelineFixture(kind);
    },
    async getPost(id) {
      return postFixture(id);
    },
    async getReplies(postId) {
      return repliesFixture(postId);
    },
    async createPost() {
      throw missingEndpoint("createPost");
    },
  };
}
