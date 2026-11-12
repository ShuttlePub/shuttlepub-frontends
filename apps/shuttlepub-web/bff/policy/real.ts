// Real Emumet adapter for Profile mute/block settings.
//
// The access token stays in the BFF session (FA): requests carry `Authorization: Bearer`
// built here, never browser cookies or headers. Redirects are not followed. Every 2xx body
// is validated against the pinned Emumet OpenAPI; anything else becomes a PolicyError.
// There is no fallback to mock data.

import type { FetchLike, ViewerSession } from "../auth.ts";
import { describeViolations, emumetContract, type HttpMethod } from "../openapi/contract.ts";
import {
  PolicyError,
  toActorPolicy,
  toDomainControl,
  type ActorPolicy,
  type DomainControl,
  type DomainControlListResponse,
  type DomainControlResponse,
  type PolicyErrorCode,
  type PolicyMode,
  type ProfileFollowerListResponse,
  type ProfileFollowListResponse,
  type ProfilePolicySource,
  type ProfileRelationListResponse,
  type ProfileRelationResponse,
} from "./source.ts";

export type RealPolicyDeps = {
  /** Emumet API origin (EMUMET_API_URL). */
  baseUrl: string;
  session: () => Promise<ViewerSession>;
  fetch?: FetchLike;
  /** Called when Emumet rejects the token, so the BFF clears the session. */
  invalidated?: () => Promise<void>;
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

type Call = {
  method: HttpMethod;
  /** OpenAPI path template, used for contract lookup and error messages. */
  template: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Meaning of 409 / 422 for this operation. */
  conflict?: PolicyErrorCode;
  unprocessable?: PolicyErrorCode;
};

const RELATION_PATH: Record<PolicyMode, "blocks" | "mutes"> = { block: "blocks", mute: "mutes" };

export function createRealProfilePolicy(deps: RealPolicyDeps): ProfilePolicySource {
  const fetcher = deps.fetch ?? fetch;
  const base = deps.baseUrl.replace(/\/+$/, "");

  async function send(call: Call): Promise<{ status: number; body: unknown }> {
    const session = await deps.session();
    const url = new URL(base + call.path);
    for (const [key, value] of Object.entries(call.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Authorization: "Bearer " + session.accessToken, Accept: "application/json" };
    if (call.body !== undefined) headers["Content-Type"] = "application/json";
    const label = `${call.method.toUpperCase()} ${call.template}`;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: call.method.toUpperCase(),
        headers,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PolicyError("UPSTREAM_UNAVAILABLE", `Emumet could not be reached (${label})`);
    }
    const status = response.status;
    if (status === 401) {
      await deps.invalidated?.();
      throw new PolicyError("UNAUTHENTICATED", "Emumet rejected the session", 401);
    }
    if (status === 403) throw new PolicyError("FORBIDDEN", "The active profile is not owned by this account", 403);
    if (status === 404) throw new PolicyError("NOT_FOUND", `${label} answered 404`, 404);
    if (status === 409) throw new PolicyError(call.conflict ?? "REVISION_CONFLICT", `${label} answered 409`, 409);
    if (status === 422) throw new PolicyError(call.unprocessable ?? "BAD_REQUEST", `${label} answered 422`, 422);
    if (status === 400) throw new PolicyError("BAD_REQUEST", `${label} answered 400`, 400);
    if (status === 501) throw new PolicyError("NOT_IMPLEMENTED", `${label} is not implemented by Emumet`, 501);
    if (status < 200 || status >= 300) throw new PolicyError("UPSTREAM_ERROR", `${label} answered HTTP ${status}`, status);
    if (status === 204) return { status, body: undefined };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `${label} answered HTTP ${status} without a JSON body`, status);
    }
    let violations;
    try {
      violations = emumetContract.violationsForResponse({ path: call.template, method: call.method, status: String(status) }, body);
    } catch {
      throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `${label} answered undocumented HTTP ${status}`, status);
    }
    if (violations.length > 0) {
      throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `${label} body violates the pinned Emumet contract: ${describeViolations(violations)}`, status);
    }
    return { status, body };
  }

  function expectStatus(result: { status: number }, expected: number, label: string): void {
    if (result.status !== expected) throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `${label} answered HTTP ${result.status}, expected ${expected}`, result.status);
  }

  /** Settings of one Profile must never be mixed with another Profile's (Profile separation). */
  function ownedBy(profileId: string, items: { profile_id: string }[], label: string): void {
    if (items.some((item) => item.profile_id !== profileId)) {
      throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `${label} returned settings of another profile`);
    }
  }

  async function paginate<T extends { items: unknown[]; next_cursor?: string | null }>(template: string, path: string): Promise<T["items"]> {
    const items: T["items"] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = { limit: String(PAGE_LIMIT) };
      if (cursor !== undefined) query["cursor"] = cursor;
      const result = await send({ method: "get", template, path, query });
      expectStatus(result, 200, `GET ${template}`);
      const body = result.body as T;
      items.push(...body.items);
      const next = body.next_cursor;
      if (next === undefined || next === null) return items;
      if (seen.has(next)) throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `GET ${template} repeated a cursor`);
      seen.add(next);
      cursor = next;
    }
    throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `GET ${template} exceeded ${MAX_PAGES} pages`);
  }

  const profilePath = (profileId: string) => `/api/v1/profiles/${encodeURIComponent(profileId)}`;

  return {
    mode: "real",
    async listDomainControls(profileId): Promise<DomainControl[]> {
      const template = "/api/v1/profiles/{profile_nanoid}/domain-controls";
      const result = await send({ method: "get", template, path: `${profilePath(profileId)}/domain-controls` });
      expectStatus(result, 200, `GET ${template}`);
      const items = (result.body as DomainControlListResponse).items;
      ownedBy(profileId, items, `GET ${template}`);
      return items.map(toDomainControl);
    },
    async putDomainControl(profileId, domain, mode, expectedRevision): Promise<DomainControl> {
      const template = "/api/v1/profiles/{profile_nanoid}/domain-controls/{domain}";
      const result = await send({
        method: "put", template, path: `${profilePath(profileId)}/domain-controls/${encodeURIComponent(domain)}`,
        body: expectedRevision === undefined ? { mode } : { mode, expected_revision: expectedRevision },
        conflict: "REVISION_CONFLICT", unprocessable: "INVALID_DOMAIN",
      });
      expectStatus(result, 200, `PUT ${template}`);
      const body = result.body as DomainControlResponse;
      ownedBy(profileId, [body], `PUT ${template}`);
      if (body.mode !== mode) throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `PUT ${template} stored ${body.mode}, requested ${mode}`);
      return toDomainControl(body);
    },
    async deleteDomainControl(profileId, domain, expectedRevision): Promise<void> {
      const template = "/api/v1/profiles/{profile_nanoid}/domain-controls/{domain}";
      const result = await send({
        method: "delete", template, path: `${profilePath(profileId)}/domain-controls/${encodeURIComponent(domain)}`,
        query: { expected_revision: String(expectedRevision) },
        conflict: "REVISION_CONFLICT", unprocessable: "INVALID_DOMAIN",
      });
      expectStatus(result, 204, `DELETE ${template}`);
    },
    async listActorPolicies(profileId): Promise<ActorPolicy[]> {
      const all: ActorPolicy[] = [];
      for (const mode of ["block", "mute"] as const) {
        const template = `/api/v1/profiles/{profile_nanoid}/${RELATION_PATH[mode]}`;
        const items = await paginate<ProfileRelationListResponse>(template, `${profilePath(profileId)}/${RELATION_PATH[mode]}`);
        ownedBy(profileId, items, `GET ${template}`);
        if (items.some((item) => item.kind !== mode)) throw new PolicyError("INVALID_UPSTREAM_RESPONSE", `GET ${template} returned another kind`);
        all.push(...items.map(toActorPolicy));
      }
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async createActorPolicy(profileId, mode, target): Promise<ActorPolicy> {
      const template = `/api/v1/profiles/{profile_nanoid}/${RELATION_PATH[mode]}`;
      const result = await send({
        method: "post", template, path: `${profilePath(profileId)}/${RELATION_PATH[mode]}`, body: { target },
        conflict: "ALREADY_EXISTS",
      });
      expectStatus(result, 201, `POST ${template}`);
      const body = result.body as ProfileRelationResponse;
      ownedBy(profileId, [body], `POST ${template}`);
      return toActorPolicy(body);
    },
    async deleteActorPolicy(profileId, mode, id): Promise<void> {
      const idName = mode === "block" ? "block_id" : "mute_id";
      const template = `/api/v1/profiles/{profile_nanoid}/${RELATION_PATH[mode]}/{${idName}}`;
      const result = await send({ method: "delete", template, path: `${profilePath(profileId)}/${RELATION_PATH[mode]}/${encodeURIComponent(id)}` });
      expectStatus(result, 204, `DELETE ${template}`);
    },
    async followRelations(profileId) {
      const followingTemplate = "/api/v1/profiles/{profile_nanoid}/following";
      const followersTemplate = "/api/v1/profiles/{profile_nanoid}/followers";
      const [following, followers] = await Promise.all([
        paginate<ProfileFollowListResponse>(followingTemplate, `${profilePath(profileId)}/following`),
        paginate<ProfileFollowerListResponse>(followersTemplate, `${profilePath(profileId)}/followers`),
      ]);
      ownedBy(profileId, following, `GET ${followingTemplate}`);
      ownedBy(profileId, followers, `GET ${followersTemplate}`);
      return { following: following.map((item) => item.target), followers: followers.map((item) => item.follower.actor_url) };
    },
  };
}
