import createClient from "openapi-fetch";
import { describeViolations, violationsForResponse } from "../openapi/contract.ts";
import { ShuttlePubApiError, missingEndpoint, type ApiStatus, type ErrorBody, type ShuttlePubApi } from "./client.ts";
import type { paths } from "./generated/shuttlepub-api.ts";

export type RealApiOptions = {
  baseUrl: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>;
};

/**
 * Typed client for the real backend. There is deliberately no fallback: any answer
 * other than a contract-conformant 200 is thrown as a ShuttlePubApiError, in
 * particular the stub's 501 is `not_implemented`, never data and never mock data.
 */
export function createRealApi(options: RealApiOptions): ShuttlePubApi {
  const client = createClient<paths>({ baseUrl: options.baseUrl });

  return {
    mode: "real",
    async getApiStatus(): Promise<ApiStatus> {
      // openapi-fetch parses the body inside client.GET, so a thrown error is either a
      // transport failure (no response at all) or a response whose body could not be
      // parsed; only the former is "unavailable".
      let received: Response | undefined;
      const sendRequest = options.fetch ?? ((request: Request) => globalThis.fetch(request));
      let result;
      try {
        result = await client.GET("/api/v1/status", {
          fetch: async (request) => (received = await sendRequest(request)),
        });
      } catch (cause) {
        if (received !== undefined) {
          throw new ShuttlePubApiError(
            "invalid_response",
            `GET /api/v1/status answered HTTP ${received.status} with a body that is not valid JSON: ${String(cause)}`,
            { status: received.status, cause },
          );
        }
        throw new ShuttlePubApiError("unavailable", `ShuttlePub API request failed: ${String(cause)}`, { cause });
      }
      const { data, error, response } = result;
      if (response.status === 501) {
        const body = asErrorBody(error);
        throw new ShuttlePubApiError(
          "not_implemented",
          body?.message ?? "ShuttlePub API answered 501 Not Implemented",
          { status: 501, ...(body === undefined ? {} : { body }) },
        );
      }
      if (response.ok) {
        if (response.status !== 200 || data === undefined) {
          throw new ShuttlePubApiError(
            "invalid_response",
            `GET /api/v1/status answered HTTP ${response.status}; the pinned OpenAPI contract documents only a 200 JSON body`,
            { status: response.status },
          );
        }
        const violations = violationsForResponse({ path: "/api/v1/status", method: "get", status: "200" }, data);
        if (violations.length > 0) {
          throw new ShuttlePubApiError(
            "invalid_response",
            `GET /api/v1/status 200 body violates the pinned OpenAPI contract: ${describeViolations(violations)}`,
            { status: 200 },
          );
        }
        return data;
      }
      const body = asErrorBody(error);
      throw new ShuttlePubApiError(
        "upstream_error",
        body?.message ?? `ShuttlePub API answered HTTP ${response.status}`,
        { status: response.status, ...(body === undefined ? {} : { body }) },
      );
    },
    // No endpoint for these exists in the pinned schema: never guess a path, never
    // fall back to fixtures.
    async getTimeline() {
      throw missingEndpoint("getTimeline");
    },
    async getPost() {
      throw missingEndpoint("getPost");
    },
    async getReplies() {
      throw missingEndpoint("getReplies");
    },
    async createPost() {
      throw missingEndpoint("createPost");
    },
  };
}

function asErrorBody(value: unknown): ErrorBody | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { code, message } = value as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  return value as ErrorBody;
}
