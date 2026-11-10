import { describe, expect, test } from "bun:test";
import { ShuttlePubApiError } from "./client.ts";
import { apiStatusFixture, notImplementedFixture } from "./fixtures.ts";
import { createRealApi } from "./real.ts";

function respond(status: number, body: unknown, init: { raw?: boolean } = {}) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return new Response(init.raw ? String(body) : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

async function failure(promise: Promise<unknown>): Promise<ShuttlePubApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ShuttlePubApiError);
    return error as ShuttlePubApiError;
  }
  throw new Error("expected the call to fail");
}

describe("real adapter", () => {
  test("returns a contract-conformant 200 body and calls the documented path", async () => {
    const { fetch, requests } = respond(200, apiStatusFixture);
    const api = createRealApi({ baseUrl: "http://backend.test", fetch });
    expect(api.mode).toBe("real");
    expect(await api.getApiStatus()).toEqual(apiStatusFixture);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/status");
  });

  test("501 is a not_implemented error carrying the backend's ErrorBody, never data", async () => {
    const { fetch } = respond(501, notImplementedFixture);
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("not_implemented");
    expect(error.status).toBe(501);
    expect(error.body).toEqual(notImplementedFixture);
    expect(error.message).toBe(notImplementedFixture.message);
  });

  test("501 with a non-contract body is still not_implemented", async () => {
    const { fetch } = respond(501, "<html>nope</html>", { raw: true });
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("not_implemented");
    expect(error.body).toBeUndefined();
  });

  test("other error statuses are upstream_error, not success and not mock data", async () => {
    const body = { code: "internal" as const, message: "boom" };
    const { fetch } = respond(500, body);
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("upstream_error");
    expect(error.status).toBe(500);
    expect(error.body).toEqual(body);
  });

  test("an unreachable backend is unavailable (no fallback)", async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError("connect ECONNREFUSED");
    };
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("unavailable");
    expect(error.status).toBeUndefined();
  });

  test("a 200 whose body violates the pinned contract is invalid_response", async () => {
    const { fetch } = respond(200, { api_version: 1 });
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("invalid_response");
  });

  test("a 200 whose body is not JSON is invalid_response, not unavailable", async () => {
    const { fetch } = respond(200, "<html>proxy error page</html>", { raw: true });
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("invalid_response");
    expect(error.status).toBe(200);
  });

  test("a success status the contract does not document is invalid_response", async () => {
    const fetch = async () => new Response(null, { status: 204 });
    const error = await failure(createRealApi({ baseUrl: "http://backend.test", fetch }).getApiStatus());
    expect(error.kind).toBe("invalid_response");
    expect(error.status).toBe(204);
  });
});
