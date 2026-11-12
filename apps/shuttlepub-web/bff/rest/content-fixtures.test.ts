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
  type DomainControlRef,
  type ReactionCounts,
} from "./content.ts";

const fixture = async <T>(name: string): Promise<T> => JSON.parse(await Bun.file(join(PERSONAL_DOMAIN_DIR, name)).text()) as T;

type Surface = {
  name: string;
  policy: DomainControlRef;
  profile_id: string;
  candidates: ContentCandidate[];
  expected: { timeline: unknown; search: unknown; notifications: unknown };
};

type RevealStep = { action: string; note_id: string; restriction?: ContentRestriction; expect: unknown };
type RevealScenario = { name: string; policy: DomainControlRef; steps: RevealStep[] };

describe("vendored S8 fixtures", () => {
  test("come from the pinned ShuttlePub commit and match their lock", async () => {
    const [schema, vendored] = await Promise.all([verifyLock(), verifyScenarioLock(PERSONAL_DOMAIN_DIR)]);
    expect(vendored.producer.commit).toBe(schema.producer.commit);
    expect(vendored.producer.path).toBe(PRODUCER_PERSONAL_DOMAIN_PATH);
  });

  test("every schema case is valid or invalid against the pinned OpenAPI exactly as the producer says", async () => {
    const cases = await fixture<{ name: string; schema: string; valid: boolean; payload: unknown }[]>("schema_cases.json");
    expect(cases.length).toBeGreaterThan(50);
    for (const item of cases) {
      const violations = violationsForSchema(item.schema, item.payload);
      expect({ name: item.name, valid: violations.length === 0 }).toEqual({ name: item.name, valid: item.valid });
    }
  });
});

describe("S8 surfaces (timeline / search / notifications) replayed against the projection", () => {
  test("mute and block omit whole items without trace, per Profile, exact canonical host only", async () => {
    const surfaces = await fixture<Surface[]>("surfaces.json");
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    for (const surface of surfaces) {
      const controls = [surface.policy];
      const timeline = timelineFor(surface.profile_id, controls, surface.candidates);
      const search = searchFor(surface.profile_id, controls, surface.candidates);
      const notifications = notificationsFor(surface.profile_id, controls, surface.candidates);
      expect({ name: surface.name, timeline }).toEqual({ name: surface.name, timeline: surface.expected.timeline as never });
      expect({ name: surface.name, search }).toEqual({ name: surface.name, search: surface.expected.search as never });
      expect({ name: surface.name, notifications }).toEqual({ name: surface.name, notifications: surface.expected.notifications as never });
      expect(violationsForSchema("TimelineResponse", timeline)).toEqual([]);
      expect(violationsForSchema("NoteSearchResponse", search)).toEqual([]);
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

describe("hidden and restricted presentations carry no content", () => {
  const SECRET = "SECRET_TEXT_THAT_MUST_NOT_LEAK";
  const author = "https://blocked.example/users/one";
  const counts: ReactionCounts = { likes: 3, emoji: [] };
  const controls: DomainControlRef[] = [{ profile_id: "pf", domain: "blocked.example", mode: "block", revision: 2 }];
  const post: DirectNote = { actor_url: author, item: { kind: "post", note: { note_id: "00000000-0000-4000-8000-0000000000aa", content: SECRET } }, reaction_counts: counts };

  test("hidden is exactly state, mode, domain and revision", () => {
    const view = directView("pf", controls, post, false);
    expect(view).toEqual({ profile_id: "pf", presentation: { state: "hidden", mode: "block", domain: "blocked.example", revision: 2 } });
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

  test("revealing a third-party quote keeps its controlled target hidden", () => {
    const quote: DirectNote = {
      actor_url: "https://safe.example/users/quoter",
      item: { kind: "quote", note: { note_id: "00000000-0000-4000-8000-0000000000ab", content: "comment" }, quoted: { actor_url: author, note: post.item.note } },
      reaction_counts: counts,
    };
    expect(directView("pf", controls, quote, false).presentation).toEqual({ state: "hidden", mode: "block", domain: "blocked.example", revision: 2 });
    const revealed = directView("pf", controls, quote, true);
    expect(revealed.presentation).toMatchObject({ state: "visible", item: { kind: "quote", quoted_note: { state: "hidden", domain: "blocked.example" } } });
    expect(JSON.stringify(revealed)).not.toContain(SECRET);
    const ops = (revealed.presentation as { operations: Record<string, { status: string }> }).operations;
    expect(Object.values(ops).every((op) => op.status === "allowed")).toBe(true);
  });
});
