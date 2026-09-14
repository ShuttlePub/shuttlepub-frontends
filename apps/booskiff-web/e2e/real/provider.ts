import { z } from "zod";

const redirectSchema = z.object({ redirect_to: z.url() });
const identitySchema = z.object({
  active: z.literal(true),
  identity: z.object({ id: z.string(), traits: z.object({ email: z.email() }) }),
});
const consentSchema = z.object({
  subject: z.string(),
  requested_scope: z.array(z.string()),
  requested_access_token_audience: z.array(z.string()),
  context: z.object({ email: z.email() }),
});
const decisionSchema = z.object({
  consent_challenge: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
});
const admin = "http://hydra:4445/admin/oauth2/auth/requests";
const origin = "http://127.0.0.1:3212";

class ProviderResponseError extends Error {
  constructor(readonly status: number) {
    super(`Identity provider returned HTTP ${status}`);
  }
}

async function providerRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ProviderResponseError(response.status);
  return response.json();
}

async function decide(url: string, body: unknown): Promise<Response> {
  const result = redirectSchema.parse(await providerRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return Response.redirect(result.redirect_to, 303);
}

// Test-only relying-party bridge: credentials and tokens are owned by Kratos/Hydra.
Bun.serve({
  port: 3212,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/login" && request.method === "GET") {
      const challenge = z.string().min(1).parse(url.searchParams.get("login_challenge"));
      const session = await fetch("http://kratos:4433/sessions/whoami", {
        headers: { Cookie: request.headers.get("cookie") ?? "" },
        signal: AbortSignal.timeout(10_000),
      });
      if (session.status === 401) {
        return decide(`${admin}/login/reject?login_challenge=${encodeURIComponent(challenge)}`, {
          error: "login_required", error_description: "Kratos session required",
        });
      }
      if (!session.ok) throw new ProviderResponseError(session.status);
      const { identity } = identitySchema.parse(await session.json());
      return decide(`${admin}/login/accept?login_challenge=${encodeURIComponent(challenge)}`, {
        subject: identity.id, context: { email: identity.traits.email }, remember: false,
      });
    }
    if (url.pathname === "/consent" && request.method === "GET") {
      const challenge = z.string().min(1).parse(url.searchParams.get("consent_challenge"));
      consentSchema.parse(await providerRequest(`${admin}/consent?consent_challenge=${encodeURIComponent(challenge)}`));
      return new Response(`<form method="post" action="/consent"><input type="hidden" name="consent_challenge" value="${Bun.escapeHTML(challenge)}"><button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`, {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      });
    }
    if (url.pathname === "/consent" && request.method === "POST") {
      if (request.headers.get("origin") !== origin) return new Response(null, { status: 403 });
      const form = await request.formData();
      const { consent_challenge, decision } = decisionSchema.parse(Object.fromEntries(form));
      const query = `consent_challenge=${encodeURIComponent(consent_challenge)}`;
      switch (decision) {
        case "deny":
          return decide(`${admin}/consent/reject?${query}`, { error: "access_denied" });
        case "allow": {
          const consent = consentSchema.parse(await providerRequest(`${admin}/consent?${query}`));
          return decide(`${admin}/consent/accept?${query}`, {
            grant_scope: consent.requested_scope,
            grant_access_token_audience: consent.requested_access_token_audience,
            remember: false,
            session: { id_token: { email: consent.context.email }, access_token: { owner_type: "account" } },
          });
        }
        default: {
          const unreachable: never = decision;
          return unreachable;
        }
      }
    }
    return new Response(null, { status: 404 });
  },
});
