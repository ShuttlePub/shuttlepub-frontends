// Test support: an in-process Emumet that speaks the Profile policy REST wire format
// (domain-controls, blocks/mutes, following/followers) on top of the stateful mock, so the
// real adapter (REST -> domain) and the GraphQL layer can be exercised end to end without a
// network. Bearer tokens map to the Profiles they own, like Emumet's owner check.

import { PolicyError, type PolicyMode, type ProfilePolicySource } from "./source.ts";

export type FakeEmumetOptions = {
  policy: ProfilePolicySource;
  /** access token -> Profile nanoids it owns */
  owners: Record<string, string[]>;
  /** Every request seen, for assertions. */
  log?: { method: string; url: URL; headers: Headers; body: unknown }[];
};

const STATUS: Record<string, number> = {
  NOT_FOUND: 404, REVISION_CONFLICT: 409, ALREADY_EXISTS: 409, INVALID_DOMAIN: 422, BAD_REQUEST: 400,
};

export function fakeEmumetFetch(options: FakeEmumetOptions) {
  return async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body));
    options.log?.push({ method, url, headers, body });
    const token = headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token || !(token in options.owners)) return new Response(null, { status: 401 });
    const match = /^\/api\/v1\/profiles\/([^/]+)\/(domain-controls|blocks|mutes|following|followers)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return new Response(null, { status: 404 });
    const profileId = decodeURIComponent(match[1] as string);
    const resource = match[2] as string;
    const key = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
    if (!options.owners[token]!.includes(profileId)) return new Response(null, { status: 403 });
    const { policy } = options;
    try {
      if (resource === "domain-controls") {
        const wire = (control: Awaited<ReturnType<ProfilePolicySource["putDomainControl"]>>) => ({
          profile_id: profileId, domain: control.domain, mode: control.mode, revision: control.revision,
          created_at: control.createdAt, updated_at: control.updatedAt,
        });
        if (key === undefined && method === "GET") return Response.json({ items: (await policy.listDomainControls(profileId)).map(wire) });
        if (key !== undefined && method === "PUT") {
          return Response.json(wire(await policy.putDomainControl(profileId, key, body.mode, body.expected_revision ?? undefined)));
        }
        if (key !== undefined && method === "DELETE") {
          const revision = url.searchParams.get("expected_revision");
          if (revision === null || !/^\d+$/.test(revision)) return new Response(null, { status: 400 });
          await policy.deleteDomainControl(profileId, key, Number(revision));
          return new Response(null, { status: 204 });
        }
      }
      if (resource === "blocks" || resource === "mutes") {
        const mode: PolicyMode = resource === "blocks" ? "block" : "mute";
        const wire = (item: Awaited<ReturnType<ProfilePolicySource["createActorPolicy"]>>) => ({
          id: item.id, profile_id: profileId, kind: item.mode, target: item.actorUrl, created_at: item.createdAt,
          target_actor: {
            kind: item.targetActor.kind, actor_url: item.targetActor.actorUrl, status: item.targetActor.status,
            display_name: item.targetActor.displayName, icon_url: item.targetActor.iconUrl, acct: item.targetActor.acct,
            preferred_username: item.targetActor.preferredUsername, profile_id: item.targetActor.profileId,
          },
        });
        if (key === undefined && method === "GET") {
          return Response.json({ items: (await policy.listActorPolicies(profileId)).filter((item) => item.mode === mode).map(wire), next_cursor: null });
        }
        if (key === undefined && method === "POST") return Response.json(wire(await policy.createActorPolicy(profileId, mode, body.target)), { status: 201 });
        if (key !== undefined && method === "DELETE") {
          await policy.deleteActorPolicy(profileId, mode, key);
          return new Response(null, { status: 204 });
        }
      }
      if ((resource === "following" || resource === "followers") && key === undefined && method === "GET") {
        const relations = await policy.followRelations(profileId);
        const created_at = "2025-10-01T00:00:00Z";
        if (resource === "following") {
          return Response.json({ items: relations.following.map((target, i) => ({ id: `f-${i}`, profile_id: profileId, target, state: "accepted", created_at })) });
        }
        return Response.json({
          items: relations.followers.map((actor_url, i) => ({ id: `r-${i}`, profile_id: profileId, follower: { kind: "remote", actor_url }, state: "accepted", created_at })),
        });
      }
      return new Response(null, { status: 405 });
    } catch (error) {
      if (error instanceof PolicyError) return new Response(null, { status: STATUS[error.code] ?? 500 });
      throw error;
    }
  };
}
