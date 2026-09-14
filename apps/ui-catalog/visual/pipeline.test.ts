import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

async function run(script: string, env: Readonly<Record<string, string>>) {
  const child = Bun.spawn(["bun", join(import.meta.dir, script)], {
    cwd: join(import.meta.dir, ".."), env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, stdout + stderr).toBe(0);
  return stdout;
}

test("detects changed, added and deleted PNGs and publishes inline images to local storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-diff-"));
  try {
    const white = new PNG({ width: 20, height: 20 });
    white.data.fill(255);
    const black = new PNG({ width: 20, height: 20 });
    for (let i = 3; i < black.data.length; i += 4) black.data[i] = 255;
    for (const side of ["actual", "expected"]) {
      await mkdir(join(root, side));
      await Bun.write(join(root, side, "same.png"), PNG.sync.write(white));
      await Bun.write(join(root, side, "changed.png"), PNG.sync.write(side === "actual" ? black : white));
    }
    await Bun.write(join(root, "actual/new.png"), PNG.sync.write(white));
    await Bun.write(join(root, "expected/deleted.png"), PNG.sync.write(white));
    await run("compare.ts", { VISUAL_DIR: root });
    expect(await Bun.file(join(root, "result.json")).json()).toEqual({
      failedItems: ["changed.png"], newItems: ["new.png"], deletedItems: ["deleted.png"], passedItems: ["same.png"],
    });
    const store = join(root, "store");
    await run("publish.ts", { VISUAL_DIR: root, LOCAL_STORE: store, VISUAL_KEY: "run-1", VISUAL_REVISION: "abcdef1", R2_PUBLIC_URL: "https://visual.example" });
    expect(PNG.sync.read(Buffer.from(await Bun.file(join(store, "ui-catalog/run-1/diff/changed.png")).bytes())).width).toBeGreaterThan(0);
    expect(await Bun.file(join(root, "comment.md")).text()).toContain("![diff](https://visual.example/ui-catalog/run-1/diff/changed.png)");
    expect(await Bun.file(join(store, "ui-catalog/run-1/index.html")).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("returns only passed images when actual and expected PNGs match", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-same-"));
  try {
    const image = new PNG({ width: 20, height: 20 });
    image.data.fill(255);
    await mkdir(join(root, "actual"));
    await Bun.write(join(root, "actual/same.png"), PNG.sync.write(image));
    await cp(join(root, "actual"), join(root, "expected"), { recursive: true });
    await run("compare.ts", { VISUAL_DIR: root });
    expect(await Bun.file(join(root, "result.json")).json()).toEqual({
      failedItems: [], newItems: [], deletedItems: [], passedItems: ["same.png"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
