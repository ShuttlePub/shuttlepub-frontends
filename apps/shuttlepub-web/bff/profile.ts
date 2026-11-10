// Profile context: the Profile the viewer is currently acting as.
//
// The shapes are owned by this app (bff/schema.graphql: Profile / ProfileContext);
// the pinned OpenAPI schema has no profile endpoint yet, so these fixtures are NOT
// contract-checked against it. Real identity arrives with the auth unit (FA).

import { ShuttlePubApiError, type ApiMode } from "./rest/client.ts";

export type Profile = {
  id: string;
  handle: string;
  displayName: string;
};

export type ProfileContext = {
  activeProfile: Profile | null;
};

export interface ProfileContextSource {
  readonly mode: ApiMode;
  getProfileContext(): Promise<ProfileContext>;
}

export const profileContextFixture: ProfileContext = {
  activeProfile: { id: "profile-fixture-1", handle: "fixture", displayName: "Fixture Profile" },
};

export function createMockProfileContext(): ProfileContextSource {
  return {
    mode: "mock",
    async getProfileContext() {
      return structuredClone(profileContextFixture);
    },
  };
}

/** Real identity needs authentication, which F0 does not implement: say so, do not invent a profile. */
export function createRealProfileContext(): ProfileContextSource {
  return {
    mode: "real",
    async getProfileContext() {
      throw new ShuttlePubApiError(
        "not_implemented",
        "Profile context requires authentication, which is not implemented yet",
      );
    },
  };
}
