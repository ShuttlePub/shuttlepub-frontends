import { expect, test } from "bun:test";
import { attachmentComments, captureRevisionsSchema, MAX_ATTACHMENTS, MAX_COMMENT_BYTES, REPORT_MARKER } from "./attachments.ts";
import type { Publication } from "./attachments.ts";

const publication: Publication = {
  repo: "ShuttlePub/shuttlepub-frontends", pr: "42", head: "a".repeat(40), base: "b".repeat(40),
  runId: "12345", runAttempt: "2", invocation: "c7657185-5e44-4a2f-b014-4d274901f05c",
};
const empty = { failedItems: [], newItems: [], deletedItems: [], passedItems: [] };

test("accepts only data-only capture SHA evidence", () => {
  const evidence = { version: 1 as const, head: publication.head, base: publication.base };
  expect(captureRevisionsSchema.parse(evidence)).toEqual(evidence);
  for (const invalid of [
    { ...evidence, version: 2 }, { ...evidence, head: "main" },
    { ...evidence, base: "../../secret" }, { ...evidence, script: "run untrusted code" },
  ]) expect(captureRevisionsSchema.safeParse(invalid).success).toBe(false);
});

test("renders changed before/after/diff tables and correct new/deleted sides", () => {
  const chunks = attachmentComments({ ...empty, failedItems: ["changed.png"], newItems: ["added.png"], deletedItems: ["removed.png"], passedItems: ["same.png"] }, publication);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.files).toEqual([
    "./report/expected/changed.png", "./report/actual/changed.png", "./report/diff/changed.png",
    "./report/actual/added.png", "./report/expected/removed.png",
  ]);
  expect(chunks[0]!.body).toContain("| Main | PR | Difference |");
  expect(chunks[0]!.body).toContain("Changed: 1 / New: 1 / Deleted: 1 / Passed: 1");
  expect(chunks[0]!.body).toContain("actions/runs/12345/attempts/2");
  expect(chunks[0]!.body).not.toContain("same.png");
});

test("splits reports under gh attachment and GitHub body limits without splitting changed rows", () => {
  const names = Array.from({ length: 150 }, (_, n) => `${"x".repeat(160)}-${n}.png`);
  const chunks = attachmentComments({ ...empty, failedItems: names }, publication);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.flatMap((chunk) => chunk.files)).toHaveLength(450);
  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.files.length).toBeLessThanOrEqual(MAX_ATTACHMENTS);
    expect(chunk.files.length % 3).toBe(0);
    expect(Buffer.byteLength(chunk.body)).toBeLessThanOrEqual(MAX_COMMENT_BYTES);
    expect(chunk.body.startsWith(REPORT_MARKER)).toBe(true);
    expect(chunk.body).toContain(`Part ${index + 1}/${chunks.length}`);
  }
});

test("returns a summary comment even when every image passed", () => {
  expect(attachmentComments({ ...empty, passedItems: ["same.png"] }, publication)[0]).toMatchObject({ files: [] });
  expect(attachmentComments(empty, publication)[0]!.body).toContain("No visual changes detected.");
});

test("sorts image names deterministically", () => {
  const a = { ...empty, newItems: ["z.png", "a.png"] };
  const b = { ...empty, newItems: ["a.png", "z.png"] };
  expect(attachmentComments(a, publication)).toEqual(attachmentComments(b, publication));
});

test("rejects unsafe file paths, duplicate categories, and invalid repository evidence", () => {
  for (const name of ["../bad.png", "hello#bad.png", "image.png\n--repo", "$(touch-bad).png"]) {
    expect(() => attachmentComments({ ...empty, newItems: [name] }, publication)).toThrow();
  }
  expect(() => attachmentComments({ ...empty, newItems: ["same.png"], passedItems: ["same.png"] }, publication)).toThrow();
  expect(() => attachmentComments(empty, { ...publication, repo: "owner/repo;echo" })).toThrow();
});
