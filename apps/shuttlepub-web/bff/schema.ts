import sdl from "./schema.graphql" with { type: "text" };
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { GraphQLSchema } from "graphql";

export function makeSchema(resolvers: Parameters<typeof makeExecutableSchema>[0]["resolvers"]): GraphQLSchema {
  return makeExecutableSchema({ typeDefs: sdl, resolvers });
}
