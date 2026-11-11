// ============================================================
// (a) リゾルバ形状テスト — MockEmumetClient 差し込みで Query/Mutation を実行
// (b) UNAUTHENTICATED 分岐 — context.emumet null → extensions.code UNAUTHENTICATED
// ============================================================

import { describe, expect, test } from "bun:test";
import { graphql, type GraphQLSchema } from "graphql";
import { makeSchema } from "./schema.ts";
import { resolvers } from "./resolvers.ts";
import { buildContext, type GraphQLContext } from "./context.ts";
import { createMockEmumetClient } from "./emumet/mock.ts";
import { EmumetApiError, type EmumetClient } from "./emumet/client.ts";
import type { SessionAdapter } from "@shuttlepub/auth-bun";

const schema: GraphQLSchema = makeSchema(resolvers);

// 境界 fake: buildContext の本物の分岐 (fresh → authenticatedContext) を通すための
// 最小 SessionAdapter。DataLoader の遅延メモ化も本物の実装が使われる。
const stubAdapter: SessionAdapter = {
  getSession: () => Promise.resolve({ accessToken: "test-token" }),
  refreshSessionIfNeeded: (session) => Promise.resolve({ kind: "fresh", accessToken: session.accessToken }),
  sealSessionCookie: () => Promise.resolve(""),
  clearSessionCookie: () => "",
};

const nullSessionAdapter: SessionAdapter = {
  ...stubAdapter,
  getSession: () => Promise.resolve(null),
};

async function authenticatedContext(emumet: EmumetClient): Promise<GraphQLContext> {
  return buildContext(new Request("http://localhost/graphql"), {
    adapter: stubAdapter,
    createEmumetClient: () => emumet,
  });
}

async function unauthenticatedContext(): Promise<GraphQLContext> {
  return buildContext(new Request("http://localhost/graphql"), {
    adapter: nullSessionAdapter,
    createEmumetClient: () => createMockEmumetClient(),
  });
}

function run(source: string, context: GraphQLContext) {
  return graphql({ schema, source, contextValue: context });
}

describe("(a) resolvers with MockEmumetClient", () => {
  test("Query.accounts returns connection shape with seed accounts", async () => {
    // Given: mock client seeded with acc_01..03
    const context = await authenticatedContext(createMockEmumetClient());
    // When: accounts query
    const result = await run("{ accounts { items { id name isBot publicKey createdAt moderation { type } } first last } }", context);
    // Then: connection shape, 3 seed items, moderation null
    expect(result.errors).toBeUndefined();
    const accounts = result.data?.accounts as {
      items: { id: string; name: string; isBot: boolean; publicKey: string | null; createdAt: string; moderation: unknown }[];
      first: string | null;
      last: string | null;
    };
    expect(accounts.first).toBeNull();
    expect(accounts.last).toBeNull();
    expect(accounts.items.map((a) => a.id)).toEqual(["acc_01", "acc_02", "acc_03"]);
    expect(accounts.items.map((a) => a.name)).toEqual(["alice", "bob", "bot-news"]);
    expect(accounts.items[2]?.isBot).toBe(true);
    expect(accounts.items[0]?.publicKey).toBeNull();
    expect(accounts.items[0]?.moderation).toBeNull();
  });

  test("Query.account returns account with profile and metadata via DataLoader", async () => {
    // Given: acc_01 has prof_01 and meta_01/meta_02
    const context = await authenticatedContext(createMockEmumetClient());
    // When: nested account query
    const result = await run(
      '{ account(id: "acc_01") { id name profile { nanoid displayName summary } metadata { nanoid label content } } }',
      context,
    );
    // Then: nested profile/metadata resolved
    expect(result.errors).toBeUndefined();
    const account = result.data?.account as {
      id: string;
      profile: { nanoid: string; displayName: string | null; summary: string | null };
      metadata: { nanoid: string; label: string; content: string }[];
    };
    expect(account.id).toBe("acc_01");
    expect(account.profile.nanoid).toBe("prof_01");
    expect(account.profile.displayName).toBe("Alice Wonderland");
    expect(account.metadata.map((m) => m.nanoid)).toEqual(["meta_01", "meta_02"]);
    expect(account.metadata[0]?.label).toBe("Website");
  });

  test("Query.account returns null for unknown id", async () => {
    // Given / When: unknown id
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run('{ account(id: "nope") { id } }', context);
    // Then: null, no errors
    expect(result.errors).toBeUndefined();
    expect(result.data?.account).toBeNull();
  });

  test("Mutation.createAccount returns created account with generated id", async () => {
    // Given / When: createAccount
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run(
      'mutation { createAccount(input: { name: "carol", username: "carol" }) { id name isBot publicKey moderation { type } } }',
      context,
    );
    // Then: id acc_100 (counter starts at 100), isBot defaults false
    expect(result.errors).toBeUndefined();
    const account = result.data?.createAccount as { id: string; name: string; isBot: boolean; publicKey: string | null; moderation: unknown };
    expect(account.id).toBe("acc_100");
    expect(account.name).toBe("carol");
    expect(account.isBot).toBe(false);
    expect(account.publicKey).toBeNull();
    expect(account.moderation).toBeNull();
  });

  test("Mutation.updateProfile updates existing profile (null clears, omitted keeps)", async () => {
    // Given: acc_01 profile with displayName/summary set
    const context = await authenticatedContext(createMockEmumetClient());
    // When: update with summary null (clear) and iconUrl omitted (keep)
    const result = await run(
      'mutation { updateProfile(accountId: "acc_01", input: { displayName: "Alicia", summary: null }) { nanoid displayName summary iconUrl } }',
      context,
    );
    // Then: displayName updated, summary cleared, iconUrl kept, nanoid unchanged
    expect(result.errors).toBeUndefined();
    const profile = result.data?.updateProfile as { nanoid: string; displayName: string | null; summary: string | null; iconUrl: string | null };
    expect(profile.nanoid).toBe("prof_01");
    expect(profile.displayName).toBe("Alicia");
    expect(profile.summary).toBeNull();
    expect(profile.iconUrl).toBe("https://api.dicebear.com/9.x/thumbs/svg?seed=alice");
  });

  test("Mutation.updateProfile creates profile when absent (upsert POST path)", async () => {
    // Given: fresh account without profile
    const emumet = createMockEmumetClient();
    const context = await authenticatedContext(emumet);
    await run('mutation { createAccount(input: { name: "carol", username: "carol" }) { id } }', context);
    // When: updateProfile on the new account
    const result = await run(
      'mutation { updateProfile(accountId: "acc_100", input: { displayName: "Carol" }) { nanoid accountId displayName summary } }',
      context,
    );
    // Then: profile created, unspecified fields null
    expect(result.errors).toBeUndefined();
    const profile = result.data?.updateProfile as { nanoid: string; accountId: string; displayName: string | null; summary: string | null };
    expect(profile.accountId).toBe("acc_100");
    expect(profile.displayName).toBe("Carol");
    expect(profile.summary).toBeNull();
  });

  test("Mutation.createMetadata returns created metadata", async () => {
    // Given / When
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run(
      'mutation { createMetadata(accountId: "acc_02", input: { label: "Blog", content: "https://blog.example.com" }) { nanoid accountId label content } }',
      context,
    );
    // Then
    expect(result.errors).toBeUndefined();
    const metadata = result.data?.createMetadata as { nanoid: string; accountId: string; label: string; content: string };
    expect(metadata.nanoid).toBe("meta_100");
    expect(metadata.accountId).toBe("acc_02");
    expect(metadata.label).toBe("Blog");
    expect(metadata.content).toBe("https://blog.example.com");
  });

  test("Mutation.updateMetadata returns updated metadata", async () => {
    // Given / When: update existing meta_01
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run(
      'mutation { updateMetadata(accountId: "acc_01", nanoid: "meta_01", input: { label: "Web", content: "https://new.example.com" }) { nanoid label content } }',
      context,
    );
    // Then
    expect(result.errors).toBeUndefined();
    const metadata = result.data?.updateMetadata as { nanoid: string; label: string; content: string };
    expect(metadata).toEqual({ nanoid: "meta_01", label: "Web", content: "https://new.example.com" });
  });

  test("Mutation.updateMetadata on missing nanoid maps to NOT_FOUND", async () => {
    // Given / When: missing nanoid
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run(
      'mutation { updateMetadata(accountId: "acc_01", nanoid: "meta_xx", input: { label: "Web", content: "x" }) { nanoid } }',
      context,
    );
    // Then: EmumetNotFoundError → NOT_FOUND (非 null フィールドのため data 全体が null)
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
  });

  test("Mutation.deleteMetadata returns true", async () => {
    // Given / When: delete existing meta_02
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run('mutation { deleteMetadata(accountId: "acc_01", nanoid: "meta_02") }', context);
    // Then
    expect(result.errors).toBeUndefined();
    expect(result.data?.deleteMetadata).toBe(true);
  });

  test("Mutation.deleteMetadata on missing nanoid maps to NOT_FOUND", async () => {
    // Given / When
    const context = await authenticatedContext(createMockEmumetClient());
    const result = await run('mutation { deleteMetadata(accountId: "acc_01", nanoid: "meta_xx") }', context);
    // Then (非 null フィールドのため data 全体が null)
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
  });
});

describe("(b) UNAUTHENTICATED branch", () => {
  test("Query.accounts with null emumet yields UNAUTHENTICATED", async () => {
    // Given: session なし (buildContext → emumet null)
    const context = await unauthenticatedContext();
    // When
    const result = await run("{ accounts { items { id } } }", context);
    // Then: GraphQLError extensions.code UNAUTHENTICATED, data null
    expect(context.emumet).toBeNull();
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  test("Mutation.createAccount with null emumet yields UNAUTHENTICATED", async () => {
    // Given / When
    const context = await unauthenticatedContext();
    const result = await run('mutation { createAccount(input: { name: "x", username: "x" }) { id } }', context);
    // Then
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});

describe("(c) nested field loader error sanitization", () => {
  test("Account.profile sanitizes EmumetApiError to INTERNAL_SERVER_ERROR", async () => {
    // Given: client whose listProfiles throws EmumetApiError with an upstream body
    const throwingClient: EmumetClient = {
      ...createMockEmumetClient(),
      listProfiles: () => Promise.reject(new EmumetApiError(500, "SECRET-UPSTREAM-BODY")),
    };
    const context = await authenticatedContext(throwingClient);
    // When: query with profile sub-field (triggers Account.profile resolver)
    const result = await run('{ account(id: "acc_01") { id profile { nanoid } } }', context);
    // Then: secret body must NOT leak, code must be INTERNAL_SERVER_ERROR
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).not.toContain("SECRET-UPSTREAM-BODY");
    expect(result.errors?.[0]?.message).toBe("Internal server error");
    expect(result.errors?.[0]?.extensions?.code).toBe("INTERNAL_SERVER_ERROR");
  });

  test("Account.metadata sanitizes EmumetApiError to INTERNAL_SERVER_ERROR", async () => {
    // Given: client whose listMetadata throws EmumetApiError with an upstream body
    const throwingClient: EmumetClient = {
      ...createMockEmumetClient(),
      listMetadata: () => Promise.reject(new EmumetApiError(500, "SECRET-UPSTREAM-BODY")),
    };
    const context = await authenticatedContext(throwingClient);
    // When: query with metadata sub-field (triggers Account.metadata resolver)
    const result = await run('{ account(id: "acc_01") { id metadata { nanoid } } }', context);
    // Then: secret body must NOT leak, code must be INTERNAL_SERVER_ERROR
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).not.toContain("SECRET-UPSTREAM-BODY");
    expect(result.errors?.[0]?.message).toBe("Internal server error");
    expect(result.errors?.[0]?.extensions?.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
