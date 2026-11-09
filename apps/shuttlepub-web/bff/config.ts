// Startup configuration. The data source is chosen explicitly, once, here.
//
//   SHUTTLEPUB_API_MODE   "mock" (default) | "real"; any other value is an error
//   SHUTTLEPUB_API_URL    base URL of the ShuttlePub backend; required for real,
//                         and rejected for mock so a half-configured real setup
//                         cannot quietly run on fixtures
//
// There is no runtime switching and no fallback between the two modes.

import type { ApiMode } from "./rest/client.ts";

export type AppConfig = { mode: "mock" } | { mode: "real"; apiUrl: string };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const rawMode = env["SHUTTLEPUB_API_MODE"];
  const rawUrl = env["SHUTTLEPUB_API_URL"];
  const mode: ApiMode = parseMode(rawMode);

  if (mode === "mock") {
    if (rawUrl !== undefined && rawUrl !== "") {
      throw new ConfigError(
        "SHUTTLEPUB_API_URL is set but SHUTTLEPUB_API_MODE is mock. " +
          "Set SHUTTLEPUB_API_MODE=real to use the backend, or unset SHUTTLEPUB_API_URL.",
      );
    }
    return { mode: "mock" };
  }

  if (rawUrl === undefined || rawUrl === "") {
    throw new ConfigError("SHUTTLEPUB_API_MODE=real requires SHUTTLEPUB_API_URL (the ShuttlePub backend base URL).");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`SHUTTLEPUB_API_URL is not a valid URL: ${JSON.stringify(rawUrl)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`SHUTTLEPUB_API_URL must be http(s), got ${url.protocol}`);
  }
  return { mode: "real", apiUrl: url.origin + url.pathname.replace(/\/+$/, "") };
}

function parseMode(raw: string | undefined): ApiMode {
  if (raw === undefined || raw === "") return "mock";
  if (raw === "mock" || raw === "real") return raw;
  throw new ConfigError(`SHUTTLEPUB_API_MODE must be "mock" or "real", got ${JSON.stringify(raw)}`);
}
