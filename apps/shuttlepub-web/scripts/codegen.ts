/**
 * Usage: bun scripts/codegen.ts [--check]
 *
 * Regenerates every generated artifact from its pinned/owned source, offline:
 *   1. verifies openapi/shuttlepub.json against openapi/producer.lock.json and
 *      openapi/emumet.json against openapi/emumet.lock.json
 *   2. openapi/shuttlepub.json -> bff/rest/generated/shuttlepub-api.ts   (openapi-typescript)
 *      openapi/emumet.json     -> bff/rest/generated/emumet-api.ts       (openapi-typescript)
 *   3. bff/schema.graphql      -> src/Generated/**                       (scripts/sync-graphql.ts)
 *
 * --check regenerates and fails (exit 1) when the result differs from what is on
 * disk, listing the differing files. The regenerated files are left in place so
 * the difference can be inspected with git. CI runs this mode.
 *
 * Generated files are never edited by hand: change the source, then run this.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { OpenApiLockError } from "../bff/openapi/lock.ts";
import { REST_TYPES_RELATIVE_PATH, REST_TYPE_TARGETS, renderRestTypes } from "./rest-types.ts";

const APP_DIR = join(import.meta.dir, "..");
const REST_TYPES_FILE = join(APP_DIR, REST_TYPES_RELATIVE_PATH);
const PURS_GENERATED_DIR = join(APP_DIR, "src", "Generated");

async function snapshot(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(relative(APP_DIR, path), await readFile(path, "utf8"));
    }
  }
  await walk(dirname(REST_TYPES_FILE));
  await walk(PURS_GENERATED_DIR);
  return files;
}

async function generateRestTypes(): Promise<void> {
  for (const target of REST_TYPE_TARGETS) {
    const text = await renderRestTypes(target.pin, target.tags);
    const file = join(APP_DIR, target.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

async function generatePurescriptTypes(): Promise<void> {
  const proc = Bun.spawn(["bun", "scripts/sync-graphql.ts"], { cwd: APP_DIR, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`scripts/sync-graphql.ts failed (exit ${code})`);
}

const check = process.argv.includes("--check");
const before = check ? await snapshot() : new Map<string, string>();

try {
  await generateRestTypes();
  await generatePurescriptTypes();
} catch (error) {
  if (error instanceof OpenApiLockError) {
    console.error(`Codegen refused: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

if (check) {
  const after = await snapshot();
  const differing = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  if (differing.length > 0) {
    console.error("Generated files are out of date. Run `bun run codegen` in apps/shuttlepub-web and commit the result:");
    for (const path of differing) {
      const state = !before.has(path) ? "missing" : !after.has(path) ? "stale" : "changed";
      console.error(`  ${state}: ${path}`);
    }
    process.exit(1);
  }
  console.log("Generated files are up to date.");
}
