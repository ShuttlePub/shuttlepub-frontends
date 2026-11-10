import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSsrRenderer } from "./ssr.ts";

const bundle = (label: string) => `export const renderPage = (path) => () => "${label}:" + path;\n`;

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "shuttlepub-ssr-"));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("SSR bundle loader", () => {
  test("renders nothing until a bundle exists", async () => {
    expect(await createSsrRenderer(await scratch()).render("/")).toBeNull();
  });

  test("a rebuilt bundle is used by the next render without restarting the process", async () => {
    const dir = await scratch();
    const renderer = createSsrRenderer(dir);
    await writeFile(join(dir, "server.js"), bundle("old"));
    expect(await renderer.render("/a")).toBe("old:/a");
    expect(await renderer.render("/b")).toBe("old:/b");

    await writeFile(join(dir, "server.js"), bundle("new"));
    // Same size as before, so only the modification time can reveal the rebuild.
    const later = new Date(Date.now() + 5_000);
    await utimes(join(dir, "server.js"), later, later);
    expect(await renderer.render("/a")).toBe("new:/a");
  });
});
