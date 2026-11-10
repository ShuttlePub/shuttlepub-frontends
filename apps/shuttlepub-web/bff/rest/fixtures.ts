// Fixtures for REST responses documented in the pinned OpenAPI schema.
//
// Each entry names the response it claims to be; fixtures.test.ts validates every
// entry against openapi/shuttlepub.json, so a fixture that drifts from the
// contract fails the test. The mock adapter serves ONLY values from here.

import type { ResponseRef } from "../openapi/contract.ts";
import type { ApiStatus, ErrorBody } from "./client.ts";

export const apiStatusFixture: ApiStatus = { api_version: "v1" };

export const notImplementedFixture: ErrorBody = {
  code: "not_implemented",
  message: "GET /api/v1/status is not implemented yet",
};

export type ContractFixture = {
  name: string;
  response: ResponseRef;
  body: unknown;
};

export const CONTRACT_FIXTURES: readonly ContractFixture[] = [
  {
    name: "apiStatusFixture",
    response: { path: "/api/v1/status", method: "get", status: "200" },
    body: apiStatusFixture,
  },
  {
    name: "notImplementedFixture",
    response: { path: "/api/v1/status", method: "get", status: "501" },
    body: notImplementedFixture,
  },
];
