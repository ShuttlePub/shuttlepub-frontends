import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBooskiffClient } from "../../../booskiff-web/bff/booskiff/real.ts";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { FIXED_TIME, SCREEN_CASES } from "./cases.ts";
import { captureSide, featuresInShuttlePubHtml, selectCases } from "./features.ts";
import { AVATAR_SVG, BANNER_SVG, BILLING, FILES, FOLDERS, localImage } from "./fixtures.ts";
import { appExists, stopChild } from "./servers.ts";

test("screen inventory covers every app and state at desktop/mobile sizes with safe unique filenames", () => {
  // Given / When
  const names = SCREEN_CASES.map((item) => item.filename);
  // Then
  expect(new Set(names).size).toBe(SCREEN_CASES.length);
  expect(SCREEN_CASES).toHaveLength(52);
  for (const item of SCREEN_CASES) {
    expect(item.filename).toMatch(/^(Booskiff|Emumet|ShuttlePub)-[A-Za-z0-9-]+\.png$/);
    expect(item.path).toMatch(/^\/(?!\/)/);
    expect(SCREEN_CASES.filter((other) => other.app === item.app && other.id === item.id)
      .map((other) => other.viewport.name)).toEqual(["desktop", "mobile"]);
  }
  for (const app of ["Booskiff", "Emumet"]) {
    expect(SCREEN_CASES.filter((item) => item.app === app && item.id === "login")
      .every((item) => !item.authenticated)).toBe(true);
  }
});

test("ShuttlePub cases cover the SNS shell screens at both widths and need no login", () => {
  // Given / When
  const cases = SCREEN_CASES.filter((item) => item.app === "ShuttlePub");
  // Then
  expect([...new Set(cases.map((item) => item.id))].sort()).toEqual([
    "compose", "compose-visibility", "home", "not-found", "post-detail", "profile-menu",
    "reaction-detail", "reaction-picker", "reaction-picker-no-favorites", "reaction-settings-menu", "reaction-undo", "settings",
  ]);
  expect(cases.every((item) => !item.authenticated)).toBe(true);
  // Screens that main already served (as F0 placeholders) need no feature, so they
  // are always compared; the new screens declare the SNS shell or the quick reaction UI.
  for (const item of cases) {
    const required = "requires" in item ? item.requires : undefined;
    const expected = ["home", "not-found"].includes(item.id) ? undefined : item.id.startsWith("reaction-") ? "quick-reaction" : "sns-shell";
    expect(required).toBe(expected);
  }
});

test("only the baseline side may skip cases whose screen feature is missing", () => {
  // Given
  const shuttlePub = SCREEN_CASES.filter((item) => item.app === "ShuttlePub");
  const placeholderHtml = '<main id="app"><h1>ShuttlePub</h1><template-state></template-state></main>';
  const shellHtml = '<main id="app" lang="ja"><div class="sp-app" data-testid="app-shell"></div></main>';
  const reactionHtml = '<main id="app" lang="ja"><div class="sp-app" data-testid="app-shell"><div class="sp-reaction-layer"></div></div></main>';
  // When / Then
  expect(featuresInShuttlePubHtml(placeholderHtml).size).toBe(0);
  expect([...featuresInShuttlePubHtml(shellHtml)]).toEqual(["sns-shell"]);
  const baseline = selectCases(shuttlePub, featuresInShuttlePubHtml(placeholderHtml), "baseline");
  expect(baseline.capture.map((item) => item.id).sort()).toEqual(["home", "home", "not-found", "not-found"]);
  expect(baseline.skipped).toHaveLength(shuttlePub.length - 4);
  expect(() => selectCases(shuttlePub, featuresInShuttlePubHtml(placeholderHtml), "branch")).toThrow(/sns-shell/);
  // A baseline with the shell but before the quick reaction UI skips only the reaction cases.
  const shellOnly = selectCases(shuttlePub, featuresInShuttlePubHtml(shellHtml), "baseline");
  expect(shellOnly.skipped.every((item) => item.id.startsWith("reaction-"))).toBe(true);
  expect(shellOnly.skipped).toHaveLength(10);
  expect(() => selectCases(shuttlePub, featuresInShuttlePubHtml(shellHtml), "branch")).toThrow(/quick-reaction/);
  expect([...featuresInShuttlePubHtml(reactionHtml)].sort()).toEqual(["quick-reaction", "sns-shell"]);
  expect(selectCases(shuttlePub, featuresInShuttlePubHtml(reactionHtml), "branch")).toEqual({ capture: shuttlePub, skipped: [] });
  expect(captureSide(undefined)).toBe("branch");
  expect(captureSide("baseline")).toBe("baseline");
  expect(() => captureSide("main")).toThrow();
});

test("app availability distinguishes a missing app directory from an existing app", async () => {
  // Given
  const scratch = await mkdtemp(resolve(tmpdir(), "visual-baseline-test-"));
  try {
    // When / Then
    expect(await appExists(scratch, "ShuttlePub")).toBe(false);
    await mkdir(resolve(scratch, "apps", "shuttlepub-web"), { recursive: true });
    expect(await appExists(scratch, "ShuttlePub")).toBe(true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("HTTP fixtures satisfy the production Booskiff REST client mappings and folder filtering", async () => {
  // Given
  const stub = startBooskiffStub();
  const client = createBooskiffClient({ coreApiUrl: stub.url }, "test-bearer");
  try {
    // When / Then: use the production wire decoder, not the stub's own types.
    expect(await client.listFiles()).toEqual(FILES);
    expect(await client.listFiles("folder-projects")).toEqual(FILES.slice(0, 2));
    expect(await client.listFiles("folder-archive")).toEqual([]);
    expect(await client.listFiles(undefined, true)).toEqual([FILES[2]]);
    expect(await client.getFile("file-design")).toEqual(FILES[0]);
    expect(await client.listFolders()).toEqual(FOLDERS);
    expect(await client.listFolders(undefined, true)).toEqual(FOLDERS);
    expect(await client.listFolders("folder-projects")).toEqual([]);
    expect(await client.getFolder("folder-projects")).toEqual(FOLDERS[0]);
    expect(await client.billingStatus()).toEqual(BILLING);
    expect(stub.unexpectedRequests).toEqual([]);
  } finally { stub.stop(); }
});

test("empty state clears folders, files and usage and resets without persisting between screenshots", async () => {
  // Given
  const stub = startBooskiffStub();
  const client = createBooskiffClient({ coreApiUrl: stub.url }, "test-bearer");
  try {
    // When
    stub.setState("empty");
    // Then
    expect(await client.listFiles()).toEqual([]);
    expect(await client.listFolders()).toEqual([]);
    expect(await client.billingStatus()).toEqual({ ...BILLING, usedBytes: 0 });
    stub.setState("populated");
    expect(await client.listFiles()).toEqual(FILES);
    expect(stub.unexpectedRequests).toEqual([]);
  } finally { stub.stop(); }
});

test("stub records missing authentication and unexpected writes as capture failures", async () => {
  // Given
  const stub = startBooskiffStub();
  try {
    // When
    const anonymous = await fetch(`${stub.url}/v1/files`);
    const mutation = await fetch(`${stub.url}/v1/folders`, {
      method: "POST", headers: { authorization: "Bearer test-bearer" }, body: "{}",
    });
    // Then
    expect(anonymous.status).toBe(401);
    expect(mutation.status).toBe(501);
    expect(stub.unexpectedRequests).toEqual(["Missing bearer token: GET /v1/files", "POST /v1/folders"]);
  } finally { stub.stop(); }
});

test("external image substitution only serves the built-in mock image URLs", () => {
  // Given / When / Then
  expect(localImage("https://api.dicebear.com/9.x/thumbs/svg?seed=alice")).toBe(AVATAR_SVG);
  expect(localImage("https://picsum.photos/seed/alice/800/200")).toBe(BANNER_SVG);
  for (const url of [
    "https://api.dicebear.com.evil.test/9.x/thumbs/svg?seed=alice",
    "https://api.dicebear.com/9.x/thumbs/svg?seed=unknown",
    "https://api.dicebear.com/9.x/thumbs/svg?seed=alice&other=true",
    "https://picsum.photos/seed/random/800/200",
    "https://example.com/image.png",
  ]) expect(localImage(url)).toBeUndefined();
});

test("server preload fixes default dates while retaining parsing and live timers", async () => {
  // Given
  const scratch = await mkdtemp(resolve(tmpdir(), "visual-preload-test-"));
  const child = Bun.spawn([process.execPath, "--preload", resolve(import.meta.dir, "server-preload.ts"), "--eval", `
    const start = performance.now();
    await Bun.sleep(20);
    console.log(JSON.stringify({ now: Date.now(), date: new Date().toISOString(), explicit: new Date("2020-01-01").toISOString(), elapsed: performance.now() > start }));
  `], {
    env: { ...process.env, VISUAL_CORE_ORIGIN: "http://127.0.0.1:1", VISUAL_NETWORK_LOG: resolve(scratch, "network.jsonl") },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    // When
    const result = JSON.parse(await new Response(child.stdout).text());
    // Then
    expect(await child.exited).toBe(0);
    expect(result).toEqual({ now: Date.parse(FIXED_TIME), date: FIXED_TIME, explicit: "2020-01-01T00:00:00.000Z", elapsed: true });
  } finally {
    await stopChild(child);
    await rm(scratch, { recursive: true, force: true });
  }
});

test("server preload blocks other origins and redirects and records swallowed fetch failures", async () => {
  // Given
  const scratch = await mkdtemp(resolve(tmpdir(), "visual-fetch-test-"));
  const networkLog = resolve(scratch, "network.jsonl");
  let deniedRequests = 0;
  const denied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { deniedRequests++; return new Response("live data"); } });
  const deniedURL = `http://127.0.0.1:${denied.port}`;
  const allowed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) =>
    new URL(req.url).pathname === "/redirect" ? Response.redirect(deniedURL) : Response.json({ fixture: true }),
  });
  const allowedURL = `http://127.0.0.1:${allowed.port}`;
  const child = Bun.spawn([process.execPath, "--preload", resolve(import.meta.dir, "server-preload.ts"), "--eval", `
    console.log(JSON.stringify(await (await fetch(${JSON.stringify(allowedURL)})).json()));
    try { await fetch(${JSON.stringify(deniedURL)}); } catch {}
    try { await fetch(${JSON.stringify(`${allowedURL}/redirect`)}); } catch {}
  `], { env: { ...process.env, VISUAL_CORE_ORIGIN: allowedURL, VISUAL_NETWORK_LOG: networkLog }, stdout: "pipe", stderr: "pipe" });
  try {
    // When
    const result = JSON.parse(await new Response(child.stdout).text());
    // Then
    expect(await child.exited).toBe(0);
    expect(result).toEqual({ fixture: true });
    expect(deniedRequests).toBe(0);
    const violations = (await readFile(networkLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(violations).toHaveLength(2);
    expect(violations[0]).toBe(`Unexpected server fetch: ${deniedURL}/`);
    expect(violations[1]).toContain(`Failed server fetch: ${allowedURL}/redirect`);
  } finally {
    await stopChild(child);
    denied.stop(true);
    allowed.stop(true);
    await rm(scratch, { recursive: true, force: true });
  }
});

test("cleanup kills a server that ignores SIGTERM after a bounded grace period", async () => {
  // Given
  const child = Bun.spawn([process.execPath, "--eval", `
    process.on("SIGTERM", () => {});
    console.log("ready");
    setInterval(() => {}, 1000);
  `], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
    // When
    const started = performance.now();
    await stopChild(child, 100);
    // Then
    expect(child.signalCode).toBe("SIGKILL");
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    reader.releaseLock();
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
});
