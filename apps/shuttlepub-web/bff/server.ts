import { createYoga } from "graphql-yoga";
import { resolvers, type GraphQLContext } from "./resolvers.ts";
import { makeSchema } from "./schema.ts";

/** Yoga handler for POST /graphql. The context (adapter + profile source) is injected by app.ts. */
export function createGraphqlHandler(context: GraphQLContext): (request: Request) => Promise<Response> {
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
