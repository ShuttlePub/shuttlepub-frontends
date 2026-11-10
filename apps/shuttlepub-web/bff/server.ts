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
    context: () => context,
  });
  return async (request) => await yoga.fetch(request);
}
