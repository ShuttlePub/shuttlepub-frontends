// Turns one search REST answer (status + parsed JSON body) into a result or a ShuttlePubApiError.
// The real adapter feeds it HTTP responses and the mock feeds it the answers of its reference
// projection, so both modes report the same outcome for the same answer: a contract-checked 200 body,
// or an error. Nothing here turns a failure into data.

import { describeViolations, violationsForResponse, violationsForSchema } from "../openapi/contract.ts";
import { ShuttlePubApiError, type ErrorBody } from "../rest/client.ts";
import { SEARCH_OPERATIONS, type RawReply, type SearchOperation } from "./types.ts";

function asErrorBody(value: unknown): ErrorBody | undefined {
  if (value === undefined) return undefined;
  return violationsForSchema("ErrorBody", value).length === 0 ? value as ErrorBody : undefined;
}

/** Contract rules the OpenAPI schema states in prose only: no actor URL twice in one answer. */
function duplicateActorUrl(operation: SearchOperation, body: unknown): string | undefined {
  if (operation !== "suggestNoteSearchAuthors") return undefined;
  const seen = new Set<string>();
  for (const item of (body as { items: { actor_url: string }[] }).items) {
    if (seen.has(item.actor_url)) return item.actor_url;
    seen.add(item.actor_url);
  }
  return undefined;
}

export function interpretSearchReply<T>(operation: SearchOperation, reply: RawReply): T {
  const { path, method } = SEARCH_OPERATIONS[operation];
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
    const duplicate = duplicateActorUrl(operation, body);
    if (duplicate !== undefined) {
      throw new ShuttlePubApiError("invalid_response", `${label} 200 body lists ${duplicate} twice`, { status });
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
  const message = errorBody?.message;
  if (status === 501) {
    throw new ShuttlePubApiError("not_implemented", message ?? `${label} answered 501 Not Implemented`, { status, ...withBody });
  }
  if (status === 400) throw new ShuttlePubApiError("invalid_request", message ?? `${label} answered 400`, { status, ...withBody });
  if (status === 404) throw new ShuttlePubApiError("not_found", message ?? `${label} answered 404`, { status, ...withBody });
  // Only the author resolve has a 409 (several verified accts). It is not the reaction conflict.
  if (status === 409 && operation === "resolveNoteSearchAuthor" && errorBody?.code === "conflict") {
    throw new ShuttlePubApiError("author_ambiguous", message ?? `${label} answered 409`, { status, ...withBody });
  }
  if (status === 429) throw new ShuttlePubApiError("rate_limited", message ?? `${label} answered 429`, { status, ...withBody });
  if (status === 503 && errorBody?.code === "search_timeout" && operation === "searchPersonalNotes") {
    throw new ShuttlePubApiError("search_timeout", message ?? `${label} timed out`, { status, ...withBody });
  }
  if (status === 503 && operation !== "searchPersonalNotes" &&
    (errorBody?.code === "author_lookup_timeout" || errorBody?.code === "author_lookup_unavailable")) {
    throw new ShuttlePubApiError("author_lookup_unavailable", message ?? `${label} author lookup unavailable`, { status, ...withBody });
  }
  throw new ShuttlePubApiError("upstream_error", message ?? `${label} answered HTTP ${status}`, { status, ...withBody });
}
