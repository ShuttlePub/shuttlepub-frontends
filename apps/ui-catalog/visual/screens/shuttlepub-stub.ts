/**
 * Test-only ShuttlePub backend for the real-mode captures (cases.ts ScreenViewer).
 * The pinned OpenAPI has GET /api/v1/status only. Emumet / Hydra / Kratos origins
 * point here too, but a viewer without a usable session never reaches them: the BFF
 * rejects it before any upstream call, so every other request is recorded as unexpected.
 *
 * `authorize: "deny"` (shuttlepub-verify only) stands in for Hydra denying the
 * authorization request: GET /oauth2/auth redirects back to its redirect_uri with
 * error=access_denied and the request's own state, as the real provider does.
 */
export function startShuttlePubStub(options: { authorize?: "deny" } = {}) {
  const unexpectedRequests: string[] = [];
  const authorizeRequests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/v1/status") return Response.json({ api_version: "v1" });
      if (options.authorize === "deny" && request.method === "GET" && url.pathname === "/oauth2/auth") {
        authorizeRequests.push(url);
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "PROVIDER_TEXT");
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        return new Response(null, { status: 302, headers: { Location: back.toString() } });
      }
      unexpectedRequests.push(`${request.method} ${url.pathname}${url.search}`);
      return Response.json({ code: "not_found", message: "no such route" }, { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    unexpectedRequests,
    authorizeRequests,
    /** Real-mode BFF settings with fixture-only secrets. APP_ORIGIN comes from startApp. */
    env: {
      SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: url,
      EMUMET_API_URL: url, HYDRA_PUBLIC_URL: url, KRATOS_PUBLIC_URL: url,
      HYDRA_CLIENT_ID: "visual-shuttlepub", HYDRA_CLIENT_SECRET: "visual-fixture-only",
      SHUTTLEPUB_COOKIE_SECRET_BASE64: Buffer.alloc(32, 9).toString("base64"),
    },
    stop: () => server.stop(true),
  };
}

/** The loopback (http) session cookie name of apps/shuttlepub-web (bff/auth.ts). */
export const SHUTTLEPUB_LOOPBACK_SESSION_COOKIE = "shuttlepub_session";
