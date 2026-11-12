// Pin of the producer's quick reaction scenario fixtures (S3).
//
// ShuttlePub ships ordered request/response scenarios for its quick reaction
// contract (server/tests/fixtures/quick_reaction/scenarios/*.json) and replays them
// against a reference model in its own tests. This app vendors them verbatim into
// openapi/quick-reaction-scenarios/ and replays them against its stateful mock
// (bff/rest/quick-reaction-scenarios.test.ts), so the mock is held to the producer's
// examples, not to a reading of the contract made here. The lock records the producer
// commit (the same commit as producer.lock.json) and the SHA-256 of every file.
// Update only through `bun run openapi:sync-scenarios` (scripts/sync-reaction-scenarios.ts),
// which also vendors the S8 fixture set below.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OPENAPI_DIR, OpenApiLockError, isCommitSha, sha256Hex } from "./lock.ts";

export const SCENARIO_DIR = join(OPENAPI_DIR, "quick-reaction-scenarios");
export const SCENARIO_LOCK_FILE = "scenarios.lock.json";
export const PRODUCER_SCENARIO_PATH = "server/tests/fixtures/quick_reaction/scenarios";

// The producer's S8 (personal domain content) contract fixtures: surfaces, single-note
// reveal, schema cases, refusals and counts. Vendored the same way and replayed
// against the mock's S8 projection (bff/rest/content-fixtures.test.ts).
export const PERSONAL_DOMAIN_DIR = join(OPENAPI_DIR, "personal-domain-fixtures");
export const PRODUCER_PERSONAL_DOMAIN_PATH = "server/tests/fixtures/personal_domain";

/** Every vendored fixture set (scripts/sync-reaction-scenarios.ts, scripts/verify-openapi.ts). */
export const PRODUCER_FIXTURE_SETS = [
  { label: "quick reaction scenarios", directory: SCENARIO_DIR, producerPath: PRODUCER_SCENARIO_PATH },
  { label: "personal domain content fixtures", directory: PERSONAL_DOMAIN_DIR, producerPath: PRODUCER_PERSONAL_DOMAIN_PATH },
] as const;

export type ScenarioLock = {
  producer: { repository: string; commit: string; path: string };
  files: { file: string; sha256: string; bytes: number }[];
};

export function serializeScenarioLock(lock: ScenarioLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** Check that every vendored scenario matches the lock and nothing is missing or extra. */
export async function verifyScenarioLock(directory = SCENARIO_DIR): Promise<ScenarioLock> {
  let lock: ScenarioLock;
  try {
    lock = JSON.parse(await Bun.file(join(directory, SCENARIO_LOCK_FILE)).text()) as ScenarioLock;
  } catch (error) {
    throw new OpenApiLockError(`cannot read ${SCENARIO_LOCK_FILE}: ${String(error)}`);
  }
  if (!isCommitSha(lock.producer?.commit)) throw new OpenApiLockError("scenario lock: producer.commit must be a 40-hex SHA");
  if (!Array.isArray(lock.files) || lock.files.length === 0) throw new OpenApiLockError("scenario lock: files must not be empty");
  const present = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== SCENARIO_LOCK_FILE).sort();
  const locked = lock.files.map((entry) => entry.file).sort();
  if (JSON.stringify(present) !== JSON.stringify(locked)) {
    throw new OpenApiLockError(`scenario files ${JSON.stringify(present)} do not match the lock ${JSON.stringify(locked)}`);
  }
  for (const entry of lock.files) {
    const bytes = new Uint8Array(await Bun.file(join(directory, entry.file)).arrayBuffer());
    if (sha256Hex(bytes) !== entry.sha256 || bytes.byteLength !== entry.bytes) {
      throw new OpenApiLockError(`scenario ${entry.file}: checksum mismatch with ${SCENARIO_LOCK_FILE}`);
    }
  }
  return lock;
}
