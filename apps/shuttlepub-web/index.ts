// shuttlepub-web dev/SSR server: static assets, the /graphql BFF and Flame SSR.
//
// Data source: SHUTTLEPUB_API_MODE=mock|real (see bff/config.ts). Mock needs no
// backend, other repositories or network. Real talks to SHUTTLEPUB_API_URL and
// never falls back to mock data.
//
// SSR: dist/server.js (spago bundle output) is loaded lazily and re-loaded when it is
// rebuilt (bff/ssr.ts), so `bun index.ts` starts on a fresh checkout, serving a minimal
// shell until `spago bundle` has run, and dev rebuilds need no server restart.

import { join } from "node:path";
import { createApp } from "./bff/app.ts";
import { ConfigError, loadConfig } from "./bff/config.ts";
import { createSsrRenderer } from "./bff/ssr.ts";

const PORT = Number(process.env.PORT) || 3000;

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
const app = createApp(config);

const staticFiles: Record<string, { path: string; contentType: string }> = {
  "/app.js": { path: "dist/app.js", contentType: "application/javascript" },
  "/style.css": { path: "dist/style.css", contentType: "text/css" },
  "/theme.js": { path: "node_modules/@shuttlepub/design-tokens/theme.js", contentType: "application/javascript" },
};

function serveStatic(pathname: string): Response | null {
  const entry = staticFiles[pathname];
  if (!entry) return null;
  return new Response(Bun.file(join(import.meta.dir, entry.path)), {
    headers: { "Content-Type": entry.contentType },
  });
}

const SSR_SHELL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ShuttlePub</title><link rel="stylesheet" href="/style.css"></head>
<body><main id="app"><p>ShuttlePub UI is not built yet. Run <code>spago bundle</code> (see scripts/dev.sh).</p></main><script type="module" src="/app.js"></script></body>
</html>`;

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

const ssr = createSsrRenderer(join(import.meta.dir, "dist"));

async function serveSSR(url: URL): Promise<Response> {
  const html = await ssr.render(url.pathname + url.search);
  return new Response(html ?? SSR_SHELL_HTML, { headers: HTML_HEADERS });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const staticResponse = serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    if (url.pathname === "/graphql") return app.handleGraphql(req);

    return serveSSR(url);
  },
});

const target = config.mode === "real" ? `REAL: ${config.apiUrl}` : "MOCK";
console.log(`ShuttlePub web running at http://localhost:${PORT} (${target})`);
