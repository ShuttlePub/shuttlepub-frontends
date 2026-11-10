import { describe, expect, test } from "bun:test";
import { describeViolations, violationsForResponse } from "../openapi/contract.ts";
import { CONTRACT_FIXTURES, apiStatusFixture } from "./fixtures.ts";
import { createMockApi } from "./mock.ts";

describe("fixtures vs the pinned OpenAPI schema", () => {
  for (const fixture of CONTRACT_FIXTURES) {
    test(`${fixture.name} satisfies ${fixture.response.method.toUpperCase()} ${fixture.response.path} ${fixture.response.status}`, () => {
      const violations = violationsForResponse(fixture.response, fixture.body);
      expect(describeViolations(violations)).toBe("");
    });
  }

  test("a fixture that violates the schema fails the check", () => {
    const broken = [
      { api_version: 1 },
      {},
      { apiVersion: "v1" },
    ];
    for (const body of broken) {
      expect(violationsForResponse({ path: "/api/v1/status", method: "get", status: "200" }, body)).not.toEqual([]);
    }
  });

  test("the mock adapter serves a contract-checked fixture (a copy, not shared state)", async () => {
    const api = createMockApi();
    const first = await api.getApiStatus();
    expect(first).toEqual(apiStatusFixture);
    first.api_version = "mutated";
    expect(await api.getApiStatus()).toEqual(apiStatusFixture);
    expect(violationsForResponse({ path: "/api/v1/status", method: "get", status: "200" }, await api.getApiStatus())).toEqual([]);
  });
});
