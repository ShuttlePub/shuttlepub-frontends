// Pins of the vendored OpenAPI schemas.
//
// openapi/shuttlepub.json is a verbatim copy of the producer's generated schema
// (ShuttlePub/ShuttlePub openapi/shuttlepub.json). openapi/producer.lock.json records
// the producer commit it was taken from and the SHA-256 of the copied bytes, so any
// edit of the vendored file, or a lock that points at different bytes, is detected
// offline. Update only through `bun run openapi:sync` (scripts/sync-openapi.ts).
//
// openapi/emumet.json + openapi/emumet.lock.json pin the Emumet API the same way
// (ShuttlePub/Emumet openapi.json). The BFF reads Profile-scoped settings (domain
// controls, individual blocks/mutes) from Emumet; update with
// `bun run openapi:sync -- --producer emumet --commit <SHA>`.

import { createHash } from "node:crypto";
import { join } from "node:path";

export const OPENAPI_DIR = join(import.meta.dir, "..", "..", "openapi");
export const SCHEMA_FILE = "shuttlepub.json";
export const LOCK_FILE = "producer.lock.json";
export const PRODUCER_REPOSITORY = "ShuttlePub/ShuttlePub";
export const PRODUCER_SCHEMA_PATH = "openapi/shuttlepub.json";

/** One vendored producer schema and its lock file under openapi/. */
export type OpenApiPin = {
  /** Name used on the command line (`--producer`). */
  name: "shuttlepub" | "emumet";
  schemaFile: string;
  lockFile: string;
  repository: string;
  schemaPath: string;
};

export const SHUTTLEPUB_PIN: OpenApiPin = {
  name: "shuttlepub",
  schemaFile: SCHEMA_FILE,
  lockFile: LOCK_FILE,
  repository: PRODUCER_REPOSITORY,
  schemaPath: PRODUCER_SCHEMA_PATH,
};

export const EMUMET_PIN: OpenApiPin = {
  name: "emumet",
  schemaFile: "emumet.json",
  lockFile: "emumet.lock.json",
  repository: "ShuttlePub/Emumet",
  schemaPath: "openapi.json",
};

export const OPENAPI_PINS: readonly OpenApiPin[] = [SHUTTLEPUB_PIN, EMUMET_PIN];

export type ProducerLock = {
  producer: {
    repository: string;
    commit: string;
    path: string;
    /** Informational branch/tag the commit was taken from (the commit is authoritative). */
    ref?: string;
  };
  schema: {
    file: string;
    sha256: string;
    bytes: number;
  };
};

export class OpenApiLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiLockError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== "string" || value === "") throw new OpenApiLockError(`${where}.${key} must be a non-empty string`);
  return value;
}

export function parseLock(text: string, lockFileName: string = LOCK_FILE): ProducerLock {
  const LOCK_FILE = lockFileName;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new OpenApiLockError(`${LOCK_FILE} is not valid JSON: ${String(error)}`);
  }
  if (typeof raw !== "object" || raw === null) throw new OpenApiLockError(`${LOCK_FILE} must be an object`);
  const { producer, schema } = raw as Record<string, unknown>;
  if (typeof producer !== "object" || producer === null) throw new OpenApiLockError(`${LOCK_FILE}: producer is missing`);
  if (typeof schema !== "object" || schema === null) throw new OpenApiLockError(`${LOCK_FILE}: schema is missing`);
  const p = producer as Record<string, unknown>;
  const s = schema as Record<string, unknown>;
  const commit = requireString(p, "commit", "producer");
  if (!isCommitSha(commit)) throw new OpenApiLockError(`producer.commit must be a full 40-hex commit SHA, got ${JSON.stringify(commit)}`);
  const sha256 = requireString(s, "sha256", "schema");
  if (!SHA256_PATTERN.test(sha256)) throw new OpenApiLockError(`schema.sha256 must be 64 lowercase hex characters`);
  if (typeof s["bytes"] !== "number" || !Number.isInteger(s["bytes"]) || s["bytes"] < 0) {
    throw new OpenApiLockError("schema.bytes must be a non-negative integer");
  }
  const ref = p["ref"];
  if (ref !== undefined && typeof ref !== "string") throw new OpenApiLockError("producer.ref must be a string when present");
  return {
    producer: {
      repository: requireString(p, "repository", "producer"),
      commit,
      path: requireString(p, "path", "producer"),
      ...(ref === undefined ? {} : { ref }),
    },
    schema: { file: requireString(s, "file", "schema"), sha256, bytes: s["bytes"] },
  };
}

export function serializeLock(lock: ProducerLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Throws OpenApiLockError unless the vendored schema bytes match the pin.
 * Offline: reads only files under `dir`.
 */
export async function verifyLock(dir: string = OPENAPI_DIR, pin: OpenApiPin = SHUTTLEPUB_PIN): Promise<ProducerLock> {
  const lockFile = Bun.file(join(dir, pin.lockFile));
  if (!(await lockFile.exists())) throw new OpenApiLockError(`${pin.lockFile} is missing in ${dir}`);
  const lock = parseLock(await lockFile.text(), pin.lockFile);
  if (lock.producer.repository !== pin.repository || lock.producer.path !== pin.schemaPath || lock.schema.file !== pin.schemaFile) {
    throw new OpenApiLockError(
      `${pin.lockFile} must pin ${pin.repository}:${pin.schemaPath} as ${pin.schemaFile}, ` +
        `got ${lock.producer.repository}:${lock.producer.path} as ${lock.schema.file}`,
    );
  }
  const schemaFile = Bun.file(join(dir, lock.schema.file));
  if (!(await schemaFile.exists())) throw new OpenApiLockError(`${lock.schema.file} is missing in ${dir}`);
  const bytes = new Uint8Array(await schemaFile.arrayBuffer());
  const actual = sha256Hex(bytes);
  if (actual !== lock.schema.sha256) {
    throw new OpenApiLockError(
      `${lock.schema.file} checksum mismatch: lock pins sha256 ${lock.schema.sha256} ` +
        `(producer ${lock.producer.commit}) but the file is ${actual}. ` +
        `Do not edit the vendored schema; run \`bun run openapi:sync -- --producer ${pin.name}\`.`,
    );
  }
  if (bytes.byteLength !== lock.schema.bytes) {
    throw new OpenApiLockError(`${lock.schema.file} size mismatch: lock pins ${lock.schema.bytes} bytes, file has ${bytes.byteLength}`);
  }
  return lock;
}
