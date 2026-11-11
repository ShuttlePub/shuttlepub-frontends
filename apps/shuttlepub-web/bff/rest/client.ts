// The app's view of the ShuttlePub REST backend: a small typed interface with a
// mock and a real implementation. Types come from the pinned OpenAPI schema
// (generated/shuttlepub-api.ts); nothing here is hand-copied from the backend.

import type { components } from "./generated/shuttlepub-api.ts";
import type { CreatePostInput, Post, TimelineKind } from "./posts.ts";

export type ApiStatus = components["schemas"]["ApiStatus"];
export type ErrorBody = components["schemas"]["ErrorBody"];

export type ApiMode = "mock" | "real";

export type ShuttlePubApiErrorKind =
  /** The backend (or this app, for features that need an unbuilt dependency) says it is not implemented. HTTP 501. */
  | "not_implemented"
  /** The backend answered with an error status other than 501. */
  | "upstream_error"
  /** The backend could not be reached (connection refused, DNS, timeout...). */
  | "unavailable"
  /** The backend answered 2xx with a body that violates the pinned OpenAPI contract. */
  | "invalid_response";

/**
 * Every failure of the real adapter is surfaced as this error. Nothing in the app
 * turns it into a success value or into mock data.
 */
export class ShuttlePubApiError extends Error {
  readonly kind: ShuttlePubApiErrorKind;
  /** Upstream HTTP status, when there was a response. */
  readonly status: number | undefined;
  /** Upstream ErrorBody, when the backend sent a contract-shaped one. */
  readonly body: ErrorBody | undefined;

  constructor(kind: ShuttlePubApiErrorKind, message: string, options: { status?: number; body?: ErrorBody; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ShuttlePubApiError";
    this.kind = kind;
    this.status = options.status;
    this.body = options.body;
  }
}

export interface ShuttlePubApi {
  /** Fixed for the lifetime of the process. */
  readonly mode: ApiMode;
  /** GET /api/v1/status (operation getApiStatus). Resolves only with a 200 body; rejects with ShuttlePubApiError otherwise. */
  getApiStatus(): Promise<ApiStatus>;
  /**
   * Timeline / post operations use the PROVISIONAL app-owned types in posts.ts: the
   * pinned OpenAPI schema has no such endpoint yet. Real mode rejects them all with
   * not_implemented without contacting the backend (no invented paths or data).
   */
  getTimeline(kind: TimelineKind): Promise<Post[]>;
  /** Resolves null when the post does not exist. */
  getPost(id: string): Promise<Post | null>;
  getReplies(postId: string): Promise<Post[]>;
  /** Not implemented in either mode until the backend publishes a contract. */
  createPost(input: CreatePostInput): Promise<Post>;
}

/** Error for an operation whose endpoint is not in the pinned OpenAPI schema. */
export function missingEndpoint(operation: string): ShuttlePubApiError {
  return new ShuttlePubApiError(
    "not_implemented",
    `${operation} has no endpoint in the pinned ShuttlePub OpenAPI schema yet`,
  );
}
