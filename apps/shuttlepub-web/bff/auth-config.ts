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
  /**
   * The public actor host of this deployment: the host[:port] of Emumet's PUBLIC_BASE_URL
   * (actor ids, acct). Used to refuse muting/blocking our own server as a domain. Optional at
   * startup; when it is missing the domain settings cannot add anything (never guessed from
   * EMUMET_API_URL, which may be an internal host).
   */
  emumetPublicHost?: string;
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
  const publicHost = env["EMUMET_PUBLIC_HOST"]?.trim();
  if (publicHost && !PUBLIC_HOST.test(publicHost)) {
    throw new ConfigError("EMUMET_PUBLIC_HOST must be a host[:port] without scheme or path (Emumet PUBLIC_BASE_URL host)");
  }
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
    ...(publicHost ? { emumetPublicHost: publicHost } : {}),
  };
}

const PUBLIC_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?$/i;
