/**
 * Usage:
 *   bun scripts/sync-reaction-scenarios.ts --producer-dir <ShuttlePub checkout>
 *
 * Vendors the producer's contract fixtures at the commit pinned in
 * openapi/producer.lock.json (the same commit as the vendored OpenAPI schema):
 *   openapi/quick-reaction-scenarios/*.json    S3 quick reaction scenarios
 *   openapi/personal-domain-fixtures/*.json    S8 personal domain content fixtures
 * Each directory gets verbatim bytes at that commit plus scenarios.lock.json
 * (producer commit + SHA-256 per file).
 *
 * Reads `git ls-tree` / `git show <SHA>:<path>` from a local clone; the working tree
 * is never read. Run it after `bun run openapi:sync` whenever the pin moves.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex, verifyLock } from "../bff/openapi/lock.ts";
import { PRODUCER_FIXTURE_SETS, SCENARIO_LOCK_FILE, serializeScenarioLock, type ScenarioLock } from "../bff/openapi/scenario-lock.ts";

const args = process.argv.slice(2);
const index = args.indexOf("--producer-dir");
const producerDir = index === -1 ? undefined : args[index + 1];
if (producerDir === undefined || producerDir.startsWith("--")) {
  console.error("Usage: bun scripts/sync-reaction-scenarios.ts --producer-dir <ShuttlePub checkout>");
  process.exit(2);
}

const pin = await verifyLock();
const commit = pin.producer.commit;

function git(...command: string[]): Uint8Array {
  const proc = Bun.spawnSync(["git", "-C", producerDir!, ...command]);
  if (proc.exitCode !== 0) {
    console.error(`git ${command.join(" ")} failed in ${producerDir}:\n${proc.stderr.toString()}`);
    process.exit(1);
  }
  return new Uint8Array(proc.stdout);
}

for (const set of PRODUCER_FIXTURE_SETS) {
  const names = new TextDecoder().decode(git("ls-tree", "--name-only", `${commit}:${set.producerPath}`))
    .split("\n").filter((name) => name.endsWith(".json")).sort();
  if (names.length === 0) {
    console.error(`${set.producerPath} has no fixtures at ${commit}`);
    process.exit(1);
  }

  await mkdir(set.directory, { recursive: true });
  for (const stale of await readdir(set.directory)) await rm(join(set.directory, stale));
  const files: ScenarioLock["files"] = [];
  for (const name of names) {
    const bytes = git("show", `${commit}:${set.producerPath}/${name}`);
    await writeFile(join(set.directory, name), bytes);
    files.push({ file: name, sha256: sha256Hex(bytes), bytes: bytes.byteLength });
  }
  const lock: ScenarioLock = { producer: { repository: pin.producer.repository, commit, path: set.producerPath }, files };
  await writeFile(join(set.directory, SCENARIO_LOCK_FILE), serializeScenarioLock(lock));
  console.log(`Vendored ${files.length} ${set.label} from ${pin.producer.repository}@${commit}`);
}
