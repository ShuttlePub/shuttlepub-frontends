/** CookieJar — for proxying multi-step Kratos flows */
export class CookieJar {
  private jar = new Map<string, string>();
  private setCookieHeaders: string[] = [];

  /** Ingest Set-Cookie headers from an upstream response */
  ingest(response: Response): void {
    for (const setCookie of response.headers.getSetCookie()) {
      this.setCookieHeaders.push(setCookie);
      // Parse cookie name=value for jar
      const match = setCookie.match(/^([^=]+)=([^;]*)/);
      if (match) this.jar.set(match[1]!, match[2]!);
    }
  }

  /** Build Cookie header string from jar for upstream requests */
  toCookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /**
   * Add only Kratos-relevant browser cookies (filter out app cookies to avoid leaking secrets).
   * 同名 cookie が複数ある名前は、どれが正規の cookie か判別できない (cookie tossing) ので
   * 転送しない。upstream へは未認証・flow なしとして扱われ fail-closed になる。
   */
  mergeBrowserCookies(req: Request): void {
    const browserCookies = req.headers.get("cookie");
    if (!browserCookies) return;
    const seen = new Map<string, string[]>();
    for (const part of browserCookies.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (!name || !name.startsWith("ory_kratos")) continue;
      const values = seen.get(name) ?? [];
      values.push(rest.join("="));
      seen.set(name, values);
    }
    for (const [name, values] of seen) {
      if (values.length === 1 && !this.jar.has(name)) this.jar.set(name, values[0]!);
    }
  }

  /** Append only Kratos-related Set-Cookie headers to the downstream response (filter out non-Kratos cookies) */
  applyToResponse(headers: Headers): void {
    for (const sc of this.setCookieHeaders) {
      // Only forward cookies that start with ory_kratos
      const match = sc.match(/^([^=]+)=/);
      if (match && match[1]!.startsWith("ory_kratos")) {
        headers.append("Set-Cookie", sc);
      }
    }
  }
}
