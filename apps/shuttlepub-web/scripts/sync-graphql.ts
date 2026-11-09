/**
 * Usage: bun scripts/sync-graphql.ts [--generate-only] [--schema <path>]
 *
 * Generates PureScript GraphQL client types from the local SDL
 * (bff/schema.graphql) into src/Generated/ (git-tracked). Same method as
 * apps/emumet-web/scripts/sync-graphql.ts. Normally run through
 * `bun run codegen` (scripts/codegen.ts), which also verifies reproducibility.
 *
 * The codegen tool (purescript-graphql-client) requires a live introspection
 * URL, so this script:
 *   1. builds a resolver-less schema from the SDL via makeExecutableSchema,
 *   2. serves it on a random temporary port (Bun.serve, POST only),
 *   3. runs generateSchema against that URL,
 *   4. stops the server (try/finally — no orphan listeners).
 *
 * Flags:
 *   --generate-only  No-op flag. This script is inherently generate-only:
 *                    it always reads the local SDL, there is nothing to fetch.
 *   --schema <path>  SDL file to read (default: bff/schema.graphql).
 *                    Used by QA to point at a broken copy without touching
 *                    the real schema.
 */

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { graphqlSync, type ExecutionResult } from "graphql";
import { generateSchema } from "purescript-graphql-client";

interface GqlRequestBody {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Upstream workaround (purescript-graphql-client 10.1.1): the schema writer
// unconditionally emits `import Data.DateTime (DateTime)`.
//  - With a scalar named DateTime it also generates a local `type DateTime = ...`
//    alias, and the import becomes a ScopeConflict (mapped or not — verified
//    against gen-schema-bundled.mjs and unmapped output).
//  - Without such a scalar (this app's SDL has none) the import is simply unused
//    and would force a needless datetime dependency.
// Either way the import is unused, so remove exactly that line. If the file
// references DateTime without defining the alias, fail loudly instead of silently
// editing generated code.
async function dropConflictingDateTimeImport(path: string): Promise<void> {
  const source = await Bun.file(path).text();
  const importLine = "import Data.DateTime (DateTime)\n";
  if (!source.includes(importLine)) return;
  const hasAlias = /^type DateTime =/m.test(source);
  const referencedElsewhere = /\bDateTime\b/.test(source.replace(importLine, ""));
  if (!hasAlias && referencedElsewhere) {
    throw new Error(`${path}: unexpected codegen shape (DateTime import used without local alias)`);
  }
  await Bun.write(path, source.replace(importLine, ""));
  console.error(`  fixup ${path}: removed unused Data.DateTime import`);
}

// graphql v17 introspection reports DIRECTIVE_DEFINITION as a @deprecated
// location (new spec draft). The bundled codegen parser predates it and
// throws "Unknown directive location". The location is irrelevant to client
// codegen, so strip it from the introspection response before serving.
function stripDirectiveDefinitionLocation(result: ExecutionResult): void {
  const data = result.data;
  if (!isRecord(data)) return;
  const schema = data["__schema"];
  if (!isRecord(schema)) return;
  const directives = schema["directives"];
  if (!Array.isArray(directives)) return;
  for (const directive of directives) {
    if (!isRecord(directive)) continue;
    const locations = directive["locations"];
    if (!Array.isArray(locations)) continue;
    directive["locations"] = locations.filter((loc) => loc !== "DIRECTIVE_DEFINITION");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // --generate-only: accepted but a no-op (see header).
  void args.includes("--generate-only");

  let schemaPath = "bff/schema.graphql";
  const schemaIdx = args.indexOf("--schema");
  if (schemaIdx !== -1) {
    const value = args[schemaIdx + 1];
    if (!value) {
      console.error("Error: --schema requires a value");
      process.exit(1);
    }
    schemaPath = value;
  }

  console.error(`=== Step 1: Building schema from ${schemaPath} ===`);
  const sdl = await Bun.file(schemaPath).text();
  const schema = makeExecutableSchema({ typeDefs: sdl });

  console.error("=== Step 2: Starting temporary introspection server ===");
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      try {
        const body = (await req.json()) as GqlRequestBody;
        const result = graphqlSync({
          schema,
          source: body.query,
          variableValues: body.variables,
          operationName: body.operationName,
        });
        stripDirectiveDefinitionLocation(result);
        return Response.json(result);
      } catch (err) {
        return Response.json(
          { errors: [{ message: err instanceof Error ? err.message : String(err) }] },
          { status: 400 },
        );
      }
    },
  });
  console.error(`Temporary server listening on port ${server.port}`);

  try {
    console.error("=== Step 3: Generating PureScript types ===");
    const result = await generateSchema({
      dir: "./src/Generated",
      modulePath: ["Generated", "Gql"],
      url: `http://localhost:${server.port}/graphql`,
      // The bundled 10.1.1 codegen reads `gqlToPursTypes` (verified against
      // gen-schema-bundled.mjs optsJs keys). The README-documented
      // `gqlScalarsToPursTypes` key is silently ignored by this version —
      // passing it leaves DateTime mapped to Data.DateTime.DateTime.
      gqlToPursTypes: { DateTime: "String" },
    });
    const written = [...result.schemas, ...result.enums, ...result.directives, result.symbols];
    for (const { path } of written) {
      console.error(`  wrote ${path}`);
    }
    await dropConflictingDateTimeImport("./src/Generated/Schema/Gql.purs");

    // A type removed from the SDL leaves its old file behind; this script never
    // deletes, so report leftovers and let the operator remove them explicitly.
    const expected = new Set(written.map(({ path }) => resolve(path)));
    const stale: string[] = [];
    for (const entry of await readdir("./src/Generated", { recursive: true, withFileTypes: true })) {
      const path = resolve(entry.parentPath, entry.name);
      if (entry.isFile() && !expected.has(path)) stale.push(path);
    }
    if (stale.length > 0) {
      console.error(`Stale generated files not produced from the current SDL (delete them):\n${stale.map((path) => `  ${path}`).join("\n")}`);
      process.exitCode = 1;
    }

    console.error("=== Step 4: Formatting generated files ===");
    // CI provides purs-tidy on PATH (setup-purescript); locally fall back to bunx.
    const pursTidy = Bun.which("purs-tidy");
    const tidyCommand = pursTidy ? [pursTidy] : ["bunx", "purs-tidy"];
    const formatProc = Bun.spawnSync([...tidyCommand, "format-in-place", "./src/Generated"]);
    if (formatProc.exitCode !== 0) {
      console.error(`purs-tidy failed (exit ${formatProc.exitCode}):\n${formatProc.stderr.toString()}`);
      process.exit(formatProc.exitCode);
    }
    console.error("  formatted src/Generated/ with purs-tidy");
  } finally {
    server.stop(true);
    console.error("=== Step 5: Temporary server stopped ===");
  }

  console.error("Done. Generated files are in src/Generated/");
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
