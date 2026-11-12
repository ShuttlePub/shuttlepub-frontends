// Domain handling for Profile domain controls (D08, ui-spec 1-4).
//
// Two layers:
//   checkDomainInput  what the settings "+" dialog accepts. It mechanically pulls the host
//                     out of URLs, acct:/@user@host handles and paths, drops the port,
//                     lower-cases, removes one trailing dot and converts IDN to its A-label.
//                     No guessing (www. is kept). Wildcards, IP addresses and this server
//                     are rejected with a short error.
//   canonicalDomain   Emumet's normalization of a stored domain (D8P `ControlDomain::parse`,
//                     host DC acceptance "D8P 確定契約"). The stateful mock uses it to answer
//                     like Emumet (422 for a malformed domain, the normalized form otherwise).
// Matching is exact: example.com never covers sub.example.com.

export type DomainInputError = "EMPTY" | "WILDCARD" | "INVALID" | "IP_ADDRESS" | "OWN_SERVER";
export type DomainResult = { domain: string } | { error: DomainInputError };

// D8P rule 1: characters that make a value a URL, wildcard, IPv6 literal or path rather than a host.
const FORBIDDEN = /[\s\p{Cc}*:/?#@\\[\]%^|<>]/u;
const LABELS = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function looksNumericLabel(label: string): boolean {
  return /^\d+$/.test(label) || /^0x[0-9a-f]*$/i.test(label);
}

/** Emumet's canonical form of a domain-control domain (D8P), or why it is rejected (422). */
export function canonicalDomain(raw: string): DomainResult {
  if (raw === "") return { error: "INVALID" };
  if (raw.includes("*")) return { error: "WILDCARD" };
  if (raw.includes("[")) return { error: "IP_ADDRESS" };
  if (FORBIDDEN.test(raw)) return { error: "INVALID" };
  // Rule 2: exactly one trailing dot is removed; "example.com.." stays malformed.
  const host = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (host === "" || host.endsWith(".")) return { error: "INVALID" };
  // Rule 5 is checked on the raw last label too: the URL parser turns 127.1 into 127.0.0.1.
  const lastRaw = host.split(".").at(-1) ?? "";
  if (looksNumericLabel(lastRaw.normalize("NFKC"))) return { error: "IP_ADDRESS" };
  let ascii: string;
  try {
    // Rule 3: UTS #46 non-transitional ASCII conversion (the WHATWG host parser), which
    // also folds case, full-width characters and ideographic full stops.
    ascii = new URL(`http://${host}`).hostname;
  } catch {
    return { error: "INVALID" };
  }
  if (DOTTED_QUAD.test(ascii)) return { error: "IP_ADDRESS" };
  // Rule 4: only [a-z0-9_-] labels joined by dots, within DNS length limits.
  if (!LABELS.test(ascii) || ascii.length > 253 || ascii.split(".").some((label) => label.length > 63)) {
    return { error: "INVALID" };
  }
  if (looksNumericLabel(ascii.split(".").at(-1) ?? "")) return { error: "IP_ADDRESS" };
  return { domain: ascii };
}

/** Pulls the host part out of what a person pastes (URL, acct, @user@host, host/path, host:port). */
function extractHost(input: string): DomainResult {
  let value = input.replace(/^acct:/i, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname === "") return { error: "INVALID" };
      return { domain: url.hostname };
    } catch {
      return { error: "INVALID" };
    }
  }
  const handle = /^@?[^@\s/]+@([^@\s/?#]+)(?:[/?#].*)?$/.exec(value);
  if (handle) value = handle[1] as string;
  else value = value.split(/[/?#]/, 1)[0] as string;
  if (value.startsWith("[")) return { error: "IP_ADDRESS" };
  return { domain: value.replace(/:\d*$/, "") };
}

/**
 * The domain of our own actors from a public host[:port] (Emumet PUBLIC_BASE_URL host): the
 * port is not part of a domain control. null when it is not a domain (e.g. an IP literal).
 */
export function ownActorDomain(publicHost: string): string | null {
  const host = publicHost.startsWith("[") ? publicHost : publicHost.replace(/:\d+$/, "");
  const result = canonicalDomain(host);
  return "domain" in result ? result.domain : null;
}

/**
 * What the settings dialog accepts (ui-spec 1-4 / 1-5). `selfDomains` are this server's own
 * actor domains, which cannot be muted or blocked as a domain.
 */
export function checkDomainInput(raw: string, selfDomains: readonly string[] = []): DomainResult {
  const input = raw.trim();
  if (input === "") return { error: "EMPTY" };
  if (input.includes("*")) return { error: "WILDCARD" };
  const host = extractHost(input);
  if ("error" in host) return host;
  const result = canonicalDomain(host.domain);
  if ("error" in result) return result;
  // The agreed mock refuses single-label names and labels that start or end with "-".
  const labels = result.domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.startsWith("-") || label.endsWith("-"))) return { error: "INVALID" };
  const self = selfDomains.map((domain) => domain.toLowerCase().replace(/\.$/, ""));
  if (self.includes(result.domain)) return { error: "OWN_SERVER" };
  return result;
}

/**
 * Host of a verified canonical actor URL, lower-cased and without port, for exact domain
 * matching (D8P `ControlDomain::from_actor_id`). null for anything that is not a plain
 * http(s) URL with a host name.
 */
export function actorDomain(actorUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(actorUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") return null;
  const result = canonicalDomain(url.hostname);
  return "domain" in result ? result.domain : null;
}
