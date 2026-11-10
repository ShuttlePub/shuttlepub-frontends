import { describe, expect, test } from "bun:test";
import { ContractLookupError, violationsForResponse, violationsForSchema } from "./contract.ts";

const status200 = { path: "/api/v1/status", method: "get", status: "200" } as const;
const status501 = { path: "/api/v1/status", method: "get", status: "501" } as const;

describe("contract validation against the pinned OpenAPI schema", () => {
  test("accepts bodies that match the documented responses", () => {
    expect(violationsForResponse(status200, { api_version: "v1" })).toEqual([]);
    expect(violationsForResponse(status501, { code: "not_implemented", message: "later" })).toEqual([]);
    expect(violationsForSchema("PageParams", { limit: 20, cursor: null })).toEqual([]);
  });

  test("rejects a missing required field", () => {
    expect(violationsForResponse(status200, {})).not.toEqual([]);
    expect(violationsForResponse(status501, { code: "not_implemented" })).not.toEqual([]);
  });

  test("rejects a wrong type", () => {
    expect(violationsForResponse(status200, { api_version: 1 })).not.toEqual([]);
  });

  test("rejects an enum value outside the contract", () => {
    expect(violationsForResponse(status501, { code: "teapot", message: "x" })).not.toEqual([]);
  });

  test("enforces schema constraints, including format int32 and minimum", () => {
    expect(violationsForSchema("PageParams", { limit: 0 })).not.toEqual([]);
    expect(violationsForSchema("PageParams", { limit: 2 ** 31 })).not.toEqual([]);
  });

  test("an undocumented response or schema is a lookup failure, not a pass", () => {
    expect(() => violationsForResponse({ ...status200, status: "404" }, {})).toThrow(ContractLookupError);
    expect(() => violationsForResponse({ ...status200, path: "/api/v1/nope" }, {})).toThrow(ContractLookupError);
    expect(() => violationsForSchema("Nope", {})).toThrow(ContractLookupError);
  });
});
