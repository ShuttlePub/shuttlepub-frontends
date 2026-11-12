import { createYoga } from "graphql-yoga";
import { AuthError } from "./auth-error.ts";
import { createRealProfilePolicy } from "./policy/real.ts";
import { resolvers, type GraphQLContext } from "./resolvers.ts";
import { makeSchema } from "./schema.ts";

/**
 * The context of a handler. Without a mute/block policy source (e.g. handlers built only
 * for other operations) the policy operations answer UNAUTHENTICATED and adding a domain
 * is refused (no own domain configured): they never fall back to data.
 */
export type HandlerContext = Omit<GraphQLContext, "policy" | "selfDomains"> & Partial<Pick<GraphQLContext, "policy" | "selfDomains">>;

/** Yoga handler for POST /graphql. The context (adapter + profile source) is injected by app.ts. */
export function createGraphqlHandler(handlerContext: HandlerContext): (request: Request) => Promise<Response> {
  const context: GraphQLContext = {
    ...handlerContext,
    policy: handlerContext.policy ?? createRealProfilePolicy({ baseUrl: "http://unconfigured.invalid", session: () => Promise.reject(new AuthError("UNAUTHENTICATED", 401)) }),
    selfDomains: handlerContext.selfDomains ?? null,
  };
  const yoga = createYoga({
    schema: makeSchema(resolvers),
    graphqlEndpoint: "/graphql",
    graphiql: false,
    landingPage: false,
    // The browser uses this BFF same-origin only; Yoga otherwise reflects arbitrary
    // origins with credentials, which could expose GET queries to sibling sites.
    cors: false,
    context: () => context,
  });
  return async (request) => await yoga.fetch(request);
}
