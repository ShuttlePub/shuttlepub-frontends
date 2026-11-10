import { ConfigError } from "./config.ts";

export type AuthConfig = {
  appOrigin: string;
  emumetApiUrl: string;
  hydraPublicUrl: string;
  issuer: string;
  kratosPublicUrl: string;
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
};

/** Separate app-specific key: never inherit another app's COOKIE_SECRET_BASE64. */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new ConfigError(name + " is required in real mode");
    return value;
  };
  const baseUrl = (name: string): string => {
    const value = required(name);
    let url: URL;
    try { url = new URL(value); } catch { throw new ConfigError(name + " must be an http(s) URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new ConfigError(name + " must be an http(s) origin without credentials, path, query or fragment");
    }
    if (name === "APP_ORIGIN" && url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new ConfigError(name + " requires HTTPS outside loopback");
    }
    return url.origin;
  };
  const cookieSecret = required("SHUTTLEPUB_COOKIE_SECRET_BASE64");
  try {
    if (atob(cookieSecret).length !== 32) throw new Error();
  } catch { throw new ConfigError("SHUTTLEPUB_COOKIE_SECRET_BASE64 must encode exactly 32 bytes"); }
  const hydraPublicUrl = baseUrl("HYDRA_PUBLIC_URL");
  if (env["HYDRA_ISSUER_URL"]) baseUrl("HYDRA_ISSUER_URL");
  return {
    appOrigin: baseUrl("APP_ORIGIN"),
    emumetApiUrl: baseUrl("EMUMET_API_URL"),
    hydraPublicUrl,
    // Issuer matching is exact, including a configured trailing slash.
    issuer: env["HYDRA_ISSUER_URL"] || required("HYDRA_PUBLIC_URL"),
    kratosPublicUrl: baseUrl("KRATOS_PUBLIC_URL"),
    clientId: required("HYDRA_CLIENT_ID"),
    clientSecret: required("HYDRA_CLIENT_SECRET"),
    cookieSecret,
  };
}
