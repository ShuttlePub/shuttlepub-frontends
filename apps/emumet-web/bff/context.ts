// ============================================================
// GraphQL context — SessionAdapter 経由のセッション解決 + 認証
// アダプタと EmumetClient ファクトリは index.ts から DI される。
// ============================================================

import { GraphQLError } from "graphql";
import type { SessionAdapter } from "@shuttlepub/auth-bun";
import type { EmumetClient } from "./emumet/client.ts";
import { emptyLoaders, makeLoaders as createLoaders, type Loaders } from "./loaders.ts";

export type { Loaders } from "./loaders.ts";

export type GraphQLContext = {
  readonly accessToken: string | null;
  readonly emumet: EmumetClient | null;
  /** 非 null ならレスポンスに Set-Cookie として付与する (refresh 成功時の seal 済み / 期限切れ時の clear-cookie) */
  readonly sessionCookieHeader: string | null;
  makeLoaders(): Loaders;
};

export type ContextDeps = {
  readonly adapter: SessionAdapter<{ accessToken: string }>;
  /** 認証済みリクエストでのみ呼ばれる。Real: token から Real client、Mock: プロセス共有の Mock client を返す */
  readonly createEmumetClient: (accessToken: string) => EmumetClient;
};

/** リゾルバ入口の認証ガード。未認証 (emumet 非注入) なら UNAUTHENTICATED を投げる */
export function requireEmumet(context: GraphQLContext): EmumetClient {
  if (!context.emumet) {
    throw new GraphQLError("Unauthenticated", { extensions: { code: "UNAUTHENTICATED" } });
  }
  return context.emumet;
}

export async function buildContext(req: Request, deps: ContextDeps): Promise<GraphQLContext> {
  const session = await deps.adapter.getSession(req);
  if (!session) return unauthenticatedContext(null);

  const outcome = await deps.adapter.refreshSessionIfNeeded(session);
  switch (outcome.kind) {
    case "fresh":
    case "refresh-failed-active":
      return authenticatedContext(deps, outcome.accessToken, null);
    case "refreshed":
      return authenticatedContext(deps, outcome.accessToken, outcome.sessionCookieHeader);
    case "refresh-failed-expired":
      return unauthenticatedContext(outcome.sessionCookieHeader);
  }
}

function authenticatedContext(deps: ContextDeps, accessToken: string, sessionCookieHeader: string | null): GraphQLContext {
  const emumet = deps.createEmumetClient(accessToken);
  // DataLoader のバッチングは同一インスタンス内でのみ発生するため、
  // リクエスト単位で 1 インスタンスに遅延メモ化する
  let loaders: Loaders | null = null;
  return {
    accessToken,
    emumet,
    sessionCookieHeader,
    makeLoaders: () => (loaders ??= createLoaders(emumet)),
  };
}

function unauthenticatedContext(sessionCookieHeader: string | null): GraphQLContext {
  return { accessToken: null, emumet: null, sessionCookieHeader, makeLoaders: () => emptyLoaders };
}
