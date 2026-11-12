// Stateful mock of Emumet's Profile mute/block settings (E8/D8P/D8R semantics).
//
// Reproduces what the UI must handle without a running Emumet:
//   - revision starts at 1 and grows on every create/replace/delete; a delete leaves a
//     tombstone so a re-created control continues from it (old revisions never match again)
//   - PUT without expected_revision creates (409 if a control exists), with it replaces
//     only that revision (409 on mismatch or if it was deleted meanwhile); DELETE requires
//     the current revision (409 on mismatch, 404 if absent)
//   - malformed domains are 422; the stored/returned domain is the normalized form;
//     matching is exact (example.com does not touch sub.example.com)
//   - settings are per Profile: one Profile's state is never visible from another
//   - a domain block detaches existing following/followers of that exact domain in both
//     directions; removing the block does not restore them (no restore list is kept)
// Every value it returns is shaped like the Emumet wire format and converted with the same
// functions as the real adapter.

import { actorDomain, canonicalDomain } from "./domain.ts";
import { defaultPolicySeed, type PolicySeed } from "./fixtures.ts";
import {
  PolicyError,
  toActorPolicy,
  toDomainControl,
  type DomainControlResponse,
  type PolicyMode,
  type ProfilePolicySource,
  type ProfileRelationResponse,
} from "./source.ts";

type StoredControl = DomainControlResponse & { deleted: boolean };
type ProfileState = {
  controls: Map<string, StoredControl>;
  relations: Map<string, ProfileRelationResponse>;
  following: string[];
  followers: string[];
};

export type MockPolicyOptions = {
  seed?: Record<string, PolicySeed>;
  now?: () => Date;
};

export function createMockProfilePolicy(options: MockPolicyOptions = {}): ProfilePolicySource {
  const seed = options.seed ?? defaultPolicySeed();
  const now = options.now ?? (() => new Date());
  const profiles = new Map<string, ProfileState>();
  let sequence = 0;

  function state(profileId: string): ProfileState {
    let current = profiles.get(profileId);
    if (!current) {
      const initial = structuredClone(seed[profileId]);
      current = {
        controls: new Map((initial?.domainControls ?? []).map((item) => [item.domain, { ...item, deleted: false }])),
        relations: new Map((initial?.actorPolicies ?? []).map((item) => [item.id, item])),
        following: initial?.following ?? [],
        followers: initial?.followers ?? [],
      };
      profiles.set(profileId, current);
    }
    return current;
  }

  function normalized(domain: string): string {
    const result = canonicalDomain(domain);
    if ("error" in result) throw new PolicyError("INVALID_DOMAIN", "Malformed domain", 422);
    return result.domain;
  }

  function detach(profile: ProfileState, matches: (actorUrl: string) => boolean): void {
    profile.following = profile.following.filter((url) => !matches(url));
    profile.followers = profile.followers.filter((url) => !matches(url));
  }

  return {
    mode: "mock",
    async listDomainControls(profileId) {
      return [...state(profileId).controls.values()]
        .filter((item) => !item.deleted)
        .map(({ deleted: _deleted, ...item }) => toDomainControl(item));
    },
    async putDomainControl(profileId, rawDomain, mode, expectedRevision) {
      const profile = state(profileId);
      const domain = normalized(rawDomain);
      const existing = profile.controls.get(domain);
      const live = existing && !existing.deleted ? existing : undefined;
      if (expectedRevision === undefined ? live !== undefined : live === undefined || live.revision !== expectedRevision) {
        throw new PolicyError("REVISION_CONFLICT", "Revision conflict", 409);
      }
      const at = now().toISOString();
      const stored: StoredControl = {
        profile_id: profileId,
        domain,
        mode,
        revision: (existing?.revision ?? 0) + 1,
        created_at: live?.created_at ?? at,
        updated_at: at,
        deleted: false,
      };
      profile.controls.set(domain, stored);
      if (mode === "block") detach(profile, (url) => actorDomain(url) === domain);
      const { deleted: _deleted, ...body } = stored;
      return toDomainControl(body);
    },
    async deleteDomainControl(profileId, rawDomain, expectedRevision) {
      const profile = state(profileId);
      const domain = normalized(rawDomain);
      const existing = profile.controls.get(domain);
      if (!existing || existing.deleted) throw new PolicyError("NOT_FOUND", "Domain control not found", 404);
      if (existing.revision !== expectedRevision) throw new PolicyError("REVISION_CONFLICT", "Revision conflict", 409);
      profile.controls.set(domain, { ...existing, revision: existing.revision + 1, updated_at: now().toISOString(), deleted: true });
    },
    async listActorPolicies(profileId) {
      return [...state(profileId).relations.values()]
        .map(toActorPolicy)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async createActorPolicy(profileId, mode: PolicyMode, target) {
      const profile = state(profileId);
      if (!/^https?:\/\//.test(target)) throw new PolicyError("BAD_REQUEST", "Invalid target", 400);
      if ([...profile.relations.values()].some((item) => item.kind === mode && item.target === target)) {
        throw new PolicyError("ALREADY_EXISTS", "Target already has this setting", 409);
      }
      sequence += 1;
      const body: ProfileRelationResponse = { id: `rel-mock-${sequence}`, profile_id: profileId, kind: mode, target, created_at: now().toISOString() };
      profile.relations.set(body.id, body);
      if (mode === "block") detach(profile, (url) => url === target);
      return toActorPolicy(body);
    },
    async deleteActorPolicy(profileId, mode, id) {
      const profile = state(profileId);
      const existing = profile.relations.get(id);
      if (!existing || existing.kind !== mode) throw new PolicyError("NOT_FOUND", "Setting not found", 404);
      profile.relations.delete(id);
    },
    async followRelations(profileId) {
      const profile = state(profileId);
      return { following: [...profile.following], followers: [...profile.followers] };
    },
  };
}
