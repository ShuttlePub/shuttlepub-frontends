import "./test-setup.ts";
import { afterAll, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { setOAuthCookie } from "@shuttlepub/auth-bun";
import { handleAuthRequest, type RealAuthConfig } from "./routes.ts";
import { createTestSessionAdapter } from "./session-test-adapter.ts";
import { TEST_COOKIE_SECRET_BASE64 } from "./test-setup.ts";

const keys = await generateKeyPair("RS256");
const wrongKeys = await generateKeyPair("RS256");
const jwk = await exportJWK(keys.publicKey);
let idToken: string | undefined = "";
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "oidc", alg: "RS256", use: "sig" }] });
    if (path === "/oauth2/token") return Response.json({
      access_token: "access", expires_in: 3600, scope: "openid", token_type: "Bearer", id_token: idToken,
    });
    return new Response(null, { status: 404 });
  },
});
afterAll(() => server.stop(true));
const issuer = server.url.origin;
const config: RealAuthConfig = {
  kind: "real", kratosPublicUrl: issuer, hydraPublicUrl: issuer, hydraClientId: "client",
  hydraClientSecret: "secret", hydraRedirectUri: "http://localhost:3000/auth/callback",
  hydraScopes: "openid", hydraAudience: "account", oauthStateTtlSeconds: 300,
};
const adapter = createTestSessionAdapter({
  cookieSecretBase64: TEST_COOKIE_SECRET_BASE64, sessionCookieName: "booskiff_session",
  isSecureOrigin: false, hydraPublicUrl: issuer, hydraClientId: "client", hydraClientSecret: "secret", refreshSkewSeconds: 60,
});

test.each(["signature", "issuer", "audience", "expiry"])("rejects callback without session cookie when ID token has invalid %s", async (invalid) => {
  const now = Math.floor(Date.now() / 1000);
  idToken = await new SignJWT({ email: "alice@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "oidc" }).setSubject("alice")
    .setIssuer(invalid === "issuer" ? "https://attacker.test" : issuer)
    .setAudience(invalid === "audience" ? "wrong-client" : "client")
    .setIssuedAt(now).setExpirationTime(invalid === "expiry" ? now - 60 : now + 300)
    .sign(invalid === "signature" ? wrongKeys.privateKey : keys.privateKey);
  const headers = new Headers();
  await setOAuthCookie(headers, { v: 1, state: "state", codeVerifier: "verifier", returnTo: "/drive", expiresAt: now + 300 });
  const response = await handleAuthRequest(new Request("http://localhost:3000/auth/callback?code=code&state=state", {
    headers: { cookie: headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") },
  }), { adapter, mode: config });
  expect(response?.headers.get("location")).toStartWith("/login?error=");
  expect(response?.headers.getSetCookie().some((cookie) => cookie.startsWith("booskiff_session="))).toBe(false);
});

test("rejects missing ID token without issuing a session", async () => {
  idToken = undefined;
  const headers = new Headers();
  await setOAuthCookie(headers, { v: 1, state: "missing", codeVerifier: "verifier", returnTo: "/drive", expiresAt: Math.floor(Date.now() / 1000) + 300 });
  const response = await handleAuthRequest(new Request("http://localhost:3000/auth/callback?code=code&state=missing", {
    headers: { cookie: headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") },
  }), { adapter, mode: config });
  expect(response?.headers.get("location")).toBe("/login?error=missing_id_token");
  expect(response?.headers.getSetCookie().some((cookie) => cookie.startsWith("booskiff_session="))).toBe(false);
});

test("creates session with verified identity when ID token is valid", async () => {
  const now = Math.floor(Date.now() / 1000);
  idToken = await new SignJWT({ email: "alice@example.test" }).setProtectedHeader({ alg: "RS256", kid: "oidc" })
    .setSubject("alice").setIssuer(issuer).setAudience("client").setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
  const headers = new Headers();
  await setOAuthCookie(headers, { v: 1, state: "valid", codeVerifier: "verifier", returnTo: "/drive", expiresAt: now + 300 });
  const response = await handleAuthRequest(new Request("http://localhost:3000/auth/callback?code=code&state=valid", {
    headers: { cookie: headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") },
  }), { adapter, mode: config });
  expect(response?.headers.get("location")).toBe("/drive");
  const cookie = response?.headers.getSetCookie().find((value) => value.startsWith("booskiff_session="));
  const session = await adapter.getSession(new Request("http://localhost:3000/", { headers: { cookie: cookie?.split(";")[0] ?? "" } }));
  expect(session?.sub).toBe("alice");
  expect(session?.email).toBe("alice@example.test");
});
