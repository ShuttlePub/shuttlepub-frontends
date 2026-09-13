import "./test-setup.ts";
import { expect, test } from "bun:test";
import type { AppSession, SessionAdapter } from "@shuttlepub/auth-bun";
import { handleApiRequest } from "./api.ts";
import { createMockBooskiffClient } from "./booskiff/mock.ts";

const session: AppSession = {
  v: 1, sub: "user-1", accessToken: "access", tokenType: "Bearer", scope: "", expiresAt: 9999999999,
};
const adapter: SessionAdapter = {
  getSession: async () => session,
  refreshSessionIfNeeded: async () => ({ kind: "fresh", accessToken: session.accessToken }),
  sealSessionCookie: async () => "",
  clearSessionCookie: () => "",
};

for (const method of ["POST", "PATCH", "DELETE"]) {
  test.each([
    new Headers({ origin: "https://attacker.test" }),
    new Headers(),
    new Headers({ referer: "https://attacker.test/page" }),
    new Headers({ referer: "malformed" }),
    new Headers({ origin: "https://attacker.test", referer: "http://localhost:3000/drive" }),
  ])(`rejects ${method} before upstream mutation when origin evidence is invalid: %j`, async (headers) => {
    // Given: an authenticated browser with invalid origin evidence.
    let clientCreated = false;
    const req = new Request("http://localhost:3000/api/folders/f1", { method, headers });
    // When: it attempts a mutation.
    const response = await handleApiRequest(req, { adapter, createClient: () => {
      clientCreated = true;
      return createMockBooskiffClient();
    } });
    // Then: CSRF rejection precedes core access.
    expect(response?.status).toBe(403);
    expect(clientCreated).toBe(false);
  });
}

test.each([new Headers({ origin: "http://localhost:3000" }), new Headers({ referer: "http://localhost:3000/drive" })])(
  "allows mutation when same-origin evidence is valid: %j", async (headers) => {
    // Given: an authenticated same-origin request.
    const req = new Request("http://localhost:3000/api/folders", {
      method: "POST", headers, body: JSON.stringify({ name: "docs" }),
    });
    // When: it creates a folder.
    const response = await handleApiRequest(req, { adapter, createClient: () => createMockBooskiffClient() });
    // Then: the mutation succeeds.
    expect(response?.status).toBe(201);
  },
);
