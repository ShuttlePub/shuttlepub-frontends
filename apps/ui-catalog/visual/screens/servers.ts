import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ScreenApp } from "./cases.ts";

export type AppServer = {
  app: ScreenApp;
  url: string;
  waitUntilReady: () => Promise<void>;
  stop: () => Promise<void>;
  logs: () => Promise<string>;
  networkViolations: () => Promise<string[]>;
};

export async function stopChild(child: Pick<Bun.Subprocess, "exitCode" | "kill" | "exited">, graceMs = 1000) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, graceMs);
  try { await child.exited; } finally { clearTimeout(deadline); }
}

export async function startApp(frontendRoot: string, app: ScreenApp, coreURL: string): Promise<AppServer> {
  const directory = resolve(frontendRoot, "apps", `${app.toLowerCase()}-web`);
  for (const file of ["dist/app.js", "dist/server.js", "dist/style.css"]) {
    if ((await stat(resolve(directory, file))).size === 0) throw new Error(`${app}: empty build output ${file}`);
  }
  // The applications do not export their Bun server, so reserve a free loopback
  // port before launching their unchanged entrypoints. A collision fails readiness.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const url = `http://127.0.0.1:${port}`;
  const fixture = await readFile(resolve(import.meta.dir, "../../../booskiff-web/e2e/fixtures/jwtRS256.pkcs8.pem"));
  const scratch = await mkdtemp(resolve(tmpdir(), "frontend-visual-"));
  const networkLog = resolve(scratch, "network.jsonl");
  const process = Bun.spawn([Bun.which("bun") ?? globalThis.process.execPath, "--preload", resolve(import.meta.dir, "server-preload.ts"), "index.ts"], {
    cwd: directory,
    env: {
      ...globalThis.process.env,
      PORT: String(port), APP_ORIGIN: url, TZ: "UTC", USE_MOCK: "true", USE_TEST_JWT: "true",
      CORE_API_URL: coreURL, EMUMET_API_URL: coreURL,
      VISUAL_CORE_ORIGIN: coreURL, VISUAL_NETWORK_LOG: networkLog,
      SESSION_COOKIE_NAME: `${app.toLowerCase()}_visual_session`,
      OAUTH_COOKIE_NAME: `${app.toLowerCase()}_visual_oauth`,
      COOKIE_SECRET_BASE64: Buffer.alloc(32, 7).toString("base64"),
      TEST_JWT_PRIVATE_KEY_PEM_BASE64: fixture.toString("base64"), TEST_JWT_ISSUER: url,
    },
    stdout: "pipe", stderr: "pipe",
  });
  const logs = Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()])
    .then(([stdout, stderr]) => `${stdout}\n${stderr}`);
  return {
    app, url,
    async waitUntilReady() {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (process.exitCode !== null) throw new Error(`${app} exited (${process.exitCode}): ${await logs}`);
        try {
          const response = await fetch(`${url}/login`, { signal: AbortSignal.timeout(1000) });
          const html = await response.text();
          if (response.ok && html.includes("<template-state") && html.includes('id="app"')) return;
        } catch { /* The child has not bound its port yet. */ }
        await Bun.sleep(100);
      }
      throw new Error(`${app}: no built SSR response within 30 seconds at ${url}`);
    },
    async stop() {
      try { await stopChild(process); } finally { await rm(scratch, { recursive: true, force: true }); }
    },
    logs: () => logs,
    async networkViolations() {
      try {
        return (await readFile(networkLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
  };
}
