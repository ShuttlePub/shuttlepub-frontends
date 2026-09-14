import { expect, test } from "bun:test";
import { manifest } from "../manifest.ts";
import { captureCases, catalogSchema } from "./cases.ts";

test("enumerates unique screenshots when all catalog themes are supplied", () => {
  // Given
  const catalog = catalogSchema.parse(manifest);
  // When
  const cases = captureCases(catalog);
  // Then
  expect(cases).toHaveLength(52);
  expect(new Set(cases.map((item) => item.filename)).size).toBe(52);
  expect(cases[0]).toEqual({
    url: "/component/layout#story-navbar", selector: "#story-navbar",
    color: "catppuccin-mocha", shape: "rounded",
    filename: "Layout--navbar--catppuccin-mocha--rounded.png",
  });
});

test.each(["https://evil.example/#story-a", "/../../secret#story-a", "/component/x", "/component/x#../a"])(
  "rejects unsafe story URL %s when parsing the manifest", (url) => {
    // Given
    const input = { ...manifest, entries: [{ name: "x", stories: [{ id: "a", url }] }] };
    // When
    const result = catalogSchema.safeParse(input);
    // Then
    expect(result.success).toBe(false);
  },
);

test("rejects empty catalog when no screenshots would be captured", () => {
  // Given / When
  const result = catalogSchema.safeParse({ ...manifest, entries: [] });
  // Then
  expect(result.success).toBe(false);
});
