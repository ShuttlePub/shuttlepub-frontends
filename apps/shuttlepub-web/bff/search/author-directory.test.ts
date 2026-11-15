// Replays the producer's reference projection (note_search_author/projection.json, vendored at the
// pinned commit) against the mock's author lookup: every suggestion and resolve case answers exactly
// as the producer's expectations say, and every payload of schema_cases.json is valid or invalid
// against the pinned OpenAPI as the producer says.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { violationsForSchema } from "../openapi/contract.ts";
import { verifyLock } from "../openapi/lock.ts";
import { NOTE_SEARCH_AUTHOR_DIR, PRODUCER_NOTE_SEARCH_AUTHOR_PATH, verifyScenarioLock } from "../openapi/scenario-lock.ts";
import { normalizeAcct, normalizePrefix, resolveAuthor, suggestAuthors, type Directory, type ViewerControls } from "./author-directory.ts";
import { interpretSearchReply } from "./reply.ts";
import type { ResolveAuthorResponse, SuggestAuthorsResponse } from "./types.ts";
import { ShuttlePubApiError } from "../rest/client.ts";

type Projection = Directory & {
  viewers: Record<string, ViewerControls>;
  suggestion_cases: { name: string; viewer: string; prefix: string; expect: string[] }[];
  resolve_cases: { name: string; viewer: string; acct: string; expect: { ok: string; acct: string } | { err: { code: string; field: string } } }[];
};

const load = async <T>(name: string) => JSON.parse(await Bun.file(join(NOTE_SEARCH_AUTHOR_DIR, name)).text()) as T;
const PROFILE = "pf-fixture-1";

describe("producer note search author fixtures", () => {
  test("are vendored verbatim from the pinned producer commit", async () => {
    const [schema, vendored] = await Promise.all([verifyLock(), verifyScenarioLock(NOTE_SEARCH_AUTHOR_DIR)]);
    expect(vendored.producer.commit).toBe(schema.producer.commit);
    expect(vendored.producer.path).toBe(PRODUCER_NOTE_SEARCH_AUTHOR_PATH);
    expect(vendored.files.map((entry) => entry.file)).toEqual(["projection.json", "schema_cases.json"]);
  });

  test("every suggestion case answers as the producer expects", async () => {
    const projection = await load<Projection>("projection.json");
    expect(projection.suggestion_cases.length).toBeGreaterThanOrEqual(35);
    for (const item of projection.suggestion_cases) {
      const reply = suggestAuthors(projection, projection.viewers[item.viewer]!, PROFILE, item.prefix);
      expect({ name: item.name, status: reply.status }).toEqual({ name: item.name, status: 200 });
      const body = interpretSearchReply<SuggestAuthorsResponse>("suggestNoteSearchAuthors", reply);
      expect({ name: item.name, urls: body.items.map((author) => author.actor_url) }).toEqual({ name: item.name, urls: item.expect });
    }
  });

  test("every resolve case answers as the producer expects", async () => {
    const projection = await load<Projection>("projection.json");
    expect(projection.resolve_cases.length).toBeGreaterThanOrEqual(20);
    for (const item of projection.resolve_cases) {
      const reply = resolveAuthor(projection, PROFILE, item.acct);
      if ("ok" in item.expect) {
        const body = interpretSearchReply<ResolveAuthorResponse>("resolveNoteSearchAuthor", reply);
        expect({ name: item.name, url: body.author.actor_url, acct: body.author.acct })
          .toEqual({ name: item.name, url: item.expect.ok, acct: item.expect.acct });
      } else {
        const failure = (() => {
          try {
            interpretSearchReply("resolveNoteSearchAuthor", reply);
            return "no error";
          } catch (error) {
            return error instanceof ShuttlePubApiError ? `${error.kind}:${error.status}` : String(error);
          }
        })();
        // not_found is a 404 and a conflict is a 409 that is the author ambiguity, never the reaction conflict.
        const expected = item.expect.err.code === "not_found" ? "not_found:404" : "author_ambiguous:409";
        expect({ name: item.name, failure }).toEqual({ name: item.name, failure: expected });
        expect((reply.body as { details: { field: string }[] }).details[0]!.field).toBe(item.expect.err.field);
      }
    }
  });

  test("schema cases are valid or invalid against the pinned OpenAPI exactly as the producer says", async () => {
    const cases = await load<{ name: string; schema: string; payload: unknown; valid: boolean }[]>("schema_cases.json");
    expect(cases.length).toBeGreaterThanOrEqual(55);
    for (const item of cases) {
      const violations = violationsForSchema(item.schema, item.payload);
      expect({ name: item.name, valid: violations.length === 0 }).toEqual({ name: item.name, valid: item.valid });
    }
  });
});

describe("acct and prefix normalisation", () => {
  test("one leading @ goes, the username keeps its case, the host is lowercase ASCII", () => {
    expect(normalizeAcct("@Alice@Remote.EXAMPLE")).toEqual({ username: "Alice", host: "remote.example" });
    expect(normalizeAcct("alice")).toEqual({ username: "alice", host: null });
    expect(normalizeAcct("taro@日本.example")).toEqual({ username: "taro", host: "xn--wgv71a.example" });
  });

  test("URL syntax, spaces, a second @, an IP host, a port and a trailing dot are refused", () => {
    for (const raw of ["", "@", "@@alice", "a@b@c", "alice@", "@@", "a b", "from:@alice", "https://x.example/users/a", "a@x.example:8080", "a@1.2.3.4", "a@x.example.", "a@1.2.3", "a@x_y.example", "a\u202eb", "a%40b"]) {
      expect({ raw, parsed: normalizeAcct(raw) }).toEqual({ raw, parsed: null });
    }
    expect(normalizePrefix("@")).toBeNull();
    expect(normalizePrefix("a\u0000")).toBeNull();
    expect(normalizePrefix("@alice m")).toBe("alice m");
  });
});
