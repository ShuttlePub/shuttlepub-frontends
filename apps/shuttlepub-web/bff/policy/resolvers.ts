// GraphQL resolvers for the active Profile's mute/block settings (personal-domain-controls-web-ui).
//
// The Profile is always the viewer's currently selected one (FA Profile context, ownership
// re-checked on every request). The browser passes the id of the Profile it is showing
// (`profile`, the Profile context id) and the BFF refuses with PROFILE_CHANGED when it is not
// the selected one any more (e.g. switched in another tab), so one Profile's settings are
// never shown or written while another is selected. Upstream failures keep
// their meaning as extensions.code and are never turned into data.

import { GraphQLError } from "graphql";
import { AuthError } from "../auth-error.ts";
import type { ProfileContextSource } from "../profile.ts";
import { actorDomain, canonicalDomain, checkDomainInput } from "./domain.ts";
import { PolicyError, type ActorPolicy, type DomainControl, type PolicyMode, type ProfilePolicySource } from "./source.ts";

export type PolicyContext = {
  profiles: ProfileContextSource;
  policy: ProfilePolicySource;
  /** This server's own hosts; they cannot be muted or blocked as a domain. */
  selfDomains: readonly string[];
};

type GqlMode = "MUTE" | "BLOCK";
const fromGqlMode = (mode: GqlMode): PolicyMode => (mode === "BLOCK" ? "block" : "mute");
const toGqlMode = (mode: PolicyMode): GqlMode => (mode === "block" ? "BLOCK" : "MUTE");

function policyError(error: unknown): unknown {
  if (error instanceof PolicyError) {
    return new GraphQLError(error.message, {
      extensions: { code: error.code, ...(error.status === undefined ? {} : { upstreamStatus: error.status }) },
    });
  }
  if (error instanceof AuthError) return new GraphQLError(error.code, { extensions: { code: error.code } });
  return error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw policyError(error);
  }
}

async function activeProfileId(context: PolicyContext, shown: string): Promise<string> {
  const { activeProfile } = await context.profiles.getProfileContext();
  if (!activeProfile) throw new GraphQLError("No active profile is selected", { extensions: { code: "PROFILE_REQUIRED" } });
  if (activeProfile.id !== shown) throw new GraphQLError("The selected profile changed", { extensions: { code: "PROFILE_CHANGED" } });
  return activeProfile.profileId;
}

function domainArgument(domain: string): string {
  const result = canonicalDomain(domain);
  if ("error" in result) throw new PolicyError("INVALID_DOMAIN", "Malformed domain");
  return result.domain;
}

const domainControlOut = (control: DomainControl) => ({
  domain: control.domain,
  mode: toGqlMode(control.mode),
  revision: control.revision,
  createdAt: control.createdAt,
});

const actorPolicyOut = (policy: ActorPolicy) => ({
  id: policy.id,
  mode: toGqlMode(policy.mode),
  actorUrl: policy.actorUrl,
  createdAt: policy.createdAt,
});

const byNewest = <T extends { createdAt: string }>(items: T[]) => items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const policyResolvers = {
  Query: {
    domainControls: (_root: unknown, args: { profile: string }, context: PolicyContext) =>
      guarded(async () => byNewest(await context.policy.listDomainControls(await activeProfileId(context, args.profile))).map(domainControlOut)),
    actorPolicies: (_root: unknown, args: { profile: string }, context: PolicyContext) =>
      guarded(async () => byNewest(await context.policy.listActorPolicies(await activeProfileId(context, args.profile))).map(actorPolicyOut)),
    domainBlockImpact: (_root: unknown, args: { profile: string; domain: string }, context: PolicyContext) =>
      guarded(async () => {
        const relations = await context.policy.followRelations(await activeProfileId(context, args.profile));
        // Exact match on the actor's host only (sub.example.com is not example.com).
        const domain = domainArgument(args.domain);
        const matches = (url: string) => actorDomain(url) === domain;
        return {
          domain,
          following: [...new Set(relations.following.filter(matches))],
          followers: [...new Set(relations.followers.filter(matches))],
        };
      }),
    checkDomainInput: (_root: unknown, args: { input: string }, context: PolicyContext) => {
      const result = checkDomainInput(args.input, context.selfDomains);
      return "error" in result ? { domain: null, error: result.error } : { domain: result.domain, error: null };
    },
  },
  Mutation: {
    setDomainControl: (_root: unknown, args: { profile: string; domain: string; mode: GqlMode; expectedRevision?: number | null }, context: PolicyContext) =>
      guarded(async () => domainControlOut(await context.policy.putDomainControl(
        await activeProfileId(context, args.profile), args.domain, fromGqlMode(args.mode), args.expectedRevision ?? undefined,
      ))),
    removeDomainControl: (_root: unknown, args: { profile: string; domain: string; expectedRevision: number }, context: PolicyContext) =>
      guarded(async () => {
        await context.policy.deleteDomainControl(await activeProfileId(context, args.profile), args.domain, args.expectedRevision);
        return { key: args.domain };
      }),
    addActorPolicy: (_root: unknown, args: { profile: string; actorUrl: string; mode: GqlMode }, context: PolicyContext) =>
      guarded(async () => actorPolicyOut(await context.policy.createActorPolicy(await activeProfileId(context, args.profile), fromGqlMode(args.mode), args.actorUrl))),
    removeActorPolicy: (_root: unknown, args: { profile: string; id: string; mode: GqlMode }, context: PolicyContext) =>
      guarded(async () => {
        await context.policy.deleteActorPolicy(await activeProfileId(context, args.profile), fromGqlMode(args.mode), args.id);
        return { key: args.id };
      }),
  },
};
