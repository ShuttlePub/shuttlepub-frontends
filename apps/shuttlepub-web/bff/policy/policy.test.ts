import { describe, expect, test } from "bun:test";
import { createGraphqlHandler } from "../server.ts";
import { AuthError } from "../auth-error.ts";
import type { ViewerSession } from "../auth.ts";
import { emumetContract } from "../openapi/contract.ts";
import type { ProfileContextSource } from "../profile.ts";
import { createMockApi } from "../rest/mock.ts";
import { canonicalDomain, checkDomainInput, ownActorDomain } from "./domain.ts";
import { fakeEmumetFetch } from "./fake-emumet.ts";
import { defaultPolicySeed, MOCK_PROFILE_ID } from "./fixtures.ts";
import { createMockProfilePolicy } from "./mock.ts";
import { createRealProfilePolicy } from "./real.ts";
import { PolicyError, type ProfilePolicySource } from "./source.ts";

const P = "profile-a";
const Q = "profile-b";

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyError);
    expect((error as PolicyError).code).toBe(code as PolicyError["code"]);
    return;
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

describe("domain input normalization (ui-spec 1-4)", () => {
  const self = ["shuttle.example"];
  const accepted: [string, string][] = [
    ["example.social", "example.social"],
    ["https://Example.social/@alice", "example.social"],
    ["http://example.social:8443/path?q=1#x", "example.social"],
    ["@alice@Example.Social", "example.social"],
    ["alice@example.social", "example.social"],
    ["acct:alice@example.social", "example.social"],
    ["example.social/users/alice", "example.social"],
    ["example.social:443", "example.social"],
    ["EXAMPLE.SOCIAL.", "example.social"],
    ["www.example.social", "www.example.social"],
    ["bücher.example", "xn--bcher-kva.example"],
    ["faß.example", "xn--fa-hia.example"],
    ["ＥＸＡＭＰＬＥ．social", "example.social"],
    ["  sub.example.social  ", "sub.example.social"],
  ];
  for (const [input, domain] of accepted) {
    test(`${JSON.stringify(input)} -> ${domain}`, () => expect(checkDomainInput(input, self)).toEqual({ domain }));
  }
  const refused: [string, string][] = [
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["*.example.social", "WILDCARD"],
    ["127.0.0.1", "IP_ADDRESS"],
    ["127.1", "IP_ADDRESS"],
    ["0x7f000001", "IP_ADDRESS"],
    ["[::1]", "IP_ADDRESS"],
    ["https://[::1]/x", "IP_ADDRESS"],
    ["example", "INVALID"],
    ["example..social", "INVALID"],
    ["example.social..", "INVALID"],
    ["exa mple.social", "INVALID"],
    ["-bad.example", "INVALID"],
    ["shuttle.example", "OWN_SERVER"],
    ["https://Shuttle.Example/@me", "OWN_SERVER"],
  ];
  for (const [input, error] of refused) {
    test(`${JSON.stringify(input)} is refused as ${error}`, () => expect(checkDomainInput(input, self)).toEqual({ error } as never));
  }
  test("our own actor domain comes from the public host without its port", () => {
    expect(ownActorDomain("Emumet.Example.com:8443")).toBe("emumet.example.com");
    expect(ownActorDomain("shuttle.example")).toBe("shuttle.example");
    expect(ownActorDomain("127.0.0.1:8080")).toBeNull();
  });
  test("Emumet's canonical form keeps one trailing dot rule and rejects URL syntax with 422 semantics", () => {
    expect(canonicalDomain("Example.COM.")).toEqual({ domain: "example.com" });
    expect(canonicalDomain("example.com..")).toEqual({ error: "INVALID" });
    expect(canonicalDomain("https://example.com")).toEqual({ error: "INVALID" });
    expect(canonicalDomain("a_b.example")).toEqual({ domain: "a_b.example" });
    expect(canonicalDomain("2130706433")).toEqual({ error: "IP_ADDRESS" });
  });
});

describe("mock seed matches the pinned Emumet contract", () => {
  const seed = defaultPolicySeed()[MOCK_PROFILE_ID]!;
  test("domain controls and actor policies are valid Emumet responses", () => {
    expect(emumetContract.violationsForResponse(
      { path: "/api/v1/profiles/{profile_nanoid}/domain-controls", method: "get", status: "200" }, { items: seed.domainControls },
    )).toEqual([]);
    expect(emumetContract.violationsForResponse(
      { path: "/api/v1/profiles/{profile_nanoid}/blocks", method: "get", status: "200" }, { items: seed.actorPolicies },
    )).toEqual([]);
  });
});

describe("stateful mock (E8/D8P/D8R semantics)", () => {
  const seed = { [P]: { domainControls: [], actorPolicies: [], following: [
    "https://example.social/users/alice", "https://sub.example.social/users/ren", "https://other.example/users/ken",
  ], followers: ["https://example.social/users/hana", "https://EXAMPLE.social:8443/users/mint"] } };
  const fresh = () => createMockProfilePolicy({ seed });

  test("revisions start at 1, conflicts are 409, delete needs the current revision and leaves a tombstone", async () => {
    const policy = fresh();
    const created = await policy.putDomainControl(P, "Example.Social.", "mute");
    expect(created).toMatchObject({ domain: "example.social", mode: "mute", revision: 1 });
    await rejects(policy.putDomainControl(P, "example.social", "block"), "REVISION_CONFLICT");
    await rejects(policy.putDomainControl(P, "example.social", "block", 7), "REVISION_CONFLICT");
    const replaced = await policy.putDomainControl(P, "example.social", "block", 1);
    expect(replaced.revision).toBe(2);
    await rejects(policy.deleteDomainControl(P, "example.social", 1), "REVISION_CONFLICT");
    await policy.deleteDomainControl(P, "example.social", 2);
    await rejects(policy.deleteDomainControl(P, "example.social", 3), "NOT_FOUND");
    await rejects(policy.putDomainControl(P, "example.social", "mute", 2), "REVISION_CONFLICT");
    const recreated = await policy.putDomainControl(P, "example.social", "mute");
    expect(recreated.revision).toBe(4);
    await rejects(policy.putDomainControl(P, "*.example.social", "mute"), "INVALID_DOMAIN");
  });

  test("double submit cannot apply twice: the second identical write is a conflict", async () => {
    const policy = fresh();
    const results = await Promise.allSettled([policy.putDomainControl(P, "example.social", "mute"), policy.putDomainControl(P, "example.social", "mute")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await policy.listDomainControls(P)).toHaveLength(1);
  });

  test("a block detaches only exact-domain follows, both directions, and removing it restores nothing", async () => {
    const policy = fresh();
    await policy.putDomainControl(P, "example.social", "mute");
    expect((await policy.followRelations(P)).following).toHaveLength(3);
    const block = await policy.putDomainControl(P, "example.social", "block", 1);
    expect(await policy.followRelations(P)).toEqual({
      following: ["https://sub.example.social/users/ren", "https://other.example/users/ken"],
      followers: [],
    });
    await policy.deleteDomainControl(P, "example.social", block.revision);
    expect(await policy.followRelations(P)).toEqual({
      following: ["https://sub.example.social/users/ren", "https://other.example/users/ken"],
      followers: [],
    });
  });

  test("settings are per Profile", async () => {
    const policy = fresh();
    await policy.putDomainControl(P, "example.social", "block");
    expect(await policy.listDomainControls(Q)).toEqual([]);
    await policy.putDomainControl(Q, "example.social", "mute");
    expect((await policy.listDomainControls(P))[0]).toMatchObject({ mode: "block", revision: 1 });
    expect((await policy.listDomainControls(Q))[0]).toMatchObject({ mode: "mute", revision: 1 });
  });
});

function session(token: string): () => Promise<ViewerSession> {
  return async () => ({ v: 1, sub: "user", accessToken: token, tokenType: "Bearer", scope: "openid", expiresAt: 0, sessionExpiresAt: 0 } as ViewerSession);
}

describe("real adapter against Emumet wire format", () => {
  function setup() {
    const backing = createMockProfilePolicy({ seed: defaultPolicySeed() });
    const log: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
    const real = createRealProfilePolicy({
      baseUrl: "https://emumet.example/",
      session: session("token-owner"),
      fetch: fakeEmumetFetch({ policy: backing, owners: { "token-owner": [MOCK_PROFILE_ID] }, log }) as never,
    });
    return { real, log };
  }

  test("reads and writes through the documented operations with only the BFF's Bearer token", async () => {
    const { real, log } = setup();
    expect((await real.listDomainControls(MOCK_PROFILE_ID)).map((item) => item.domain)).toContain("bot-farm.example");
    const created = await real.putDomainControl(MOCK_PROFILE_ID, "bücher.example", "mute");
    expect(created).toMatchObject({ domain: "xn--bcher-kva.example", revision: 1 });
    await real.deleteDomainControl(MOCK_PROFILE_ID, created.domain, created.revision);
    const put = log.find((entry) => entry.method === "PUT")!;
    expect(put.url.pathname).toBe(`/api/v1/profiles/${MOCK_PROFILE_ID}/domain-controls/b%C3%BCcher.example`);
    expect(put.body).toEqual({ mode: "mute" });
    const del = log.find((entry) => entry.method === "DELETE")!;
    expect(del.url.searchParams.get("expected_revision")).toBe("1");
    for (const entry of log) {
      expect(entry.headers.get("authorization")).toBe("Bearer token-owner");
      expect(entry.headers.get("cookie")).toBeNull();
    }
    const actors = await real.listActorPolicies(MOCK_PROFILE_ID);
    expect(actors.map((item) => item.mode)).toContain("block");
    const relations = await real.followRelations(MOCK_PROFILE_ID);
    expect(relations.following.length).toBeGreaterThan(0);
  });

  test("target_actor (Emumet #106) is kept in full for the list and the create answer alike; nothing is derived or invented", async () => {
    const full = { kind: "local", actor_url: "https://shuttle.example/users/ren", status: "resolved", display_name: "Ren", icon_url: "https://shuttle.example/i/ren.png", acct: "ren@shuttle.example", preferred_username: "ren", profile_id: "pf-ren" };
    const sparse = { kind: "remote", actor_url: "https://far.example/users/x", status: "pending" };
    const failed = { kind: "remote", actor_url: "https://gone.example/users/y", status: "unavailable", display_name: null, icon_url: null, acct: null };
    const wire = (id: string, kind: string, target_actor: { actor_url: string }) =>
      ({ id, profile_id: P, kind, target: target_actor.actor_url, created_at: "2025-01-01T00:00:00Z", target_actor });
    const real = createRealProfilePolicy({
      baseUrl: "https://emumet.example", session: session("t"),
      fetch: (async (url: URL, init?: RequestInit) => {
        if (init?.method === "POST") return Response.json(wire("created", "block", sparse), { status: 201 });
        return url.pathname.endsWith("/blocks")
          ? Response.json({ items: [wire("full", "block", full), wire("failed", "block", failed)] })
          : Response.json({ items: [wire("sparse", "mute", sparse)] });
      }) as never,
    });
    const list = await real.listActorPolicies(P);
    const byId = (id: string) => list.find((item) => item.id === id)!;
    expect(byId("full").targetActor).toEqual({
      kind: "local", actorUrl: "https://shuttle.example/users/ren", status: "resolved", displayName: "Ren",
      iconUrl: "https://shuttle.example/i/ren.png", acct: "ren@shuttle.example", preferredUsername: "ren", profileId: "pf-ren",
    });
    expect(byId("sparse").targetActor).toEqual({
      kind: "remote", actorUrl: "https://far.example/users/x", status: "pending",
      displayName: null, iconUrl: null, acct: null, preferredUsername: null, profileId: null,
    });
    expect(byId("failed").targetActor).toMatchObject({ status: "unavailable", displayName: null, acct: null });
    const created = await real.createActorPolicy(P, "block", "https://far.example/users/x");
    expect(created.targetActor).toEqual(byId("sparse").targetActor);
  });

  test("a relation answer without target_actor violates the pinned contract and is rejected", async () => {
    const real = createRealProfilePolicy({
      baseUrl: "https://emumet.example", session: session("t"),
      fetch: (async () => Response.json({ items: [{ id: "a", profile_id: P, kind: "block", target: "https://x.example/users/a", created_at: "2025-01-01T00:00:00Z" }] })) as never,
    });
    await rejects(real.listActorPolicies(P), "INVALID_UPSTREAM_RESPONSE");
  });

  test("Profile ownership is Emumet's: another owner's Profile is 403, never data", async () => {
    const { real } = setup();
    await rejects(real.listDomainControls("someone-else"), "FORBIDDEN");
  });

  const statuses: [number, string][] = [
    [400, "BAD_REQUEST"], [401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "REVISION_CONFLICT"],
    [422, "INVALID_DOMAIN"], [500, "UPSTREAM_ERROR"], [501, "NOT_IMPLEMENTED"], [302, "UPSTREAM_ERROR"],
  ];
  for (const [status, code] of statuses) {
    test(`HTTP ${status} is ${code}, not success`, async () => {
      let invalidated = false;
      const real = createRealProfilePolicy({
        baseUrl: "https://emumet.example", session: session("t"),
        fetch: (async () => new Response(JSON.stringify({ secret: "BODY" }), { status })) as never,
        invalidated: async () => { invalidated = true; },
      });
      await rejects(real.putDomainControl(P, "example.social", "mute", 1), code);
      expect(invalidated).toBe(status === 401);
    });
  }

  test("contract violations, another Profile's settings and unreachable Emumet are errors", async () => {
    const respond = (body: unknown, status = 200) => createRealProfilePolicy({
      baseUrl: "https://emumet.example", session: session("t"), fetch: (async () => Response.json(body, { status })) as never,
    });
    await rejects(respond({ items: [{ domain: "x" }] }).listDomainControls(P), "INVALID_UPSTREAM_RESPONSE");
    const foreign = { profile_id: Q, domain: "example.social", mode: "block", revision: 1, created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" };
    await rejects(respond({ items: [foreign] }).listDomainControls(P), "INVALID_UPSTREAM_RESPONSE");
    await rejects(respond(foreign).putDomainControl(P, "example.social", "block"), "INVALID_UPSTREAM_RESPONSE");
    await rejects(respond({ ...foreign, profile_id: P, mode: "mute" }).putDomainControl(P, "example.social", "block"), "INVALID_UPSTREAM_RESPONSE");
    await rejects(respond({ items: [] }, 201).listDomainControls(P), "INVALID_UPSTREAM_RESPONSE");
    const down = createRealProfilePolicy({ baseUrl: "https://emumet.example", session: session("t"), fetch: (async () => { throw new Error("ECONNREFUSED"); }) as never });
    await rejects(down.listDomainControls(P), "UPSTREAM_UNAVAILABLE");
  });

  test("POST of an existing individual block is ALREADY_EXISTS; list pages are exhausted and cursor loops rejected", async () => {
    const conflict = createRealProfilePolicy({ baseUrl: "https://emumet.example", session: session("t"), fetch: (async () => new Response(null, { status: 409 })) as never });
    await rejects(conflict.createActorPolicy(P, "block", "https://x.example/users/a"), "ALREADY_EXISTS");
    const relation = (id: string) => ({
      id, profile_id: P, kind: "block", target: `https://x.example/users/${id}`, created_at: "2025-01-01T00:00:00Z",
      target_actor: { kind: "remote", actor_url: `https://x.example/users/${id}`, status: "pending" },
    });
    let loop = false;
    const cursors: (string | null)[] = [];
    const paged = createRealProfilePolicy({
      baseUrl: "https://emumet.example", session: session("t"),
      fetch: (async (url: URL) => {
        const cursor = url.searchParams.get("cursor");
        cursors.push(cursor);
        if (url.pathname.endsWith("/mutes")) return Response.json({ items: [] });
        if (cursor === null || loop) return Response.json({ items: [relation("a")], next_cursor: "c1" });
        return Response.json({ items: [relation("b")], next_cursor: null });
      }) as never,
    });
    expect((await paged.listActorPolicies(P)).map((item) => item.id).sort()).toEqual(["a", "b"]);
    loop = true;
    await rejects(paged.listActorPolicies(P), "INVALID_UPSTREAM_RESPONSE");
  });
});

describe("GraphQL policy API", () => {
  const profileOf = (id: string, profileId: string) => ({ id, handle: id, displayName: id, profileId });
  function app(options: { policy?: ProfilePolicySource; active?: ReturnType<typeof profileOf> | null; selfDomains?: readonly string[] | null } = {}) {
    let active = options.active === undefined ? profileOf("account-a", P) : options.active;
    // The session-backed (real) selection check: the shown Profile must be the selected one.
    const profiles: ProfileContextSource = {
      mode: "real",
      async getProfileContext() { return { activeProfile: active }; },
      async availableProfiles() { return active ? [active] : []; },
      async selectProfile() { return { activeProfile: active }; },
    };
    const policy = options.policy ?? createMockProfilePolicy({ seed: { [P]: { domainControls: [], actorPolicies: [], following: ["https://example.social/users/alice", "https://example.social/users/bob", "https://sub.example.social/users/c"], followers: ["https://example.social/users/alice", "https://example.social/users/hana"] } } });
    const handler = createGraphqlHandler({ api: createMockApi(), profiles, policy, viewerAuth: async () => ({ accessToken: undefined }),
      selfDomains: options.selfDomains === undefined ? ["shuttle.example"] : options.selfDomains });
    const run = async (query: string, variables: Record<string, unknown> = {}) => {
      const response = await handler(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }));
      return await response.json() as { data?: Record<string, unknown> | null; errors?: { extensions?: { code?: string } }[] };
    };
    return { run, switchTo: (next: ReturnType<typeof profileOf> | null) => { active = next; } };
  }
  const SET = "mutation($p: ID!, $d: String!, $m: PolicyMode!, $r: Int) { setDomainControl(profile: $p, domain: $d, mode: $m, expectedRevision: $r) { domain mode revision createdAt } }";
  const LIST = "query($p: ID!) { domainControls(profile: $p) { domain mode revision } }";

  test("create, list, replace with revision, conflict and remove", async () => {
    const { run } = app();
    const created = await run(SET, { p: "account-a", d: "Example.Social", m: "MUTE" });
    expect(created.data!.setDomainControl).toMatchObject({ domain: "example.social", mode: "MUTE", revision: 1 });
    expect((await run(SET, { p: "account-a", d: "example.social", m: "BLOCK" })).errors![0]!.extensions!.code).toBe("REVISION_CONFLICT");
    expect((await run(SET, { p: "account-a", d: "example.social", m: "BLOCK", r: 1 })).data!.setDomainControl).toMatchObject({ mode: "BLOCK", revision: 2 });
    expect((await run(LIST, { p: "account-a" })).data!.domainControls).toEqual([{ domain: "example.social", mode: "BLOCK", revision: 2 }]);
    const stale = await run("mutation($p: ID!) { removeDomainControl(profile: $p, domain: \"example.social\", expectedRevision: 1) { key } }", { p: "account-a" });
    expect(stale.errors![0]!.extensions!.code).toBe("REVISION_CONFLICT");
    const removed = await run("mutation($p: ID!) { removeDomainControl(profile: $p, domain: \"example.social\", expectedRevision: 2) { key } }", { p: "account-a" });
    expect(removed.data!.removeDomainControl).toEqual({ key: "example.social" });
    expect((await run(LIST, { p: "account-a" })).data!.domainControls).toEqual([]);
  });

  test("block impact counts exact-domain follows; after the block nothing is left to detach and unblocking restores nothing", async () => {
    const { run } = app();
    const IMPACT = "query($p: ID!) { domainBlockImpact(profile: $p, domain: \"EXAMPLE.social\") { domain following followers } }";
    expect((await run(IMPACT, { p: "account-a" })).data!.domainBlockImpact).toEqual({
      domain: "example.social",
      following: ["https://example.social/users/alice", "https://example.social/users/bob"],
      followers: ["https://example.social/users/alice", "https://example.social/users/hana"],
    });
    await run(SET, { p: "account-a", d: "example.social", m: "BLOCK" });
    await run("mutation($p: ID!) { removeDomainControl(profile: $p, domain: \"example.social\", expectedRevision: 1) { key } }", { p: "account-a" });
    expect((await run(IMPACT, { p: "account-a" })).data!.domainBlockImpact).toEqual({ domain: "example.social", following: [], followers: [] });
  });

  test("a Profile switch between render and write is refused instead of writing to the other Profile", async () => {
    const { run, switchTo } = app();
    await run(SET, { p: "account-a", d: "example.social", m: "BLOCK" });
    switchTo(profileOf("account-b", Q));
    expect((await run(LIST, { p: "account-a" })).errors![0]!.extensions!.code).toBe("PROFILE_CHANGED");
    expect((await run(SET, { p: "account-a", d: "other.example", m: "MUTE" })).errors![0]!.extensions!.code).toBe("PROFILE_CHANGED");
    expect((await run(LIST, { p: "account-b" })).data!.domainControls).toEqual([]);
    switchTo(null);
    expect((await run(LIST, { p: "account-a" })).errors![0]!.extensions!.code).toBe("PROFILE_REQUIRED");
  });

  test("an expired session keeps its reason, so the page can say 'log in again'", async () => {
    const expired = createRealProfilePolicy({ baseUrl: "http://emumet.test", session: () => Promise.reject(new AuthError("UNAUTHENTICATED", 401, "SESSION_EXPIRED")) });
    const { run } = app({ policy: expired });
    expect((await run(LIST, { p: "account-a" })).errors![0]!.extensions).toMatchObject({ code: "UNAUTHENTICATED", reason: "SESSION_EXPIRED" });
  });

  test("checkDomainInput normalizes or explains, and never writes", async () => {
    const { run } = app();
    const check = async (input: string) => (await run("query($i: String!) { checkDomainInput(input: $i) { domain error } }", { i: input })).data!.checkDomainInput;
    expect(await check("https://Example.social/@alice")).toEqual({ domain: "example.social", error: null });
    expect(await check("*.example.social")).toEqual({ domain: null, error: "WILDCARD" });
    expect(await check("shuttle.example")).toEqual({ domain: null, error: "OWN_SERVER" });
    expect((await run(LIST, { p: "account-a" })).data!.domainControls).toEqual([]);
  });

  test("our own actor domain is refused on input and on the write itself; unconfigured refuses both", async () => {
    const { run } = app();
    expect((await run(SET, { p: "account-a", d: "Shuttle.Example.", m: "BLOCK" })).errors![0]!.extensions!.code).toBe("OWN_SERVER");
    expect((await run(LIST, { p: "account-a" })).data!.domainControls).toEqual([]);
    expect((await run(SET, { p: "account-a", d: "sub.shuttle.example", m: "MUTE" })).data!.setDomainControl).toMatchObject({ domain: "sub.shuttle.example" });
    const unconfigured = app({ selfDomains: null });
    const check = await unconfigured.run("query($i: String!) { checkDomainInput(input: $i) { domain error } }", { i: "example.social" });
    expect(check.errors![0]!.extensions!.code).toBe("INSTANCE_HOST_NOT_CONFIGURED");
    expect((await unconfigured.run(SET, { p: "account-a", d: "example.social", m: "MUTE" })).errors![0]!.extensions!.code).toBe("INSTANCE_HOST_NOT_CONFIGURED");
  });

  test("individual mutes/blocks: list, remove and re-add (undo)", async () => {
    const seeded = createMockProfilePolicy({ seed: { [P]: { ...defaultPolicySeed()[MOCK_PROFILE_ID]!, actorPolicies: defaultPolicySeed()[MOCK_PROFILE_ID]!.actorPolicies.map((item) => ({ ...item, profile_id: P })) } } });
    const { run } = app({ policy: seeded });
    const list = async () => (await run("query($p: ID!) { actorPolicies(profile: $p) { id mode actorUrl } }", { p: "account-a" })).data!.actorPolicies as { id: string; mode: string; actorUrl: string }[];
    const before = await list();
    expect(before).toHaveLength(4);
    // list and create answers both carry the target's display information (#106).
    const TARGET = "targetActor { kind actorUrl status displayName iconUrl acct preferredUsername profileId }";
    const listed = (await run(`query($p: ID!) { actorPolicies(profile: $p) { actorUrl ${TARGET} } }`, { p: "account-a" })).data!.actorPolicies as { actorUrl: string; targetActor: Record<string, unknown> }[];
    expect(listed.find((item) => item.actorUrl.endsWith("/loud"))!.targetActor).toEqual({
      kind: "REMOTE", actorUrl: "https://chat.example/users/loud", status: "RESOLVED", displayName: "Loud", iconUrl: null, acct: "loud@chat.example", preferredUsername: "loud", profileId: null,
    });
    expect(listed.find((item) => item.actorUrl.endsWith("/ad_bot"))!.targetActor).toMatchObject({ status: "PENDING", displayName: null, acct: null });
    expect(listed.find((item) => item.actorUrl.endsWith("/spoiler"))!.targetActor).toMatchObject({ status: "UNAVAILABLE" });

    const loud = before.find((item) => item.actorUrl.endsWith("/loud"))!;
    expect((await run("mutation($p: ID!, $id: ID!) { removeActorPolicy(profile: $p, id: $id, mode: MUTE) { key } }", { p: "account-a", id: loud.id })).data).toEqual({ removeActorPolicy: { key: loud.id } });
    expect((await list()).some((item) => item.id === loud.id)).toBe(false);
    const undo = await run("mutation($p: ID!, $a: String!) { addActorPolicy(profile: $p, actorUrl: $a, mode: MUTE) { mode actorUrl } }", { p: "account-a", a: loud.actorUrl });
    expect(undo.data!.addActorPolicy).toEqual({ mode: "MUTE", actorUrl: loud.actorUrl });
    expect((await run("mutation($p: ID!, $a: String!) { addActorPolicy(profile: $p, actorUrl: $a, mode: MUTE) { mode } }", { p: "account-a", a: loud.actorUrl })).errors![0]!.extensions!.code).toBe("ALREADY_EXISTS");
    const created = await run(`mutation($p: ID!, $a: String!) { addActorPolicy(profile: $p, actorUrl: $a, mode: BLOCK) { ${TARGET} } }`, { p: "account-a", a: "https://never-seen.example/users/z" });
    expect(created.data!.addActorPolicy).toEqual({ targetActor: {
      kind: "REMOTE", actorUrl: "https://never-seen.example/users/z", status: "PENDING", displayName: null, iconUrl: null, acct: null, preferredUsername: null, profileId: null,
    } });
  });

  test("real mode errors keep their code through GraphQL", async () => {
    const policy = createRealProfilePolicy({ baseUrl: "https://emumet.example", session: session("t"), fetch: (async () => new Response(null, { status: 501 })) as never });
    const { run } = app({ policy });
    const result = await run(LIST, { p: "account-a" });
    expect(result.data).toBeNull();
    expect(result.errors![0]!.extensions!.code).toBe("NOT_IMPLEMENTED");
  });
});
