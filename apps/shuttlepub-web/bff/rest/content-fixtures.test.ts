// Replays the producer's S8 contract fixtures (vendored from ShuttlePub at the pinned
// commit, openapi/personal-domain-fixtures) against the mock's S8 projection
// (content.ts), and checks the schema cases against the pinned OpenAPI. A projection
// that drifts from the producer's examples, or a pin that drifts from its fixtures, fails.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { violationsForSchema } from "../openapi/contract.ts";
import { verifyLock } from "../openapi/lock.ts";
import { PERSONAL_DOMAIN_DIR, PRODUCER_PERSONAL_DOMAIN_PATH, verifyScenarioLock } from "../openapi/scenario-lock.ts";
import {
  directView,
  notificationsFor,
  searchFor,
  timelineFor,
  type ContentCandidate,
  type ContentRestriction,
  type DirectNote,
  type DirectNoteResponse,
  type DomainControlRef,
  type ReactionCounts,
  type SearchCandidate,
} from "./content.ts";
import { reactionCountsOut } from "./content-mock.ts";

const fixture = async <T>(name: string): Promise<T> => JSON.parse(await Bun.file(join(PERSONAL_DOMAIN_DIR, name)).text()) as T;

type Surface = {
  name: string;
  policy: DomainControlRef;
  profile_id: string;
  candidates: ContentCandidate[];
  expected: { timeline: unknown; notifications: unknown };
};

type RevealStep = { action: string; note_id: string; restriction?: ContentRestriction; expect: unknown };
type RevealScenario = { name: string; policy: DomainControlRef; steps: RevealStep[] };
type SchemaCase = { name: string; schema: string; valid: boolean; payload: unknown };

describe("vendored S8 fixtures", () => {
  test("come from the pinned ShuttlePub commit and match their lock", async () => {
    const [schema, vendored] = await Promise.all([verifyLock(), verifyScenarioLock(PERSONAL_DOMAIN_DIR)]);
    expect(vendored.producer.commit).toBe(schema.producer.commit);
    expect(vendored.producer.path).toBe(PRODUCER_PERSONAL_DOMAIN_PATH);
  });

  test("every schema case is valid or invalid against the pinned OpenAPI exactly as the producer says", async () => {
    const cases = await fixture<SchemaCase[]>("schema_cases.json");
    expect(cases.length).toBeGreaterThan(50);
    for (const item of cases) {
      const violations = violationsForSchema(item.schema, item.payload);
      expect({ name: item.name, valid: violations.length === 0 }).toEqual({ name: item.name, valid: item.valid });
    }
  });

  test("every post search schema case is valid or invalid exactly as the producer says", async () => {
    const cases = await fixture<SchemaCase[]>("search_schema_cases.json");
    expect(cases.length).toBeGreaterThan(50);
    for (const item of cases) {
      const violations = violationsForSchema(item.schema, item.payload);
      expect({ name: item.name, valid: violations.length === 0 }).toEqual({ name: item.name, valid: item.valid });
    }
  });
});

describe("S8 surfaces (timeline / notifications) replayed against the projection", () => {
  test("mute and block omit whole items without trace, per Profile, exact canonical host only", async () => {
    const surfaces = await fixture<Surface[]>("surfaces.json");
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    for (const surface of surfaces) {
      const controls = [surface.policy];
      const timeline = timelineFor(surface.profile_id, controls, surface.candidates);
      const notifications = notificationsFor(surface.profile_id, controls, surface.candidates);
      expect({ name: surface.name, timeline }).toEqual({ name: surface.name, timeline: surface.expected.timeline as never });
      expect({ name: surface.name, notifications }).toEqual({ name: surface.name, notifications: surface.expected.notifications as never });
      expect(violationsForSchema("TimelineResponse", timeline)).toEqual([]);
      expect(violationsForSchema("ContentNotificationsResponse", notifications)).toEqual([]);
    }
  });
});

describe("S8 single-note reveal replayed against the projection", () => {
  test("hidden first, one note per explicit reveal, hide/reload/revisit hide again, gates survive", async () => {
    const [surfaces, scenarios] = await Promise.all([fixture<Surface[]>("surfaces.json"), fixture<RevealScenario[]>("reveal.json")]);
    for (const scenario of scenarios) {
      // The reveal fixtures address the surface fixtures' notes (same ids, same authors).
      const surface = surfaces.find((entry) => entry.profile_id === scenario.policy.profile_id && entry.policy.mode === scenario.policy.mode)!;
      const counts = (scenario.steps.find((step) => step.action === "reveal")!.expect as { presentation: { reaction_counts: ReactionCounts } }).presentation.reaction_counts;
      const notes = new Map<string, DirectNote>();
      for (const candidate of surface.candidates) {
        const payload = candidate.payload;
        if (payload.kind === "repost") continue;
        const source = payload.kind === "quote"
          ? { kind: "quote" as const, note: payload.note, quoted: { actor_url: candidate.target_actor_url!, note: payload.quoted_note } }
          : { kind: payload.kind, note: payload.note };
        notes.set(payload.note.note_id, { actor_url: candidate.actor_url, item: source, reaction_counts: counts });
      }
      const controls = [scenario.policy];
      for (const step of scenario.steps) {
        const base = notes.get(step.note_id)!;
        const note = step.restriction === undefined ? base : { ...base, restriction: step.restriction };
        // reveal / reveal_quote / reveal_restricted are POST reveal; get, get_other, hide,
        // reload and revisit are a fresh GET (S8 keeps no reveal state).
        const revealed = step.action.startsWith("reveal");
        const actual = directView(scenario.policy.profile_id, controls, note, revealed);
        expect({ scenario: scenario.name, step: step.action, actual }).toEqual({ scenario: scenario.name, step: step.action, actual: step.expect as never });
        expect(violationsForSchema("DirectNoteResponse", actual)).toEqual([]);
      }
    }
  });
});

type HiddenQuoteCase = {
  name: string;
  viewer_profile_id: string;
  policy: DomainControlRef;
  note: { note_id: string; actor_url: string; comment: string };
  quoted: { note_id: string; actor_url: string; content: string; gate: ContentRestriction | null };
  expect: { feed_omitted: boolean; get: DirectNoteResponse; reveal: DirectNoteResponse };
};

describe("S8 hidden quote (cause) replayed against the projection", () => {
  test("hidden because of the quote or the author, one reveal shows the quote with its target, a gate or deletion keeps the target restricted", async () => {
    const cases = await fixture<HiddenQuoteCase[]>("hidden_quote.json");
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const item of cases) {
      const reveal = item.expect.reveal.presentation;
      const counts = reveal.state === "visible" ? reveal.reaction_counts : { likes: 0, emoji: [] };
      const note: DirectNote = {
        actor_url: item.note.actor_url,
        item: {
          kind: "quote",
          note: { note_id: item.note.note_id, content: item.note.comment },
          quoted: {
            actor_url: item.quoted.actor_url,
            note: { note_id: item.quoted.note_id, content: item.quoted.content },
            ...(item.quoted.gate === null ? {} : { restriction: item.quoted.gate }),
          },
        },
        reaction_counts: counts,
      };
      const controls = [item.policy];
      const get = directView(item.viewer_profile_id, controls, note, false);
      const revealed = directView(item.viewer_profile_id, controls, note, true);
      expect({ name: item.name, step: "get", actual: get }).toEqual({ name: item.name, step: "get", actual: item.expect.get });
      expect({ name: item.name, step: "reveal", actual: revealed }).toEqual({ name: item.name, step: "reveal", actual: item.expect.reveal });
      expect(violationsForSchema("DirectNoteResponse", get)).toEqual([]);
      expect(violationsForSchema("DirectNoteResponse", revealed)).toEqual([]);
      const feed = timelineFor(item.viewer_profile_id, controls, [{
        actor_url: item.note.actor_url,
        target_actor_url: item.quoted.actor_url,
        payload: {
          kind: "quote",
          note: { note_id: item.note.note_id, content: item.note.comment },
          quoted_note: { note_id: item.quoted.note_id, content: item.quoted.content },
        },
      }]);
      expect({ name: item.name, feedOmitted: feed.items.length === 0 }).toEqual({ name: item.name, feedOmitted: item.expect.feed_omitted });
    }
  });
});

type SearchNoteFixture = {
  viewable: boolean;
  deleted: boolean;
  note_id: string;
  author: string;
  kind: "post" | "reply" | "quote" | "repost";
  created_at: string;
  content: string;
  cw?: string;
  quoted_author?: string;
};
type SearchCase = {
  name: string;
  query?: { author?: string; q?: string; q_repeat?: { ch: string; count: number }; limit?: number };
  expect: { status: number; items?: { note_id: string; kind: SearchCandidate["kind"]; display: "text" | "content_warning" }[] };
};
type SearchFixture = { policy: DomainControlRef; viewer_profile_id: string; notes: SearchNoteFixture[]; cases: SearchCase[] };

describe("S8 post search (D04) replayed against the projection", () => {
  // The engine's own part (matching and viewing rights) is stated here only to feed the projection
  // what the producer's cases search; paging, the time limit and the error cases belong to D04.
  const matches = (note: SearchNoteFixture, query: NonNullable<SearchCase["query"]>) =>
    note.viewable && !note.deleted && note.kind !== "repost" &&
    (query.author === undefined || note.author === query.author) &&
    (query.q === undefined || note.content.includes(query.q) || (note.cw !== undefined && note.cw.includes(query.q)));

  test("a note of a controlled domain or a quote of one leaves no trace; CW notes expose only the CW; newest first", async () => {
    const search = await fixture<SearchFixture>("search.json");
    const replayed = search.cases.filter((item) => item.expect.status === 200 && item.query !== undefined && item.query.limit === undefined);
    expect(replayed.length).toBeGreaterThanOrEqual(15);
    for (const replay of replayed) {
      const query = { ...replay.query!, ...(replay.query!.q_repeat === undefined ? {} : { q: replay.query!.q_repeat.ch.repeat(replay.query!.q_repeat.count) }) };
      const item = { name: replay.name, expect: replay.expect };
      const candidates: SearchCandidate[] = search.notes
        .filter((note) => matches(note, query))
        .map((note) => ({
          note_id: note.note_id,
          author: note.author,
          kind: note.kind as SearchCandidate["kind"],
          created_at: note.created_at,
          content: note.content,
          ...(note.cw === undefined ? {} : { content_warning: note.cw }),
          ...(note.quoted_author === undefined ? {} : { quoted_author: note.quoted_author }),
        }));
      const actual = searchFor(search.viewer_profile_id, [search.policy], candidates);
      expect(violationsForSchema("NoteSearchResponse", actual)).toEqual([]);
      const summary = actual.items.map((entry) => ({ note_id: entry.note.note_id, kind: entry.kind, display: entry.note.body.display }));
      expect({ name: item.name, summary }).toEqual({ name: item.name, summary: item.expect.items! });
      expect(actual.page).toEqual({ truncated: false });
    }
  });

  test("a note with a content warning never carries its body", async () => {
    const response = searchFor("pf", [], [
      { note_id: "00000000-0000-4000-8000-0000000000aa", author: "https://a.example/users/a", kind: "post", created_at: "2026-11-14T03:00:00Z", content: "SECRET_BODY", content_warning: "spoiler" },
    ]);
    expect(response.items[0]!.note.body).toEqual({ display: "content_warning", content_warning: "spoiler" });
    expect(JSON.stringify(response)).not.toContain("SECRET_BODY");
  });

  test("order is by the instant created_at denotes, then note_id descending", async () => {
    const ordering = await fixture<{ author: string; notes: SearchNoteFixture[]; paging: { limit: number; pages: string[][] }; expected_order: string[] }>("search_ordering.json");
    const candidates: SearchCandidate[] = ordering.notes.map((note) => ({
      note_id: note.note_id,
      author: note.author,
      kind: note.kind as SearchCandidate["kind"],
      created_at: note.created_at,
      content: note.content,
    }));
    const actual = searchFor("pf", [], candidates).items.map((entry) => entry.note.note_id);
    expect(actual).toEqual(ordering.expected_order);
  });

  test("order keeps the fractional seconds in full: notes within the same millisecond are not flipped or tied", () => {
    const note = (id: string, createdAt: string): SearchCandidate => ({
      note_id: id, author: "https://a.example/users/a", kind: "post", created_at: createdAt, content: id,
    });
    const order = (candidates: SearchCandidate[]) => searchFor("pf", [], candidates).items.map((entry) => entry.note.note_id);
    // Same millisecond, different microseconds: …000900 is after …000100.
    const later = note("00000000-0000-4000-8000-000000000001", "2026-11-14T03:00:00.000900Z");
    const earlier = note("00000000-0000-4000-8000-000000000002", "2026-11-14T03:00:00.000100Z");
    expect(order([earlier, later])).toEqual([later.note_id, earlier.note_id]);
    expect(order([later, earlier])).toEqual([later.note_id, earlier.note_id]);
    // Trailing zeros and a whole second denote the same instant, so the note_id breaks the tie (descending).
    const a = note("00000000-0000-4000-8000-0000000000a1", "2026-11-14T03:00:00Z");
    const b = note("00000000-0000-4000-8000-0000000000b1", "2026-11-14T03:00:00.000000Z");
    expect(order([a, b])).toEqual([b.note_id, a.note_id]);
    // A later offset-written instant wins over an earlier Z one, to the nanosecond.
    const offset = note("00000000-0000-4000-8000-0000000000c1", "2026-11-14T12:00:00.000000001+09:00");
    const zulu = note("00000000-0000-4000-8000-0000000000d1", "2026-11-14T03:00:00Z");
    expect(order([zulu, offset])).toEqual([offset.note_id, zulu.note_id]);
  });
});

describe("reaction chips with external emoji (D09) carry their view data", () => {
  test("valid chips pass the schema and reach the app with origin, image state and usage intact", async () => {
    const chips = await fixture<{ valid: Record<string, ReactionCounts>; schema_invalid: Record<string, unknown>; schema_valid_but_inconsistent: Record<string, ReactionCounts> }>("remote_emoji_chips.json");
    for (const [name, counts] of Object.entries(chips.valid)) {
      expect({ name, violations: violationsForSchema("ReactionCounts", counts) }).toEqual({ name, violations: [] });
      const out = reactionCountsOut(counts);
      expect(out.emoji.map((chip) => chip.count)).toEqual(counts.emoji.map((chip) => chip.count));
      counts.emoji.forEach((chip, index) => {
        if (chip.view != null) expect({ name, view: out.emoji[index]!.emoji }).toEqual({ name, view: chip.view });
      });
    }
    const mixed = reactionCountsOut(chips.valid["same_name_different_origin"]!);
    expect(mixed.emoji.map((chip) => chip.emoji.origin)).toEqual(["remote.example", "other.example"]);
    expect(mixed.emoji.map((chip) => chip.emoji.emoji)).not.toEqual([mixed.emoji[0]!.emoji.emoji, mixed.emoji[0]!.emoji.emoji]);
  });

  test("schema-invalid chips are rejected by the schema", async () => {
    const chips = await fixture<{ schema_invalid: Record<string, unknown> }>("remote_emoji_chips.json");
    for (const [name, counts] of Object.entries(chips.schema_invalid)) {
      expect({ name, rejected: violationsForSchema("ReactionCounts", counts).length > 0 }).toEqual({ name, rejected: true });
    }
  });

  test("chips the server must not send are an invalid response, never repaired", async () => {
    const chips = await fixture<{ schema_valid_but_inconsistent: Record<string, ReactionCounts> }>("remote_emoji_chips.json");
    for (const [name, counts] of Object.entries(chips.schema_valid_but_inconsistent)) {
      expect({ name, violations: violationsForSchema("ReactionCounts", counts) }).toEqual({ name, violations: [] });
      expect(() => reactionCountsOut(counts), name).toThrow(/reaction chip violates the contract/);
    }
  });
});

describe("hidden and restricted presentations carry no content", () => {
  const SECRET = "SECRET_TEXT_THAT_MUST_NOT_LEAK";
  const author = "https://blocked.example/users/one";
  const counts: ReactionCounts = { likes: 3, emoji: [] };
  const controls: DomainControlRef[] = [{ profile_id: "pf", domain: "blocked.example", mode: "block", revision: 2 }];
  const post: DirectNote = { actor_url: author, item: { kind: "post", note: { note_id: "00000000-0000-4000-8000-0000000000aa", content: SECRET } }, reaction_counts: counts };

  test("hidden is exactly state, cause, mode, domain and revision", () => {
    const view = directView("pf", controls, post, false);
    expect(view).toEqual({ profile_id: "pf", presentation: { state: "hidden", cause: "direct", mode: "block", domain: "blocked.example", revision: 2 } });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain("users/one");
  });

  test("a revealed blocked note keeps every operation blocked; a revealed muted note is not restricted", () => {
    const blocked = directView("pf", controls, post, true);
    expect(blocked.presentation.state).toBe("visible");
    const ops = (blocked.presentation as { operations: Record<string, { status: string }> }).operations;
    expect(Object.values(ops).map((op) => op.status)).toEqual(["blocked", "blocked", "blocked", "blocked", "blocked"]);
    const muted = directView("pf", [{ ...controls[0]!, mode: "mute" }], post, true);
    const mutedOps = (muted.presentation as { operations: Record<string, { status: string }> }).operations;
    expect(Object.values(mutedOps).map((op) => op.status)).toEqual(["allowed", "allowed", "allowed", "allowed", "allowed"]);
  });

  test("reveal never clears CW, sensitive, deletion or visibility, and the restriction carries no content", () => {
    for (const restriction of ["cw", "sensitive", "deleted", "visibility"] as const) {
      const view = directView("pf", controls, { ...post, restriction }, true);
      expect(view.presentation).toMatchObject({ state: "restricted", reason: restriction });
      expect(JSON.stringify(view)).not.toContain(SECRET);
      expect(violationsForSchema("DirectNoteResponse", view)).toEqual([]);
    }
  });

  test("a third-party quote of a controlled domain is hidden by cause quote and reveals with its target; the quoter stays actionable", () => {
    const quote: DirectNote = {
      actor_url: "https://safe.example/users/quoter",
      item: { kind: "quote", note: { note_id: "00000000-0000-4000-8000-0000000000ab", content: "comment" }, quoted: { actor_url: author, note: post.item.note } },
      reaction_counts: counts,
    };
    const hidden = directView("pf", controls, quote, false);
    expect(hidden.presentation).toEqual({ state: "hidden", cause: "quote", mode: "block", domain: "blocked.example", revision: 2 });
    expect(JSON.stringify(hidden)).not.toContain(SECRET);
    expect(JSON.stringify(hidden)).not.toContain("quoter");
    const revealed = directView("pf", controls, quote, true);
    expect(revealed.presentation).toMatchObject({ state: "visible", item: { kind: "quote", quoted_note: { state: "visible", note: { content: SECRET } } } });
    const ops = (revealed.presentation as { operations: Record<string, { status: string }> }).operations;
    expect(Object.values(ops).every((op) => op.status === "allowed")).toBe(true);
  });
});
