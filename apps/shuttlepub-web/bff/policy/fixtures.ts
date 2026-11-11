// Seed data for the stateful Profile mute/block mock (SHUTTLEPUB_API_MODE=mock).
//
// Bodies are written in Emumet's wire format and policy.test.ts validates every one of
// them against the pinned Emumet OpenAPI (openapi/emumet.json), so the mock cannot drift
// from the contract the real adapter checks. The values mirror the agreed D08 v5 mock.

import type { DomainControlResponse, ProfileRelationResponse } from "./source.ts";

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

const relation = (id: string, kind: "mute" | "block", target: string, date: string): ProfileRelationResponse => ({
  id,
  profile_id: MOCK_PROFILE_ID,
  kind,
  target,
  created_at: `${date}T09:00:00Z`,
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
        relation("rel-spam-bot", "block", actor("spam.example", "spam_bot"), "2025-12-18"),
        relation("rel-loud", "mute", actor("chat.example", "loud"), "2025-12-02"),
        relation("rel-ad-bot", "block", actor("ads.example", "ad_bot"), "2025-11-21"),
        relation("rel-spoiler", "mute", actor("anime.example", "spoiler"), "2025-11-03"),
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
