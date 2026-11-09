import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  test("defaults to mock when nothing is configured", () => {
    expect(loadConfig({})).toEqual({ mode: "mock" });
    expect(loadConfig({ SHUTTLEPUB_API_MODE: "" })).toEqual({ mode: "mock" });
  });

  test("real mode requires a backend URL and normalizes it", () => {
    expect(loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "http://localhost:8080/" })).toEqual({
      mode: "real",
      apiUrl: "http://localhost:8080",
    });
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "real" })).toThrow(ConfigError);
  });

  test("rejects unknown modes instead of picking one", () => {
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "Real" })).toThrow(ConfigError);
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "false" })).toThrow(ConfigError);
  });

  test("rejects a backend URL that is not http(s)", () => {
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "not a url" })).toThrow(ConfigError);
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "real", SHUTTLEPUB_API_URL: "ftp://example.test" })).toThrow(ConfigError);
  });

  test("refuses a backend URL in mock mode so a half-configured real setup cannot run on fixtures", () => {
    expect(() => loadConfig({ SHUTTLEPUB_API_URL: "http://localhost:8080" })).toThrow(/SHUTTLEPUB_API_MODE=real/);
    expect(() => loadConfig({ SHUTTLEPUB_API_MODE: "mock", SHUTTLEPUB_API_URL: "http://localhost:8080" })).toThrow(ConfigError);
  });
});
