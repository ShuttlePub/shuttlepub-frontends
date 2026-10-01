/** Install before app imports: capture BFFs may fetch only the Core fixture. */
export function installFetchGuard(allowedOrigin: string, violation: (message: string) => void) {
  const nativeFetch = globalThis.fetch;
  const origin = new URL(allowedOrigin).origin;
  function assertAllowed(input: Parameters<typeof fetch>[0]) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) {
      const message = `Unexpected server fetch: ${url.href}`;
      violation(message);
      throw new Error(message);
    }
  }
  globalThis.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    assertAllowed(input);
    try {
      // A redirect from an allowed origin must not silently reach the internet.
      return await nativeFetch(input, { ...init, redirect: "error" });
    } catch (error) {
      violation(`Failed server fetch: ${String(input)}: ${String(error)}`);
      throw error;
    }
  }, {
    preconnect(...args: Parameters<typeof fetch.preconnect>) {
      assertAllowed(args[0]);
      return nativeFetch.preconnect(...args);
    },
  });
}
