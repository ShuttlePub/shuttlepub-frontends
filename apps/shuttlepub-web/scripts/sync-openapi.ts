/**
 * Usage:
 *   bun scripts/sync-openapi.ts --commit <40-hex SHA> [--producer-dir <ShuttlePub checkout>] [--ref <name>]
 *   bun scripts/sync-openapi.ts --commit <40-hex SHA> --file <path-to-schema.json>
 *
 * Vendors the producer's generated OpenAPI schema at an exact producer commit:
 *   openapi/shuttlepub.json       verbatim bytes of openapi/shuttlepub.json at <SHA>
 *   openapi/producer.lock.json    producer repository/commit + SHA-256 of those bytes
 *
 * Sources (the only commands that need anything outside this repo; the build never does):
 *   --producer-dir  read `git show <SHA>:openapi/shuttlepub.json` from a local clone
 *                   (the commit must exist there; the working tree is never read)
 *   --file          use a file you already extracted (you vouch it is the bytes at <SHA>)
 *   (default)       download raw.githubusercontent.com/ShuttlePub/ShuttlePub/<SHA>/openapi/shuttlepub.json
 *
 * After syncing, run `bun run codegen` to regenerate the TS REST types.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LOCK_FILE,
  OPENAPI_DIR,
  PRODUCER_REPOSITORY,
  PRODUCER_SCHEMA_PATH,
  SCHEMA_FILE,
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
