import { expect, test } from "bun:test";
import { buildJwksResponse } from "./jwks.ts";

test("does not publish test keys when NODE_ENV is production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await buildJwksResponse({ jwksJson: '{"keys":[]}', publicKeyPemPath: null });
    expect(response.status).toBe(404);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
