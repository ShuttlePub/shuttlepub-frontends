// Replays the producer's quick reaction scenarios (vendored from ShuttlePub at the
// pinned commit) against the stateful mock model, and checks every request and
// expected answer against the pinned OpenAPI schema. A mock that drifts from the
// producer's documented semantics, or a scenario that drifts from the schema, fails.

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { violationsForResponse, violationsForSchema } from "../openapi/contract.ts";
import { verifyLock } from "../openapi/lock.ts";
import { SCENARIO_DIR, SCENARIO_LOCK_FILE, verifyScenarioLock } from "../openapi/scenario-lock.ts";
import { OPERATIONS, QuickReactionStore, type CustomEmojiSetup, type EmojiImageState, type EmojiRef, type EmojiUsage, type QuickReactionOperation } from "./quick-reaction.ts";

// The identifiers the producer's own replay uses (server/tests/quick_reaction.rs).
const PROFILE = "V1StGXR8_Z5jdHi6B-myT";
const NOTE = "0f0a5d3e-8f3c-4c53-9b64-3f5f8f0f2a11";

type Step =
  | { mutate_emoji: { id: string; availability: "available" | "unavailable"; reason?: "deleted" | "disabled" | null } }
  | { operation: QuickReactionOperation; body?: unknown; expect: { status: number; body: unknown }; note?: string };

type Scenario = {
  name: string;
  setup: {
    emoji: Record<string, {
      shortcode?: string;
      image_url?: string;
      availability: "available" | "unavailable";
      reason?: "deleted" | "disabled";
      origin?: string;
      image_state?: EmojiImageState;
      usage?: EmojiUsage;
    }>;
    settings: { revision: number; favorites: EmojiRef[] };
    reaction: EmojiRef | null;
    /** Chips on the Note carried by other people (besides the Profile's own selection). */
    chips?: EmojiRef[];
  };
  steps: Step[];
};

const REQUEST_SCHEMA: Partial<Record<QuickReactionOperation, string>> = {
  putQuickReactionSettings: "UpdateQuickReactionSettings",
  putNoteReaction: "PutReaction",
};

async function scenarios(): Promise<Scenario[]> {
  const names = (await readdir(SCENARIO_DIR)).filter((name) => name.endsWith(".json") && name !== SCENARIO_LOCK_FILE).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await Bun.file(join(SCENARIO_DIR, name)).text()) as Scenario));
}

function storeFor(scenario: Scenario): QuickReactionStore {
  const emoji: Record<string, CustomEmojiSetup> = {};
  for (const [id, entry] of Object.entries(scenario.setup.emoji)) {
    emoji[id] = {
      availability: entry.availability,
      ...(entry.shortcode === undefined ? {} : { shortcode: entry.shortcode }),
      ...(entry.image_url === undefined ? {} : { image_url: entry.image_url }),
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      ...(entry.origin === undefined ? {} : { origin: entry.origin }),
      ...(entry.image_state === undefined ? {} : { image_state: entry.image_state }),
      ...(entry.usage === undefined ? {} : { usage: entry.usage }),
    };
  }
  return new QuickReactionStore({
    emoji,
    profiles: [PROFILE],
    notes: [NOTE],
    settings: { [PROFILE]: scenario.setup.settings },
    reactions: scenario.setup.reaction === null ? [] : [{ profile: PROFILE, note: NOTE, emoji: scenario.setup.reaction }],
    chips: (scenario.setup.chips ?? []).map((emoji) => ({ note: NOTE, emoji })),
  });
}

describe("producer quick reaction scenarios", () => {
  test("are vendored verbatim from the pinned producer commit", async () => {
    const [schema, vendored] = await Promise.all([verifyLock(), verifyScenarioLock()]);
    expect(vendored.producer.commit).toBe(schema.producer.commit);
    expect(vendored.files.length).toBeGreaterThanOrEqual(21);
  });

  test("every request and expected answer conforms to the pinned OpenAPI schema", async () => {
    for (const scenario of await scenarios()) {
      scenario.steps.forEach((step, index) => {
        if (!("operation" in step)) return;
        const label = `${scenario.name} step ${index}`;
        const requestSchema = REQUEST_SCHEMA[step.operation];
        // Like the producer's replay: requests the schema forbids may still reach the
        // server; those are exactly the 400 validation cases.
        if (requestSchema !== undefined && step.expect.status !== 400) {
          expect(violationsForSchema(requestSchema, step.body), `${label} request`).toEqual([]);
        }
        const { path, method } = OPERATIONS[step.operation];
        expect(violationsForResponse({ path, method, status: String(step.expect.status) }, step.expect.body), `${label} answer`).toEqual([]);
      });
    }
  });

  test("the stateful mock answers every step exactly as the producer expects", async () => {
    const all = await scenarios();
    expect(all.length).toBeGreaterThanOrEqual(21);
    expect(all.filter((scenario) => scenario.name.startsWith("remote_")).length).toBeGreaterThanOrEqual(9);
    for (const scenario of all) {
      const store = storeFor(scenario);
      scenario.steps.forEach((step, index) => {
        if ("mutate_emoji" in step) {
          store.mutateEmoji(step.mutate_emoji.id, step.mutate_emoji.availability, step.mutate_emoji.reason ?? null);
          return;
        }
        const reply = store.handle(step.operation, { profile_nanoid: PROFILE, note_id: NOTE }, structuredClone(step.body));
        expect({ step: `${scenario.name} step ${index}`, ...reply })
          .toEqual({ step: `${scenario.name} step ${index}`, status: step.expect.status, body: step.expect.body });
      });
    }
  });
});
