// Turns one quick-reaction REST answer (status + parsed JSON body) into a result or a
// ShuttlePubApiError. The real adapter feeds it HTTP responses and the mock adapter
// feeds it QuickReactionStore replies, so both modes report exactly the same
// outcomes for the same answer: a contract-checked 200 body, or an error.

import { describeViolations, violationsForResponse, violationsForSchema } from "../openapi/contract.ts";
import { ShuttlePubApiError, type ErrorBody } from "./client.ts";
import { OPERATIONS, type QuickReactionOperation } from "./quick-reaction.ts";

export type RawReply = {
  status: number;
  /** Parsed JSON body; undefined when there was none or it was not JSON. */
  body: unknown;
};

function asErrorBody(value: unknown): ErrorBody | undefined {
  if (value === undefined) return undefined;
  return violationsForSchema("ErrorBody", value).length === 0 ? value as ErrorBody : undefined;
}

export function interpretReply<T>(operation: QuickReactionOperation, reply: RawReply): T {
  const { path, method } = OPERATIONS[operation];
  const label = `${method.toUpperCase()} ${path}`;
  const { status, body } = reply;
  if (status === 200) {
    if (body === undefined) {
      throw new ShuttlePubApiError("invalid_response", `${label} answered 200 without a JSON body`, { status });
    }
    const violations = violationsForResponse({ path, method, status: "200" }, body);
    if (violations.length > 0) {
      throw new ShuttlePubApiError(
        "invalid_response",
        `${label} 200 body violates the pinned OpenAPI contract: ${describeViolations(violations)}`,
        { status },
      );
    }
    return body as T;
  }
  if (status >= 200 && status < 300) {
    throw new ShuttlePubApiError(
      "invalid_response",
      `${label} answered HTTP ${status}; the pinned OpenAPI contract documents only a 200 JSON body`,
      { status },
    );
  }
  const errorBody = asErrorBody(body);
  const withBody = errorBody === undefined ? {} : { body: errorBody };
  if (status === 501) {
    throw new ShuttlePubApiError("not_implemented", errorBody?.message ?? `${label} answered 501 Not Implemented`, { status, ...withBody });
  }
  if (status === 409 && operation === "putQuickReactionSettings" &&
    violationsForResponse({ path, method, status: "409" }, body).length === 0) {
    const conflict = body as { message: string; current_revision: number };
    throw new ShuttlePubApiError("revision_conflict", conflict.message, {
      status, currentRevision: conflict.current_revision, ...withBody,
    });
  }
  if (status === 422 && errorBody?.code === "emoji_unavailable") {
    throw new ShuttlePubApiError("emoji_unavailable", errorBody.message, { status, ...withBody });
  }
  throw new ShuttlePubApiError("upstream_error", errorBody?.message ?? `${label} answered HTTP ${status}`, { status, ...withBody });
}
