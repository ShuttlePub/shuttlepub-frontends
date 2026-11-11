/**
 * Usage:
 *   bun scripts/sync-openapi.ts [--producer shuttlepub|emumet] --commit <40-hex SHA> [--producer-dir <checkout>] [--ref <name>]
 *   bun scripts/sync-openapi.ts [--producer shuttlepub|emumet] --commit <40-hex SHA> --file <path-to-schema.json>
 *
 * Vendors the producer's generated OpenAPI schema at an exact producer commit:
 *   shuttlepub (default)  openapi/shuttlepub.json + openapi/producer.lock.json
 *                         (ShuttlePub/ShuttlePub openapi/shuttlepub.json)
 *   emumet                openapi/emumet.json + openapi/emumet.lock.json
 *                         (ShuttlePub/Emumet openapi.json)
 * The lock records the producer repository/commit + SHA-256 of the vendored bytes.
 *
 * Sources (the only commands that need anything outside this repo; the build never does):
 *   --producer-dir  read `git show <SHA>:<schema path>` from a local clone
 *                   (the commit must exist there; the working tree is never read)
 *   --file          use a file you already extracted (you vouch it is the bytes at <SHA>)
 *   (default)       download raw.githubusercontent.com/<repository>/<SHA>/<schema path>
 *
 * After syncing, run `bun run codegen` to regenerate the TS REST types.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OPENAPI_DIR,
  OPENAPI_PINS,
  isCommitSha,
  serializeLock,
  sha256Hex,
  type ProducerLock,
} from "../bff/openapi/lock.ts";

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  return value;
}

const producerName = option("--producer") ?? "shuttlepub";
const pin = OPENAPI_PINS.find((candidate) => candidate.name === producerName);
if (pin === undefined) {
  console.error(`--producer must be one of ${OPENAPI_PINS.map((candidate) => candidate.name).join(", ")}`);
  process.exit(2);
}
const PRODUCER_REPOSITORY = pin.repository;
const PRODUCER_SCHEMA_PATH = pin.schemaPath;
const SCHEMA_FILE = pin.schemaFile;
const LOCK_FILE = pin.lockFile;

async function readSchemaBytes(commit: string): Promise<Uint8Array> {
  const file = option("--file");
  const producerDir = option("--producer-dir");
  if (file !== undefined && producerDir !== undefined) {
    console.error("Use only one of --file and --producer-dir");
    process.exit(2);
  }
  if (file !== undefined) return new Uint8Array(await Bun.file(file).arrayBuffer());
  if (producerDir !== undefined) {
    const proc = Bun.spawnSync(["git", "-C", producerDir, "show", `${commit}:${PRODUCER_SCHEMA_PATH}`]);
    if (proc.exitCode !== 0) {
      console.error(`git show ${commit}:${PRODUCER_SCHEMA_PATH} failed in ${producerDir}:\n${proc.stderr.toString()}`);
      process.exit(1);
    }
    return new Uint8Array(proc.stdout);
  }
  const url = `https://raw.githubusercontent.com/${PRODUCER_REPOSITORY}/${commit}/${PRODUCER_SCHEMA_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Download failed: HTTP ${response.status} ${url}`);
    process.exit(1);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function writeAtomically(path: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

const commit = option("--commit");
if (!isCommitSha(commit)) {
  console.error("--commit must be a full 40-hex lowercase producer commit SHA");
  process.exit(2);
}

const bytes = await readSchemaBytes(commit);
let document: unknown;
try {
  document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
} catch (error) {
  console.error(`Fetched schema is not valid UTF-8 JSON: ${String(error)}`);
  process.exit(1);
}
const version = (document as { openapi?: unknown } | null)?.openapi;
if (typeof version !== "string" || !version.startsWith("3.")) {
  console.error(`Fetched document is not an OpenAPI 3.x schema (openapi: ${JSON.stringify(version)})`);
  process.exit(1);
}

const ref = option("--ref");
const lock: ProducerLock = {
  producer: { repository: PRODUCER_REPOSITORY, commit, path: PRODUCER_SCHEMA_PATH, ...(ref === undefined ? {} : { ref }) },
  schema: { file: SCHEMA_FILE, sha256: sha256Hex(bytes), bytes: bytes.byteLength },
};

await mkdir(OPENAPI_DIR, { recursive: true });
await writeAtomically(join(OPENAPI_DIR, SCHEMA_FILE), bytes);
await writeAtomically(join(OPENAPI_DIR, LOCK_FILE), serializeLock(lock));
console.log(`Vendored ${PRODUCER_REPOSITORY}@${commit} sha256:${lock.schema.sha256} (${bytes.byteLength} bytes)`);
console.log("Next: bun run codegen");
