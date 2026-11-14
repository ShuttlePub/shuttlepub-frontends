import { describe, expect, test } from "bun:test";
import { violationsForSchema } from "./contract.ts";
import { compareInstants, parseRfc3339 } from "./rfc3339.ts";

const compare = (a: string, b: string) => compareInstants(parseRfc3339(a)!, parseRfc3339(b)!);

describe("RFC 3339 date-time", () => {
  test("accepts real instants with Z or an offset and any number of fraction digits", () => {
    for (const value of [
      "2026-11-14T03:00:00Z", "2026-11-14t03:00:00z", "2026-11-14T03:00:00.5Z", "2026-11-14T03:00:00.000000001+09:00",
      "2024-02-29T12:00:00Z", "2000-02-29T00:00:00-23:59", "2026-12-31T23:59:60Z",
      "2026-12-31T23:59:60+00:00", "2027-01-01T08:59:60+09:00", "2026-12-31T18:59:60-05:00",
    ]) expect(parseRfc3339(value), value).not.toBeNull();
  });

  test("rejects an impossible calendar day, time or offset, and anything that is not a date-time", () => {
    for (const value of [
      "2026-02-30T12:00:00Z", "2026-02-29T12:00:00Z", "1900-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z",
      "2026-00-10T00:00:00Z", "2026-11-00T00:00:00Z", "2026-11-14T24:00:00Z", "2026-11-14T03:60:00Z", "2026-11-14T03:00:61Z",
      "2026-11-14T03:00:60Z", "2026-12-31T23:58:60Z", "2026-12-31T23:59:60+09:00", "2027-01-01T09:00:60+09:00",
      "2026-11-14T03:00:00", "2026-11-14T03:00:00+24:00", "2026-11-14T03:00:00+09:60", "2026-11-14 03:00:00Z", "2026-11-14T03:00:00.Z",
      "2026-11-14", "", "not a date",
    ]) expect(parseRfc3339(value), value).toBeNull();
  });

  test("the schema validator uses it: a real schema field refuses an impossible day", () => {
    const note = (createdAt: string) => ({ note_id: "00000000-0000-4000-8000-000000000001", author: "https://a.example/users/a", created_at: createdAt, body: { display: "text", content: "x" } });
    expect(violationsForSchema("SearchedNote", note("2026-11-14T03:00:00Z"))).toEqual([]);
    expect(violationsForSchema("SearchedNote", note("2026-02-30T12:00:00Z")).length).toBeGreaterThan(0);
  });

  test("instants compare exactly: fraction digits, offsets and leap-year days", () => {
    expect(compare("2026-11-14T03:00:00.000900Z", "2026-11-14T03:00:00.000100Z")).toBeGreaterThan(0);
    expect(compare("2026-11-14T03:00:00.1Z", "2026-11-14T03:00:00.100000Z")).toBe(0);
    expect(compare("2026-11-14T12:00:00+09:00", "2026-11-14T03:00:00Z")).toBe(0);
    expect(compare("2026-11-14T12:00:00.000000001+09:00", "2026-11-14T03:00:00Z")).toBeGreaterThan(0);
    expect(compare("2026-11-14T03:00:00.99Z", "2026-11-14T03:00:01Z")).toBeLessThan(0);
    expect(compare("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z")).toBeLessThan(0);
  });
});
