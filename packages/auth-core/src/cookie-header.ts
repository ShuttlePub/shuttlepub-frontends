export function buildCookieHeader(
  isSecureOrigin: boolean,
  name: string,
  value: string,
  opts: { maxAge?: number; path?: string } = {},
): string {
  const parts = [`${name}=${value}`, `Path=${opts.path || "/"}`, "HttpOnly", "SameSite=Lax"];
  if (isSecureOrigin) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

/**
 * Cookie ヘッダから `name` の値を取り出す。同名 cookie が複数あれば null (fail-closed)。
 *
 * Cookie ヘッダには Domain / Path が含まれないため、兄弟 Domain などから注入された同名 cookie と
 * 正規の cookie を区別できない。「最初の値を採用する」と cookie tossing で state / PKCE /
 * セッションを差し替えられるので、曖昧な場合はどれも採用しない。値が空の同名 cookie も曖昧さに数える。
 */
export function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  let found: string | null = null;
  let count = 0;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    count += 1;
    found = part.slice(eq + 1).trim();
  }
  return count === 1 && found ? found : null;
}
