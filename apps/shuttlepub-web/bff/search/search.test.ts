// D04 post search through GraphQL: the mock's behaviour (matching, paging, the time limit, the
// Profile's controls leaving no trace) and the real adapter's refusal to turn any failure into data.

import { describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { loadConfig } from "../config.ts";
import { createMockProfilePolicy } from "../policy/mock.ts";
import { availableProfilesFixture } from "../profile.ts";
import { ShuttlePubApiError } from "../rest/client.ts";
import { PEOPLE } from "../rest/post-fixtures.ts";
import { createRealApi } from "../rest/real.ts";
import { MOCK_TIMEOUT_KEYWORD } from "./fixtures.ts";

type GraphQLResponse = {
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

async function run(app: App, query: string): Promise<GraphQLResponse> {
  const response = await app.handleGraphql(new Request("http://app.test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://app.test" },
    body: JSON.stringify({ query }),
  }));
  return (await response.json()) as GraphQLResponse;
}

const fresh = () => createApp(loadConfig({}), { mockPolicy: createMockProfilePolicy() });
const [A, B] = availableProfilesFixture.map((profile) => profile.id);
const NOTE = "noteId kind authorActorUrl createdAt text contentWarning";
const PAGE = "page { truncated nextCursor }";

type Note = { noteId: string; kind: string; authorActorUrl: string; text: string | null; contentWarning: string | null };
type Search = { notes: Note[]; page: { truncated: boolean; nextCursor: string | null } };

const search = async (app: App, profile: string, args: string) => {
  const result = await run(app, `{ searchNotes(profile: "${profile}", ${args}) { notes { ${NOTE} } ${PAGE} } }`);
  return { result, search: result.data?.searchNotes as Search | undefined };
};

describe("searchNotes (mock)", () => {
  test("a keyword search finds the notes whose body or content warning contain it, newest first", async () => {
    const { result, search: found } = await search(fresh(), A!, `q: "検索"`);
    expect(result.errors).toBeUndefined();
    const texts = found!.notes.map((note) => note.text ?? note.contentWarning);
    expect(texts[0]).toContain("<script>");
    expect(texts).toContain("ネタバレ注意: 検索");
    expect(found!.notes.every((note) => (note.text ?? note.contentWarning)!.includes("検索") || note.text === null)).toBe(true);
    expect(found!.page).toEqual({ truncated: false, nextCursor: null });
  });

  test("a content-warned note exposes the content warning only, never the body", async () => {
    const { search: found } = await search(fresh(), A!, `q: "ネタバレ"`);
    expect(found!.notes).toHaveLength(1);
    expect(found!.notes[0]!.text).toBeNull();
    expect(found!.notes[0]!.contentWarning).toBe("ネタバレ注意: 検索");
    expect(JSON.stringify(found)).not.toContain("本文にも");
  });

  test("HTML-looking text is plain data and a case-insensitive match finds every spelling", async () => {
    const { search: html } = await search(fresh(), A!, `q: "onerror"`);
    expect(html!.notes[0]!.text).toBe("<script>alert(\"検索\")</script> <b>太字</b> &amp; &lt;img src=x onerror=alert(1)&gt; 検索");
    const { search: cased } = await search(fresh(), A!, `q: "SEARCH"`);
    expect(cased!.notes).toHaveLength(1);
    expect(cased!.notes[0]!.text).toContain("Search search SEARCH");
  });

  test("% _ and backslash are literal characters", async () => {
    for (const q of ["%", "_", "\\\\"]) {
      const { search: found } = await search(fresh(), A!, `q: "${q}"`);
      expect(found!.notes).toHaveLength(0);
    }
  });

  test("an author-only search lists that author's notes and the author is the actor URL", async () => {
    const { search: found } = await search(fresh(), A!, `author: "${PEOPLE.sora.actorUrl}", limit: 50`);
    expect(found!.notes.length).toBeGreaterThan(40);
    expect(found!.notes.every((note) => note.authorActorUrl === PEOPLE.sora.actorUrl)).toBe(true);
  });

  test("neither author nor q is INVALID_REQUEST; an unknown author is NOT_FOUND", async () => {
    const none = await search(fresh(), A!, `limit: 5`);
    expect(none.result.errors![0]!.extensions!.code).toBe("INVALID_REQUEST");
    const unknown = await search(fresh(), A!, `author: "https://nowhere.example/users/x"`);
    expect(unknown.result.errors![0]!.extensions!.code).toBe("NOT_FOUND");
  });

  test("pages follow the cursor without gaps or repeats and the last page has no cursor", async () => {
    const app = fresh();
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { search: found } = await search(app, A!, `author: "${PEOPLE.sora.actorUrl}", limit: 15${cursor === null ? "" : `, cursor: "${cursor}"`}`);
      ids.push(...found!.notes.map((note) => note.noteId));
      cursor = found!.page.nextCursor;
      expect(found!.page.truncated).toBe(false);
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(cursor).toBeNull();
  });

  test("a cursor of another search is INVALID_REQUEST", async () => {
    const app = fresh();
    const { search: first } = await search(app, A!, `author: "${PEOPLE.sora.actorUrl}", limit: 5`);
    const other = await search(app, A!, `q: "ZINE", limit: 5, cursor: "${first!.page.nextCursor}"`);
    expect(other.result.errors![0]!.extensions!.code).toBe("INVALID_REQUEST");
    const garbage = await search(app, A!, `author: "${PEOPLE.sora.actorUrl}", cursor: "garbage"`);
    expect(garbage.result.errors![0]!.extensions!.code).toBe("INVALID_REQUEST");
  });

  test("the simulated time limit is a partial 200 whose cursor resumes it", async () => {
    const app = fresh();
    const { search: first } = await search(app, A!, `q: "${MOCK_TIMEOUT_KEYWORD}"`);
    expect(first!.notes).toHaveLength(5);
    expect(first!.page.truncated).toBe(true);
    expect(first!.page.nextCursor).not.toBeNull();
    const { search: second } = await search(app, A!, `q: "${MOCK_TIMEOUT_KEYWORD}", cursor: "${first!.page.nextCursor}"`);
    expect(second!.notes.map((note) => note.noteId).filter((id) => first!.notes.some((note) => note.noteId === id))).toEqual([]);
  });

  test("a muted domain, a blocked domain and an individually muted actor leave no trace; another Profile sees them", async () => {
    const app = fresh();
    const { result, search: found } = await search(app, A!, `q: "検索", limit: 50`);
    expect(result.errors).toBeUndefined();
    const body = JSON.stringify(found);
    expect(body).not.toContain(PEOPLE.nana.actorUrl);
    expect(body).not.toContain("noisy.social");
    expect(body).not.toContain("ミュート中のドメイン");
    expect(body).not.toContain("検索の話を引用します");
    const { search: other } = await search(app, B!, `q: "検索", limit: 50`);
    expect(JSON.stringify(other)).toContain("ミュート中のドメイン");
    expect(other!.notes.length).toBeGreaterThan(found!.notes.length);
    const muted = await search(app, A!, `author: "${PEOPLE.kei.actorUrl}"`);
    expect(muted.search!.notes).toEqual([]);
    expect(muted.search!.page).toEqual({ truncated: false, nextCursor: null });
  });

  test("a Profile that is not shown is refused", async () => {
    const { result } = await search(fresh(), "someone-elses-profile", `q: "検索"`);
    expect(result.errors![0]!.extensions!.code).toBe("PROFILE_UNAVAILABLE");
  });
});

describe("author lookup (mock)", () => {
  const suggest = async (app: App, profile: string, prefix: string) => {
    const result = await run(app, `{ suggestSearchAuthors(profile: "${profile}", prefix: ${JSON.stringify(prefix)}) { actorUrl acct displayName } }`);
    return { result, items: result.data?.suggestSearchAuthors as { actorUrl: string; acct: string; displayName: string | null }[] | undefined };
  };

  test("suggestions are at most five, by name or acct prefix, without muted/blocked authors", async () => {
    const app = fresh();
    const { items } = await suggest(app, A!, "s");
    expect(items!.length).toBeLessThanOrEqual(5);
    expect(items!.some((author) => author.acct === PEOPLE.sora.handle)).toBe(true);
    const { items: byName } = await suggest(app, A!, "あお");
    expect(byName!.map((author) => author.acct)).toEqual([PEOPLE.aoi.handle]);
    const { items: muted } = await suggest(app, A!, "kei");
    expect(muted).toEqual([]);
    const { items: otherProfile } = await suggest(app, B!, "kei");
    expect(otherProfile!.map((author) => author.acct)).toEqual([PEOPLE.kei.handle]);
    expect(JSON.stringify((await suggest(app, A!, "n")).result)).not.toContain("noisy.social");
  });

  test("no avatar URL is part of the GraphQL type", async () => {
    const result = await run(fresh(), `{ suggestSearchAuthors(profile: "${A}", prefix: "mika") { iconUrl } }`);
    expect(result.errors).toBeDefined();
  });

  test("a bad prefix is INVALID_REQUEST", async () => {
    const { result } = await suggest(fresh(), A!, "@");
    expect(result.errors![0]!.extensions!.code).toBe("INVALID_REQUEST");
  });

  const resolve = async (acct: string) => {
    const result = await run(fresh(), `{ resolveSearchAuthor(profile: "${A}", acct: ${JSON.stringify(acct)}) { actorUrl acct displayName } }`);
    return { result, author: result.data?.resolveSearchAuthor as { actorUrl: string; acct: string } | undefined };
  };

  test("a host-less acct and one naming this server resolve to this server's user", async () => {
    expect((await resolve("sora")).author!.actorUrl).toBe(PEOPLE.sora.actorUrl);
    expect((await resolve("@sora@shuttlepub.example")).author!.actorUrl).toBe(PEOPLE.sora.actorUrl);
    expect((await resolve("mika@misskey.example")).author!.actorUrl).toBe(PEOPLE.mika.actorUrl);
  });

  test("an unknown acct is NOT_FOUND, several verified matches are AUTHOR_AMBIGUOUS (not the reaction CONFLICT)", async () => {
    expect((await resolve("nobody")).result.errors![0]!.extensions!.code).toBe("NOT_FOUND");
    expect((await resolve("taro@mstdn.example")).result.errors![0]!.extensions!.code).toBe("NOT_FOUND");
    expect((await resolve("pat@dup.example")).result.errors![0]!.extensions!.code).toBe("AUTHOR_AMBIGUOUS");
    expect((await resolve("a b")).result.errors![0]!.extensions!.code).toBe("INVALID_REQUEST");
  });
});

describe("real adapter (search)", () => {
  const api = (status: number, body: unknown, raw = false) => {
    const requests: Request[] = [];
    return {
      requests,
      api: createRealApi({
        baseUrl: "http://backend.test",
        fetch: async (request) => {
          requests.push(request);
          return new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
        },
      }),
    };
  };
  const viewer = {
    profileId: async () => "pf",
    controls: async () => { throw new Error("real mode never reads the controls"); },
    actorControls: async () => { throw new Error("real mode never reads the controls"); },
    selfDomains: [],
  };
  const fail = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ShuttlePubApiError);
      return error as ShuttlePubApiError;
    }
    throw new Error("expected a failure");
  };
  const NOTE_BODY = { profile_id: "pf", items: [], page: { truncated: false as const } };

  test("sends the documented path, query and Bearer token and returns the 200 body", async () => {
    const { api: real, requests } = api(200, NOTE_BODY);
    expect(await real.searchNotes({ accessToken: "tok" }, "pf", { author: "https://a.example/u/x", q: "a b&c", limit: 7, cursor: "c1" }, viewer)).toEqual(NOTE_BODY);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/v1/profiles/pf/notes/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ author: "https://a.example/u/x", q: "a b&c", limit: "7", cursor: "c1" });
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer tok");
  });

  test("501 is not_implemented and never mock data, for all three operations", async () => {
    for (const call of [
      (real: ReturnType<typeof api>["api"]) => real.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer),
      (real: ReturnType<typeof api>["api"]) => real.resolveSearchAuthor({ accessToken: undefined }, "pf", "a", viewer),
      (real: ReturnType<typeof api>["api"]) => real.suggestSearchAuthors({ accessToken: undefined }, "pf", "a", viewer),
    ]) {
      const error = await fail(call(api(501, { code: "not_implemented", message: "not implemented" }).api));
      expect(error.kind).toBe("not_implemented");
      expect(error.status).toBe(501);
    }
  });

  test("a 200 that violates the contract is invalid_response; so is a 200 that is not JSON or not 200", async () => {
    expect((await fail(api(200, { profile_id: "pf", items: [{ kind: "post" }], page: { truncated: false } }).api.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("invalid_response");
    expect((await fail(api(200, "<html>", true).api.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("invalid_response");
    expect((await fail(api(204, "", true).api.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("invalid_response");
    expect((await fail(api(200, { profile_id: "pf", items: [], page: { truncated: true } } as never).api.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("invalid_response");
  });

  test("a failed request is unavailable", async () => {
    const real = createRealApi({ baseUrl: "http://backend.test", fetch: async () => { throw new Error("connection refused"); } });
    expect((await fail(real.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("unavailable");
    expect((await fail(real.suggestSearchAuthors({ accessToken: undefined }, "pf", "a", viewer))).kind).toBe("unavailable");
  });

  test("statuses keep their meaning: 400 invalid_request, 404 not_found, 429 rate_limited, 503 timeout vs lookup", async () => {
    const code = (status: number, body: { code: string; message: string }, call: (real: ReturnType<typeof api>["api"]) => Promise<unknown>) =>
      fail(call(api(status, body).api)).then((error) => error.kind);
    const searchCall = (real: ReturnType<typeof api>["api"]) => real.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer);
    const resolveCall = (real: ReturnType<typeof api>["api"]) => real.resolveSearchAuthor({ accessToken: undefined }, "pf", "a", viewer);
    const suggestCall = (real: ReturnType<typeof api>["api"]) => real.suggestSearchAuthors({ accessToken: undefined }, "pf", "a", viewer);
    expect(await code(400, { code: "invalid_request", message: "m" }, searchCall)).toBe("invalid_request");
    expect(await code(404, { code: "not_found", message: "m" }, searchCall)).toBe("not_found");
    expect(await code(429, { code: "rate_limited", message: "m" }, suggestCall)).toBe("rate_limited");
    expect(await code(503, { code: "search_timeout", message: "m" }, searchCall)).toBe("search_timeout");
    expect(await code(503, { code: "author_lookup_unavailable", message: "m" }, suggestCall)).toBe("author_lookup_unavailable");
    expect(await code(503, { code: "author_lookup_timeout", message: "m" }, resolveCall)).toBe("author_lookup_unavailable");
  });

  test("the author API's 409 is author_ambiguous; a 409 anywhere else is no such thing", async () => {
    const resolved = await fail(api(409, { code: "conflict", message: "several" }).api.resolveSearchAuthor({ accessToken: undefined }, "pf", "pat@dup.example", viewer));
    expect(resolved.kind).toBe("author_ambiguous");
    expect(resolved.kind).not.toBe("conflict");
    expect((await fail(api(409, { code: "conflict", message: "x" }).api.searchNotes({ accessToken: undefined }, "pf", { q: "a" }, viewer))).kind).toBe("upstream_error");
  });
});
