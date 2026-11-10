import { describe, expect, test } from "bun:test";
import { ContractLookupError, isDocumentedStatus, violationsForResponse, violationsForSchema } from "./contract.ts";
import { REGISTRATION_GATE_FIXTURES } from "../emumet/registration-gate-fixtures.ts";

const getGate = { path: "/api/v1/admin/registration-gate", method: "get", status: "200" } as const;

describe("contract validation against the pinned Emumet OpenAPI schema", () => {
  test("accepts a documented registration gate response", () => {
    expect(violationsForResponse(getGate, REGISTRATION_GATE_FIXTURES.accepting_protected)).toEqual([]);
  });

  test("rejects a missing required field, a wrong type and a non-integer revision", () => {
    const { revision: _revision, ...withoutRevision } = REGISTRATION_GATE_FIXTURES.accepting_protected;
    expect(violationsForResponse(getGate, withoutRevision)).not.toEqual([]);
    expect(violationsForResponse(getGate, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, accepting: "yes" })).not.toEqual([]);
    expect(violationsForResponse(getGate, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, revision: 1.5 })).not.toEqual([]);
  });

  test("enforces format date-time on timestamps", () => {
    for (const updated_at of ["yesterday", "2026-11-10", "2026-11-10 01:00:00", "2026-13-40T99:00:00Z"]) {
      expect(violationsForResponse(getGate, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, updated_at })).not.toEqual([]);
    }
    expect(violationsForResponse(getGate, { ...REGISTRATION_GATE_FIXTURES.accepting_protected, updated_at: "2026-11-10T01:00:00.123+09:00" })).toEqual([]);
  });

  test("an undocumented response or schema is a lookup failure, not a pass", () => {
    expect(() => violationsForResponse({ ...getGate, status: "404" }, {})).toThrow(ContractLookupError);
    expect(() => violationsForResponse({ ...getGate, path: "/api/v1/admin/registration-gate/nope" }, {})).toThrow(ContractLookupError);
    expect(() => violationsForSchema("Nope", {})).toThrow(ContractLookupError);
  });

  test("documented statuses are looked up per operation", () => {
    expect(isDocumentedStatus("/api/v1/admin/registration-gate/open", "post", 409)).toBe(true);
    expect(isDocumentedStatus("/api/v1/admin/registration-gate", "get", 409)).toBe(false);
    expect(isDocumentedStatus("/api/v1/admin/registration-gate", "get", 500)).toBe(false);
  });
});
