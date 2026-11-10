// bff/schema.graphql から src/Generated/** (PureScript の GraphQL 型) が再現できること。
// scripts/sync-graphql.ts を一時ディレクトリで実行し、コミット済みの生成物と全ファイル一致を確認する。
// 生成物は手編集しない: SDL を直して `bun run codegen` で再生成する。

import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const APP_DIR = join(import.meta.dir, "..");

async function readTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(relative(root, path), await readFile(path, "utf8"));
    }
  }
  await walk(root);
  return files;
}

test("src/Generated is exactly what sync-graphql produces from bff/schema.graphql", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "emumet-web-sync-graphql-"));
  try {
    const proc = Bun.spawn(["bun", join(APP_DIR, "scripts", "sync-graphql.ts"), "--schema", join(APP_DIR, "bff", "schema.graphql")], {
      cwd: scratch,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code, stderr).toBe(0);
    const regenerated = await readTree(join(scratch, "src", "Generated"));
    const committed = await readTree(join(APP_DIR, "src", "Generated"));
    expect([...regenerated.keys()].sort()).toEqual([...committed.keys()].sort());
    for (const [path, content] of committed) {
      expect(regenerated.get(path), path).toBe(content);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);
