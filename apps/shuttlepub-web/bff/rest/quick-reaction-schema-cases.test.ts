// Replays the producer's S3 schema cases (quick_reaction/schema_cases.json, vendored from
// ShuttlePub at the pinned commit) against the pinned OpenAPI: every request and response is
// valid or invalid exactly as the producer says. The D09 cases (an external emoji deleted at its
// origin is `available` + `image_state: missing`; one this server disabled is `unavailable`) are
// among them, and the consistency rules the mock obeys accept every valid external view.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { violationsForResponse, violationsForSchema } from "../openapi/contract.ts";
import { verifyLock } from "../openapi/lock.ts";
import { PRODUCER_QUICK_REACTION_PATH, QUICK_REACTION_SCHEMA_CASES_DIR, verifyScenarioLock } from "../openapi/scenario-lock.ts";
import { emojiViewInconsistency, OPERATIONS, type EmojiView, type QuickReactionOperation } from "./quick-reaction.ts";

type SchemaCase = {
  name: string;
  target: { operation: QuickReactionOperation; kind: "request" | "response"; status?: string };
  body: unknown;
  schema_valid: boolean;
  rust_valid?: boolean;
};

const REQUEST_SCHEMA: Partial<Record<QuickReactionOperation, string>> = {
  putQuickReactionSettings: "UpdateQuickReactionSettings",
  putNoteReaction: "PutReaction",
};

const cases = async () => JSON.parse(await Bun.file(join(QUICK_REACTION_SCHEMA_CASES_DIR, "schema_cases.json")).text()) as SchemaCase[];

const violations = (item: SchemaCase) => {
  if (item.target.kind === "request") {
    const schema = REQUEST_SCHEMA[item.target.operation];
    if (schema === undefined) throw new Error(`${item.name}: no request schema for ${item.target.operation}`);
    return violationsForSchema(schema, item.body);
  }
  const { path, method } = OPERATIONS[item.target.operation];
  return violationsForResponse({ path, method, status: item.target.status ?? "200" }, item.body);
};

describe("producer quick reaction schema cases", () => {
  test("are vendored verbatim from the pinned producer commit", async () => {
    const [schema, vendored] = await Promise.all([verifyLock(), verifyScenarioLock(QUICK_REACTION_SCHEMA_CASES_DIR)]);
    expect(vendored.producer.commit).toBe(schema.producer.commit);
    expect(vendored.producer.path).toBe(PRODUCER_QUICK_REACTION_PATH);
    expect(vendored.files.map((entry) => entry.file)).toEqual(["schema_cases.json"]);
  });

  test("every request and response is valid or invalid against the pinned OpenAPI exactly as the producer says", async () => {
    const all = await cases();
    expect(all.length).toBeGreaterThanOrEqual(60);
    for (const item of all) {
      expect({ name: item.name, valid: violations(item).length === 0 }).toEqual({ name: item.name, valid: item.schema_valid });
    }
  });

  test("D09 views: deleted at the origin is available + missing; only a disabled external emoji is unavailable", async () => {
    const all = await cases();
    const view = (name: string) => (all.find((item) => item.name === name)!.body as { emoji: EmojiView }).emoji;
    const deleted = view("reaction response: external emoji deleted at its origin is available and its image missing");
    expect(deleted).toMatchObject({ availability: "available", image_state: "missing", usage: "existing_reaction_only" });
    expect(deleted.unavailable_reason).toBeUndefined();
    expect(emojiViewInconsistency(deleted)).toBeNull();
    const disabled = view("reaction response: external emoji disabled by this server is unavailable");
    expect(disabled).toMatchObject({ availability: "unavailable", unavailable_reason: "disabled", image_state: "present" });
    expect(emojiViewInconsistency(disabled)).toBeNull();
    // The old form (unavailable + deleted for an external emoji) is outside the contract.
    expect(emojiViewInconsistency({ ...deleted, availability: "unavailable", unavailable_reason: "deleted" })).toMatch(/never unavailable because it was deleted/);
  });
});
