// Profile-scoped mute/block settings held by Emumet (D08 / F8).
//
// Domain controls (E8/D8P contract): GET /api/v1/profiles/{profile_nanoid}/domain-controls,
// GET/PUT/DELETE .../domain-controls/{domain}. Individual actor blocks/mutes and the follow
// lists use the same Profile scope (E8 contract, P3o/P3i implementation, mounted by P4).
// Types come from the pinned Emumet OpenAPI (generated/emumet-api.ts); the real adapter
// validates every 2xx body against it and the mock serves contract-checked values only.

import type { components } from "../rest/generated/emumet-api.ts";

export type DomainControlResponse = components["schemas"]["DomainControlResponse"];
export type DomainControlListResponse = components["schemas"]["DomainControlListResponse"];
export type ProfileRelationResponse = components["schemas"]["ProfileRelationResponse"];
export type ProfileRelationListResponse = components["schemas"]["ProfileRelationListResponse"];
export type ProfileFollowListResponse = components["schemas"]["ProfileFollowListResponse"];
export type ProfileFollowerListResponse = components["schemas"]["ProfileFollowerListResponse"];
export type PolicyMode = "mute" | "block";

export type DomainControl = {
  domain: string;
  mode: PolicyMode;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ActorPolicy = {
  id: string;
  mode: PolicyMode;
  /** Canonical actor URL of the target. Emumet exposes no name/icon/acct for it. */
  actorUrl: string;
  createdAt: string;
};

/** Existing relations of the Profile, as canonical actor URLs (pending and accepted). */
export type FollowRelations = {
  following: string[];
  followers: string[];
};

export type PolicyErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "ALREADY_EXISTS"
  | "INVALID_DOMAIN"
  | "BAD_REQUEST"
  | "NOT_IMPLEMENTED"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_UPSTREAM_RESPONSE";

/** Every failure is surfaced as this error; nothing turns it into data or into mock data. */
export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  readonly status: number | undefined;
  constructor(code: PolicyErrorCode, message: string, status?: number) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.status = status;
  }
}

export interface ProfilePolicySource {
  readonly mode: "mock" | "real";
  listDomainControls(profileId: string): Promise<DomainControl[]>;
  /** expectedRevision omitted = create (409 if it exists); given = replace only that revision. */
  putDomainControl(profileId: string, domain: string, mode: PolicyMode, expectedRevision?: number): Promise<DomainControl>;
  deleteDomainControl(profileId: string, domain: string, expectedRevision: number): Promise<void>;
  listActorPolicies(profileId: string): Promise<ActorPolicy[]>;
  /** Re-creates an individual mute/block (used to undo an unmute and for "change to mute"). */
  createActorPolicy(profileId: string, mode: PolicyMode, target: string): Promise<ActorPolicy>;
  deleteActorPolicy(profileId: string, mode: PolicyMode, id: string): Promise<void>;
  followRelations(profileId: string): Promise<FollowRelations>;
}

export function toDomainControl(body: DomainControlResponse): DomainControl {
  return { domain: body.domain, mode: body.mode, revision: body.revision, createdAt: body.created_at, updatedAt: body.updated_at };
}

export function toActorPolicy(body: ProfileRelationResponse): ActorPolicy {
  return { id: body.id, mode: body.kind, actorUrl: body.target, createdAt: body.created_at };
}
