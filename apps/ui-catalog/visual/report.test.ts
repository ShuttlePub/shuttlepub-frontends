import { expect, test } from "bun:test";
import { commentBody, resultSchema } from "./report.ts";

const clean = { failedItems: [], newItems: [], deletedItems: [], passedItems: ["same.png"] };
test("embeds changed, new and deleted PNGs when a comparison has differences", () => {
  const result = resultSchema.parse({ ...clean, failedItems: ["changed.png"], newItems: ["new.png"], deletedItems: ["old.png"] });
  const body = commentBody(result, "https://visual.example/ui-catalog/run-1", "abc123");
  expect(body).toContain("![diff](https://visual.example/ui-catalog/run-1/diff/changed.png)");
  expect(body).toContain("![actual](https://visual.example/ui-catalog/run-1/actual/new.png)");
  expect(body).toContain("![expected](https://visual.example/ui-catalog/run-1/expected/old.png)");
});

test("has no image markup when the comparison is unchanged", () => {
  const body = commentBody(resultSchema.parse(clean), "https://visual.example/ui-catalog/run-1", "abc123");
  expect(body).not.toContain("![");
});

test.each(["../secret.png", "a)![x](evil.png", "nested/a.png"])("rejects unsafe result name %s", (name) => {
  expect(resultSchema.safeParse({ ...clean, failedItems: [name] }).success).toBe(false);
});
