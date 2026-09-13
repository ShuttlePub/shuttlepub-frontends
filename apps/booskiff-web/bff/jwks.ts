// ============================================================
// /.well-known/jwks.json — mock / USE_TEST_JWT モードでのみ公開される。
// e2e は TEST_JWT_JWKS_JSON をマウントする (内容を verbatim で返す)。
// 未設定の場合は TEST_JWT_PUBLIC_KEY_PEM (PEM ファイルパス) から単一の
// RSA JWK (kid "test-key", use "sig", alg "RS256") を導出する。
// どちらも無い場合は 404。
// ============================================================

import { pemToDer } from "./test-jwt.ts";

export type JwksSource = {
  /** env TEST_JWT_JWKS_JSON — そのまま返す */
  readonly jwksJson: string | null;
  /** env TEST_JWT_PUBLIC_KEY_PEM — PEM ファイルのパス */
  readonly publicKeyPemPath: string | null;
};

export async function buildJwksResponse(source: JwksSource): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("not found", { status: 404 });
  if (source.jwksJson !== null) {
    return new Response(source.jwksJson, { headers: { "Content-Type": "application/json" } });
  }
  if (source.publicKeyPemPath !== null) {
    const pem = await Bun.file(source.publicKeyPemPath).text();
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return Response.json({
      keys: [{ kid: "test-key", use: "sig", alg: "RS256", kty: jwk.kty, n: jwk.n, e: jwk.e }],
    });
  }
  return new Response("not found", { status: 404 });
}
