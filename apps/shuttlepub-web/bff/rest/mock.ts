import { missingEndpoint, type ShuttlePubApi } from "./client.ts";
import { apiStatusFixture } from "./fixtures.ts";
import { createMockContent } from "./content-mock.ts";
import { QuickReactionStore, type EmojiView, type OperationPath, type QuickReactionOperation, type QuickReactionSettings, type ReactionState } from "./quick-reaction.ts";
import { interpretReply } from "./quick-reaction-reply.ts";
import { MOCK_QUICK_REACTION_SETUP, mockReactionSummary } from "./reaction-fixtures.ts";

export type MockApi = ShuttlePubApi & {
  /** The stateful S3 model behind the quick reaction operations. */
  readonly quickReaction: QuickReactionStore;
  /** Restore the initial mock state (POST /__mock/reset, used by tests and visual capture). */
  reset(): void;
};

/**
 * Serves fixtures. Selected only by SHUTTLEPUB_API_MODE=mock. The status fixture is
 * contract-checked; timeline/post fixtures are app-owned and provisional (post-fixtures.ts)
 * and what a Profile sees of them goes through the S8 projection (content-mock.ts).
 * Posting is not simulated: there is no contract to model it on.
 *
 * Quick reaction (S3) is stateful: one QuickReactionStore per process answers like the
 * contract says, and every session acting as a Profile shares that Profile's
 * favourites and reactions (the cross-device behaviour D03 asks for). Answers go
 * through the same interpretation as the real backend's (quick-reaction-reply.ts).
 */
export function createMockApi(): MockApi {
  const store = new QuickReactionStore(MOCK_QUICK_REACTION_SETUP);
  const content = createMockContent();
  const quickReaction = async <T>(operation: QuickReactionOperation, path: OperationPath, body?: unknown): Promise<T> =>
    interpretReply<T>(operation, structuredClone(store.handle(operation, path, structuredClone(body))));
  return {
    mode: "mock",
    quickReaction: store,
    reset: () => store.reset(),
    async getApiStatus() {
      return structuredClone(apiStatusFixture);
    },
    getTimeline: (kind, viewer) => content.getTimeline(kind, viewer),
    getPostView: (id, viewer, reveal) => content.getPostView(id, viewer, reveal),
    getReplies: (postId, viewer) => content.getReplies(postId, viewer),
    getUserPage: (handle, viewer, reveal) => content.getUserPage(handle, viewer, reveal),
    async createPost() {
      throw missingEndpoint("createPost");
    },
    getQuickReactionSettings: (_auth, profile) =>
      quickReaction<QuickReactionSettings>("getQuickReactionSettings", { profile_nanoid: profile }),
    putQuickReactionSettings: (_auth, profile, body) =>
      quickReaction<QuickReactionSettings>("putQuickReactionSettings", { profile_nanoid: profile }, body),
    getNoteReaction: (_auth, profile, noteId) =>
      quickReaction<ReactionState>("getNoteReaction", { profile_nanoid: profile, note_id: noteId }),
    putNoteReaction: (_auth, profile, noteId, emoji) =>
      quickReaction<ReactionState>("putNoteReaction", { profile_nanoid: profile, note_id: noteId }, { emoji }),
    deleteNoteReaction: (_auth, profile, noteId) =>
      quickReaction<ReactionState>("deleteNoteReaction", { profile_nanoid: profile, note_id: noteId }),
    async getReactionSummaries(_auth, profile, noteIds) {
      return noteIds.map((note) => mockReactionSummary(store, profile, note));
    },
    async getCustomEmojis(): Promise<EmojiView[]> {
      return store.customEmojis();
    },
  };
}
