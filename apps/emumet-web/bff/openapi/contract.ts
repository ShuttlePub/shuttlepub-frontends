// Validates JSON bodies against the vendored Emumet OpenAPI schema.
//
// OpenAPI 3.1 schema objects are JSON Schema 2020-12, so the document is registered
// with Ajv as-is and each operation response schema is addressed by JSON Pointer.
// Used to check fixtures (tests) and the real adapter's responses (runtime), so
// the mock data and the live Emumet API are held to the same pinned contract.

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import openapiDocument from "../../openapi/emumet.json" with { type: "json" };

export type HttpMethod = "get" | "put" | "post" | "delete" | "patch";

export type ResponseRef = {
  path: string;
  method: HttpMethod;
  /** Response status key as written in the OpenAPI document, e.g. "200". */
  status: string;
};

export type ContractViolation = {
  instancePath: string;
  message: string;
};

export class ContractLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractLookupError";
  }
}

const DOCUMENT_ID = "emumet-openapi.json";

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function createAjv(): Ajv2020 {
  // strict is off because OpenAPI documents carry non-validation keywords
  // (paths, operationId, summary, ...) next to the JSON Schema parts.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat("int32", {
    type: "number",
    validate: (value: number) => Number.isInteger(value) && value >= -(2 ** 31) && value <= 2 ** 31 - 1,
  });
  ajv.addFormat("int64", { type: "number", validate: (value: number) => Number.isSafeInteger(value) });
  // Emumet emits RFC 3339 timestamps (time::serde::rfc3339); Ajv core does not know "date-time".
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) =>
      /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
  });
  ajv.addFormat("float", { type: "number", validate: () => true });
  ajv.addFormat("double", { type: "number", validate: () => true });
  ajv.addSchema(openapiDocument, DOCUMENT_ID);
  return ajv;
}

const ajv = createAjv();
const compiled = new Map<string, ValidateFunction>();

function compile(pointer: string): ValidateFunction {
  const cached = compiled.get(pointer);
  if (cached) return cached;
  const validate = ajv.compile({ $ref: `${DOCUMENT_ID}#${pointer}` });
  compiled.set(pointer, validate);
  return validate;
}

function toViolations(validate: ValidateFunction): ContractViolation[] {
  return (validate.errors ?? []).map((error) => ({
    instancePath: error.instancePath === "" ? "/" : error.instancePath,
    message: error.message ?? "invalid",
  }));
}

/** Validate `body` against `#/components/schemas/<name>`. Returns [] when valid. */
export function violationsForSchema(name: string, body: unknown): ContractViolation[] {
  const schemas = (openapiDocument as { components?: { schemas?: Record<string, unknown> } }).components?.schemas ?? {};
  if (!(name in schemas)) throw new ContractLookupError(`OpenAPI schema ${JSON.stringify(name)} does not exist`);
  const validate = compile(`/components/schemas/${escapePointer(name)}`);
  validate(body);
  return toViolations(validate);
}

/**
 * Validate `body` against the application/json schema of one documented response.
 * Throws ContractLookupError when the operation/status is not in the pinned schema,
 * so a fixture for an undocumented response is a failure, not a pass.
 */
export function violationsForResponse(ref: ResponseRef, body: unknown): ContractViolation[] {
  const paths = (openapiDocument as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
  const operation = paths[ref.path]?.[ref.method] as
    | { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
    | undefined;
  const schema = operation?.responses?.[ref.status]?.content?.["application/json"]?.schema;
  if (schema === undefined) {
    throw new ContractLookupError(
      `OpenAPI has no application/json response schema for ${ref.method.toUpperCase()} ${ref.path} ${ref.status}`,
    );
  }
  const pointer = [
    "paths",
    escapePointer(ref.path),
    ref.method,
    "responses",
    escapePointer(ref.status),
    "content",
    escapePointer("application/json"),
    "schema",
  ].join("/");
  const validate = compile(`/${pointer}`);
  validate(body);
  return toViolations(validate);
}

export function describeViolations(violations: readonly ContractViolation[]): string {
  return violations.map((violation) => `${violation.instancePath} ${violation.message}`).join("; ");
}

/** Whether the pinned schema documents `status` as a response of the operation (any content type). */
export function isDocumentedStatus(path: string, method: HttpMethod, status: number): boolean {
  const paths = (openapiDocument as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
  const operation = paths[path]?.[method] as { responses?: Record<string, unknown> } | undefined;
  return operation?.responses?.[String(status)] !== undefined;
}
