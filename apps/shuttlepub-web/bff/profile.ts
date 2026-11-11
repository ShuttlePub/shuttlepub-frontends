// Emumet's current public API integrates Profile fields into owned Account resources.
// id is the integrated Account nanoid, NOT an invented internal Profile nanoid.
// profileId is the Profile nanoid Emumet reports for that Account (AccountResponse.profile_id,
// RX); Profile-scoped Emumet APIs (domain controls, blocks/mutes) are addressed with it. It
// stays inside the BFF: the GraphQL Profile type does not expose it.
import { AuthError } from "./auth-error.ts";
import type { FetchLike, ViewerSession } from "./auth.ts";
import type { ApiMode } from "./rest/client.ts";

export type Profile = { id: string; handle: string; displayName: string; profileId: string };
export type ProfileContext = { activeProfile: Profile | null };
export interface ProfileContextSource {
  readonly mode: ApiMode;
  getProfileContext(): Promise<ProfileContext>;
  availableProfiles(): Promise<Profile[]>;
  selectProfile(id: string): Promise<ProfileContext>;
}
export const profileContextFixture: ProfileContext = {
  activeProfile: { id: "profile-fixture-1", handle: "fixture", displayName: "Fixture Profile", profileId: "pf-fixture-1" },
};
/** Every owned Profile in mock mode; the first is the active one (ui-spec L1 switcher). */
export const availableProfilesFixture: readonly Profile[] = [
  profileContextFixture.activeProfile!,
  { id: "profile-fixture-2", handle: "fixture_dev", displayName: "Fixture Dev", profileId: "pf-fixture-2" },
  { id: "profile-fixture-3", handle: "fixture_art", displayName: "Fixture Art", profileId: "pf-fixture-3" },
];
/** Cookie that remembers the mock selection of one browser (mock mode only). */
export const MOCK_PROFILE_COOKIE = "sp_mock_profile";

export type MockSelection = {
  /** The selection this browser made earlier (cookie value); unknown ids mean the fixture default. */
  selectedId?: string | null;
  /** Called with the new selection so the caller can remember it for this browser only. */
  select?: (id: string) => void;
};

/**
 * Mock selection lives with the browser, not the process: the caller passes the id
 * remembered in this browser's cookie and stores a new one through `select`. Without a
 * cookie the active Profile is the fixture default, so concurrent browser sessions and
 * visual captures (fresh contexts) never see each other's selection.
 */
export function createMockProfileContext(selection: MockSelection = {}): ProfileContextSource {
  let current = availableProfilesFixture.find(profile => profile.id === selection.selectedId)
    ?? profileContextFixture.activeProfile!;
  return {
    mode: "mock",
    async getProfileContext() { return { activeProfile: structuredClone(current) }; },
    async availableProfiles() { return structuredClone([...availableProfilesFixture]); },
    async selectProfile(id) {
      const activeProfile = availableProfilesFixture.find(profile => profile.id === id);
      if (!activeProfile) throw new AuthError("PROFILE_UNAVAILABLE", 403);
      current = activeProfile;
      selection.select?.(id);
      return { activeProfile: structuredClone(activeProfile) };
    },
  };
}

/** The mock selection remembered in a request's cookie, if any. */
export function mockSelectionFrom(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === MOCK_PROFILE_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function mockSelectionCookie(id: string): string {
  return `${MOCK_PROFILE_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`;
}
export type RealProfileDeps = {
  baseUrl: string;
  session: () => Promise<ViewerSession>;
  selected: (session: ViewerSession, id: string) => Promise<void>;
  fetch?: FetchLike;
  invalidated?: () => Promise<void>;
};
export function createRealProfileContext(deps?: RealProfileDeps): ProfileContextSource {
  let list: Promise<Profile[]> | undefined;
  const session = async () => {
    if (!deps) throw new AuthError("UNAUTHENTICATED", 401);
    return deps.session();
  };
  async function load(): Promise<Profile[]> {
    const viewer = await session();
    const fetcher = deps!.fetch ?? fetch;
    const profiles: Profile[] = [];
    const ids = new Set<string>();
    let cursor: string | undefined;
    // Exhaust the owner's list, never use public ID lookups as proof of ownership.
    for (let page = 0; page < 100; page++) {
      const url = new URL(deps!.baseUrl + "/api/v1/accounts");
      url.searchParams.set("limit", "100");
      // Emumet's runtime accepts next/prev (its route annotation still says asc/desc).
      url.searchParams.set("direction", "next");
      if (cursor) url.searchParams.set("cursor", cursor);
      let response: Response;
      try {
        response = await fetcher(url, { headers: { Authorization: "Bearer " + viewer.accessToken, Accept: "application/json" },
          redirect: "manual", signal: AbortSignal.timeout(10_000) });
      } catch { throw new AuthError("UPSTREAM_UNAVAILABLE", 502); }
      if (response.status === 401) {
        await deps!.invalidated?.();
        throw new AuthError("UNAUTHENTICATED", 401);
      }
      if (response.status === 403) throw new AuthError("FORBIDDEN", 403);
      if (!response.ok) throw new AuthError("UPSTREAM_UNAVAILABLE", 502);
      let data: { items?: unknown; last?: unknown };
      try { data = await response.json(); } catch { throw new AuthError("INVALID_UPSTREAM_RESPONSE", 502); }
      if (!data || !Array.isArray(data.items)) throw new AuthError("INVALID_UPSTREAM_RESPONSE", 502);
      for (const item of data.items) {
        if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name ||
          !(item.display_name === null || typeof item.display_name === "string") || !Object.hasOwn(item, "moderation") ||
          typeof item.profile_id !== "string" || !item.profile_id) {
          throw new AuthError("INVALID_UPSTREAM_RESPONSE", 502);
        }
        // An owned account is not necessarily allowed to act; do not promote moderated identities.
        if (item.moderation !== null) throw new AuthError("FORBIDDEN", 403);
        ids.add(item.id);
        profiles.push({ id: item.id, handle: item.name, displayName: item.display_name ?? item.name, profileId: item.profile_id });
      }
      if (data.items.length < 100) return profiles;
      if (typeof data.last !== "string" || data.last !== profiles.at(-1)?.id || data.last === cursor) {
        throw new AuthError("INVALID_UPSTREAM_RESPONSE", 502);
      }
      cursor = data.last;
    }
    throw new AuthError("INVALID_UPSTREAM_RESPONSE", 502);
  }
  const available = () => list ??= load();
  return {
    mode: "real",
    availableProfiles: available,
    async getProfileContext() {
      const viewer = await session();
      // Even an unselected context requires a successful authenticated Emumet read.
      const profiles = await available();
      if (!viewer.activeProfileId) return { activeProfile: null };
      const activeProfile = profiles.find(profile => profile.id === viewer.activeProfileId);
      if (!activeProfile) throw new AuthError("PROFILE_UNAVAILABLE", 403);
      return { activeProfile };
    },
    async selectProfile(id) {
      const viewer = await session();
      const activeProfile = (await available()).find(profile => profile.id === id);
      if (!activeProfile) throw new AuthError("PROFILE_UNAVAILABLE", 403);
      await deps!.selected(viewer, id);
      return { activeProfile };
    },
  };
}
