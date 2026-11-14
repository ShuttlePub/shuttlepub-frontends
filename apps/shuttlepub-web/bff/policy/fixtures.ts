// Seed data for the stateful Profile mute/block mock (SHUTTLEPUB_API_MODE=mock).
//
// Bodies are written in Emumet's wire format and policy.test.ts validates every one of
// them against the pinned Emumet OpenAPI (openapi/emumet.json), so the mock cannot drift
// from the contract the real adapter checks. The values mirror the agreed D08 v5 mock.

import { MOCK_LOCAL_HOST, PEOPLE } from "../rest/post-fixtures.ts";
import type { DomainControlResponse, ProfileRelationActorResponse, ProfileRelationResponse } from "./source.ts";

/** Profile nanoid of the mock Profile context (bff/profile.ts profileContextFixture). */
export const MOCK_PROFILE_ID = "pf-fixture-1";

export type PolicySeed = {
  domainControls: DomainControlResponse[];
  actorPolicies: ProfileRelationResponse[];
  /** Pending/accepted follows of the Profile (canonical actor URLs). */
  following: string[];
  followers: string[];
};

const control = (domain: string, mode: "mute" | "block", date: string): DomainControlResponse => ({
  profile_id: MOCK_PROFILE_ID,
  domain,
  mode,
  revision: 1,
  created_at: `${date}T09:00:00Z`,
  updated_at: `${date}T09:00:00Z`,
});

/**
 * What the mock's server-side cache knows of a target: a known mock person is resolved
 * (local on this mock server, else remote), any other actor has not been fetched yet
 * (`pending`, no name/icon/acct), like a remote target the real list met for the first time.
 */
export function targetActorFor(actorUrl: string): ProfileRelationActorResponse {
  const known = Object.values(PEOPLE).find((person) => person.actorUrl === actorUrl);
  if (known === undefined) return { kind: "remote", actor_url: actorUrl, status: "pending" };
  const [preferredUsername, host] = known.handle.split("@") as [string, string];
  return {
    kind: host === MOCK_LOCAL_HOST ? "local" : "remote",
    actor_url: actorUrl,
    status: "resolved",
    display_name: known.displayName,
    acct: known.handle,
    preferred_username: preferredUsername,
    ...(host === MOCK_LOCAL_HOST ? { profile_id: known.id } : {}),
  };
}

const relation = (id: string, kind: "mute" | "block", target: string, date: string, targetActor: ProfileRelationActorResponse = targetActorFor(target)): ProfileRelationResponse => ({
  id,
  profile_id: MOCK_PROFILE_ID,
  kind,
  target,
  target_actor: targetActor,
  created_at: `${date}T09:00:00Z`,
});

const resolved = (host: string, user: string, displayName: string): ProfileRelationActorResponse => ({
  kind: "remote",
  actor_url: actor(host, user),
  status: "resolved",
  display_name: displayName,
  acct: `${user}@${host}`,
  preferred_username: user,
});

const actor = (host: string, name: string) => `https://${host}/users/${name}`;

export function defaultPolicySeed(): Record<string, PolicySeed> {
  return {
    [MOCK_PROFILE_ID]: {
      domainControls: [
        control("bot-farm.example", "block", "2025-12-20"),
        control("media.example.net", "mute", "2025-12-12"),
        control("noisy.social", "mute", "2025-11-30"),
        control("spam-relay.example", "block", "2025-11-14"),
      ],
      actorPolicies: [
        relation("rel-spam-bot", "block", actor("spam.example", "spam_bot"), "2025-12-18", resolved("spam.example", "spam_bot", "Spam Bot")),
        relation("rel-loud", "mute", actor("chat.example", "loud"), "2025-12-02", resolved("chat.example", "loud", "Loud")),
        relation("rel-ad-bot", "block", actor("ads.example", "ad_bot"), "2025-11-21"),
        relation("rel-spoiler", "mute", actor("anime.example", "spoiler"), "2025-11-03", { kind: "remote", actor_url: actor("anime.example", "spoiler"), status: "unavailable" }),
      ],
      following: [
        actor("example.social", "alice"),
        actor("example.social", "bob_dev"),
        actor("example.social", "kumo"),
        actor("other.example", "hiro"),
        actor("sub.example.social", "ren"),
        actor("noisy.social", "nana"),
      ],
      followers: [
        actor("example.social", "alice"),
        actor("example.social", "hana"),
        actor("example.social", "ryo"),
        actor("example.social", "mint"),
        actor("example.social", "sora"),
        actor("other.example", "ken"),
      ],
    },
  };
}
