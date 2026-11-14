// Quick reaction (D03) REST contract of ShuttlePub (S3, operations tagged
// `quick-reaction` in openapi/shuttlepub.json) and an executable model of its
// documented semantics.
//
// QuickReactionStore answers the five operations exactly as the contract describes
// them (status + JSON body), for any number of Profiles and Notes. The mock adapter
// serves it (mock.ts) and the replay test checks it against the producer's own
// scenario fixtures (openapi/quick-reaction-scenarios/), so mock mode follows the
// contract rather than an invented behaviour. State is per Profile and shared by
// every caller acting as that Profile (several browser sessions / devices see the
// same favourites and reactions), as the contract requires.
//
// Semantics (ShuttlePub docs/foundation.md, server/src/api_v1/quick_reaction.rs):
//  - settings: ordered favourites, at most 5, pairwise distinct; never-saved = rev 0.
//    PUT replaces the list; an equal list is an idempotent 200 whatever
//    expected_revision is; otherwise a stale revision is 409 revision_conflict; an
//    unavailable emoji may be kept but not newly added (422 emoji_unavailable);
//    an external emoji (usage existing_reaction_only) is never a favourite (422
//    emoji_usage_not_allowed, checked after availability).
//  - reaction: one per Profile and Note. PUT applies, first match answering: 1 an
//    unavailable emoji is 422 emoji_unavailable (even the one already selected); 2 the
//    emoji is the current selection: 200 no-op; 3 an external emoji with no chip of the
//    same emoji on the Note: 422 emoji_usage_not_allowed; 4 an external emoji while
//    reacted with another emoji: 409 conflict (no replacement); 5 select/replace.
//    DELETE is always 200 with emoji null, also when the selected emoji has become
//    unavailable.

import type { components } from "./generated/shuttlepub-api.ts";

export type EmojiRef = components["schemas"]["EmojiRef"];
export type EmojiView = components["schemas"]["EmojiView"];
export type EmojiAvailability = components["schemas"]["EmojiAvailability"];
export type EmojiUnavailableReason = components["schemas"]["EmojiUnavailableReason"];
export type EmojiImageState = components["schemas"]["EmojiImageState"];
export type EmojiUsage = components["schemas"]["EmojiUsage"];
export type QuickReactionSettings = components["schemas"]["QuickReactionSettings"];
export type UpdateQuickReactionSettings = components["schemas"]["UpdateQuickReactionSettings"];
export type ReactionState = components["schemas"]["ReactionState"];
export type PutReaction = components["schemas"]["PutReaction"];
export type RevisionConflictBody = components["schemas"]["RevisionConflictBody"];
type ErrorBody = components["schemas"]["ErrorBody"];
type FieldViolation = components["schemas"]["FieldViolation"];

export const MAX_FAVORITES = 5;
const MAX_UNICODE_EMOJI_CODE_POINTS = 32;
const MAX_CUSTOM_EMOJI_ID_LEN = 128;
const MAX_PROFILE_NANOID_LEN = 64;

export type QuickReactionOperation =
  | "getQuickReactionSettings"
  | "putQuickReactionSettings"
  | "getNoteReaction"
  | "putNoteReaction"
  | "deleteNoteReaction";

export const SETTINGS_PATH = "/api/v1/profiles/{profile_nanoid}/quick-reaction-settings";
export const REACTION_PATH = "/api/v1/profiles/{profile_nanoid}/notes/{note_id}/reaction";

/** Documented path and method of each operation (for contract lookups). */
export const OPERATIONS: Record<QuickReactionOperation, { path: string; method: "get" | "put" | "delete" }> = {
  getQuickReactionSettings: { path: SETTINGS_PATH, method: "get" },
  putQuickReactionSettings: { path: SETTINGS_PATH, method: "put" },
  getNoteReaction: { path: REACTION_PATH, method: "get" },
  putNoteReaction: { path: REACTION_PATH, method: "put" },
  deleteNoteReaction: { path: REACTION_PATH, method: "delete" },
};

/** One custom emoji as the server knows it (the producer scenarios' `setup.emoji` shape). */
export type CustomEmojiSetup = {
  shortcode?: string;
  image_url?: string;
  availability: EmojiAvailability;
  reason?: EmojiUnavailableReason;
  /** Originating domain of an external emoji (absent for this server's own emoji). */
  origin?: string;
  image_state?: EmojiImageState;
  usage?: EmojiUsage;
};

export type StoredSettings = { revision: number; favorites: EmojiRef[] };

export type QuickReactionSetup = {
  /** Custom emoji by stable id. Unicode emoji are always available. */
  emoji: Record<string, CustomEmojiSetup>;
  /** Profiles the server knows (others are 404 not_found). */
  profiles: readonly string[];
  /** Notes the server knows (others are 404 not_found). */
  notes: readonly string[];
  /** Saved settings per Profile; absent = never saved (revision 0, no favourites). */
  settings?: Record<string, StoredSettings>;
  /** Selected reaction per Profile and Note. */
  reactions?: readonly { profile: string; note: string; emoji: EmojiRef }[];
  /** Chips on a Note carried by people outside the modelled Profiles (besides their selections). */
  chips?: readonly { note: string; emoji: EmojiRef }[];
};

/** A REST answer: HTTP status and its JSON body. */
export type RestReply = { status: number; body: unknown };

export type OperationPath = { profile_nanoid: string; note_id?: string };

const fieldViolation = (field: string, message: string): FieldViolation => ({ field, message });

function errorBody(code: ErrorBody["code"], message: string, details: FieldViolation[] = []): ErrorBody {
  return details.length === 0 ? { code, message } : { code, message, details };
}

/** Same JSON value (the contract's notion of "the same emoji"). */
export function sameEmoji(a: EmojiRef, b: EmojiRef): boolean {
  if (a.type === "unicode" && b.type === "unicode") return a.value === b.value;
  if (a.type === "custom" && b.type === "custom") return a.id === b.id;
  return false;
}

const BLOCKED = /[\p{White_Space}\p{Cc}]/u;

/** Identifier check of EmojiRef::validate; `field` is the JSON pointer of the value. */
export function emojiViolation(emoji: unknown, field: string): FieldViolation | null {
  const value = emoji as Partial<Record<string, unknown>> | null;
  if (value?.type === "unicode" && typeof value.value === "string") {
    const count = Array.from(value.value).length;
    if (count === 0 || count > MAX_UNICODE_EMOJI_CODE_POINTS || BLOCKED.test(value.value) || /^[\x00-\x7F]*$/.test(value.value)) {
      return fieldViolation(
        `${field}/value`,
        `must be an emoji sequence of 1..=${MAX_UNICODE_EMOJI_CODE_POINTS} code points without whitespace or control characters`,
      );
    }
    return null;
  }
  if (value?.type === "custom" && typeof value.id === "string") {
    if (value.id.length === 0 || Array.from(value.id).length > MAX_CUSTOM_EMOJI_ID_LEN || !/^[A-Za-z0-9_.:@-]+$/.test(value.id)) {
      return fieldViolation(`${field}/id`, `must be 1..=${MAX_CUSTOM_EMOJI_ID_LEN} characters of A-Z a-z 0-9 _ . : @ -`);
    }
    return null;
  }
  return fieldViolation(field, "must be an emoji reference");
}

function profileViolation(profile: string): FieldViolation | null {
  const length = Array.from(profile).length;
  if (length === 0 || length > MAX_PROFILE_NANOID_LEN || !/^[A-Za-z0-9_-]+$/.test(profile)) {
    return fieldViolation("/profile_nanoid", `must be 1..=${MAX_PROFILE_NANOID_LEN} characters of A-Z a-z 0-9 _ -`);
  }
  return null;
}

const invalidRequest = (details: FieldViolation[]): RestReply => ({
  status: 400,
  body: errorBody("invalid_request", "the request failed validation", details),
});

const unavailable = (fields: string[]): RestReply => ({
  status: 422,
  body: errorBody(
    "emoji_unavailable",
    "an emoji in the request is unavailable",
    fields.map((field) => fieldViolation(field, "emoji is unavailable")),
  ),
});

const usageNotAllowed = (fields: string[]): RestReply => ({
  status: 422,
  body: errorBody(
    "emoji_usage_not_allowed",
    "an external emoji can only be used from an existing reaction",
    fields.map((field) => fieldViolation(field, "an external emoji can only be used from an existing reaction")),
  ),
});

export function revisionConflict(currentRevision: number): RevisionConflictBody {
  return {
    code: "revision_conflict",
    message: "expected_revision does not match the stored revision",
    current_revision: currentRevision,
  };
}

const reactionKey = (profile: string, note: string) => `${profile}\u0000${note}`;

/**
 * Stateful S3 model. One instance is the whole "server": favourites and reactions
 * are keyed by Profile (and Note), never by caller, so every session acting as a
 * Profile reads and writes the same state.
 */
export class QuickReactionStore {
  private readonly initial: QuickReactionSetup;
  private emoji = new Map<string, CustomEmojiSetup>();
  private settings = new Map<string, StoredSettings>();
  private reactions = new Map<string, { profile: string; note: string; emoji: EmojiRef }>();
  private chips: { note: string; emoji: EmojiRef }[] = [];
  private profiles = new Set<string>();
  private notes = new Set<string>();

  constructor(setup: QuickReactionSetup) {
    this.initial = structuredClone(setup);
    this.reset();
  }

  /** Back to the state the store was created with. */
  reset(): void {
    const setup = structuredClone(this.initial);
    this.emoji = new Map(Object.entries(setup.emoji));
    this.settings = new Map(Object.entries(setup.settings ?? {}));
    this.reactions = new Map((setup.reactions ?? []).map((entry) => [reactionKey(entry.profile, entry.note), entry]));
    this.chips = [...(setup.chips ?? [])];
    this.profiles = new Set(setup.profiles);
    this.notes = new Set(setup.notes);
  }

  /** The server changes a custom emoji (deleted / disabled / restored). */
  mutateEmoji(id: string, availability: EmojiAvailability, reason?: EmojiUnavailableReason | null): void {
    const entry = this.emoji.get(id) ?? { availability };
    entry.availability = availability;
    if (reason) entry.reason = reason;
    else delete entry.reason;
    if (availability === "unavailable" && reason === "deleted") {
      delete entry.image_url;
      if (entry.image_state !== undefined) entry.image_state = "missing";
    }
    this.emoji.set(id, entry);
  }

  /** An external emoji: usable only through an existing chip of the Note (never a favourite). */
  external(emoji: EmojiRef): boolean {
    return emoji.type === "custom" && this.emoji.get(emoji.id)?.usage === "existing_reaction_only";
  }

  /** Whether the Note carries a chip of this emoji for reasons other than this Profile's own selection. */
  private othersCarry(profile: string, note: string, emoji: EmojiRef): boolean {
    return this.chips.some((chip) => chip.note === note && sameEmoji(chip.emoji, emoji)) ||
      [...this.reactions.values()].some((entry) => entry.note === note && entry.profile !== profile && sameEmoji(entry.emoji, emoji));
  }

  available(emoji: EmojiRef): boolean {
    if (emoji.type === "unicode") return true;
    return this.emoji.get(emoji.id)?.availability === "available";
  }

  /** EmojiView of a reference: identity + availability + display data. */
  view(emoji: EmojiRef): EmojiView {
    if (emoji.type === "unicode") return { emoji: { ...emoji }, availability: "available" };
    const entry = this.emoji.get(emoji.id);
    if (entry === undefined) return { emoji: { ...emoji }, availability: "unavailable", unavailable_reason: "deleted" };
    const view: EmojiView = { emoji: { ...emoji }, availability: entry.availability };
    if (entry.reason !== undefined) view.unavailable_reason = entry.reason;
    if (entry.shortcode !== undefined) view.shortcode = entry.shortcode;
    if (entry.image_url !== undefined) view.image_url = entry.image_url;
    if (entry.origin !== undefined) view.origin = entry.origin;
    if (entry.image_state !== undefined) view.image_state = entry.image_state;
    if (entry.usage !== undefined) view.usage = entry.usage;
    return view;
  }

  /** Every custom emoji the server knows, in id order. */
  customEmojis(): EmojiView[] {
    return [...this.emoji.keys()].sort().map((id) => this.view({ type: "custom", id }));
  }

  /**
   * The picker's catalogue: this server's own custom emoji only. An external emoji is never
   * offered (D09 d09-q01), whatever else the server knows about it.
   */
  catalogueEmojis(): EmojiView[] {
    return this.customEmojis().filter((view) => view.origin == null && view.usage !== "existing_reaction_only");
  }

  /** Every selected reaction on a Note (all Profiles). Used by the provisional aggregate. */
  reactionsOn(note: string): { profile: string; emoji: EmojiRef }[] {
    return [...this.reactions.values()].filter((entry) => entry.note === note)
      .map((entry) => ({ profile: entry.profile, emoji: structuredClone(entry.emoji) }));
  }

  private settingsOf(profile: string): QuickReactionSettings {
    const stored = this.settings.get(profile) ?? { revision: 0, favorites: [] };
    return { revision: stored.revision, favorites: stored.favorites.map((emoji) => this.view(emoji)) };
  }

  private reactionState(profile: string, note: string): ReactionState {
    const selected = this.reactions.get(reactionKey(profile, note));
    return { note_id: note, emoji: selected === undefined ? null : this.view(selected.emoji) };
  }

  /** Answer one operation like the server would. */
  handle(operation: QuickReactionOperation, path: OperationPath, body?: unknown): RestReply {
    const profile = path.profile_nanoid;
    const badProfile = profileViolation(profile);
    if (badProfile) return invalidRequest([badProfile]);
    if (!this.profiles.has(profile)) return { status: 404, body: errorBody("not_found", "unknown Profile") };
    switch (operation) {
      case "getQuickReactionSettings":
        return { status: 200, body: this.settingsOf(profile) };
      case "putQuickReactionSettings":
        return this.putSettings(profile, body);
      default: {
        const note = path.note_id ?? "";
        if (!this.notes.has(note)) return { status: 404, body: errorBody("not_found", "unknown Note") };
        if (operation === "getNoteReaction") return { status: 200, body: this.reactionState(profile, note) };
        if (operation === "deleteNoteReaction") {
          this.reactions.delete(reactionKey(profile, note));
          return { status: 200, body: this.reactionState(profile, note) };
        }
        return this.putReaction(profile, note, body);
      }
    }
  }

  private putSettings(profile: string, body: unknown): RestReply {
    const request = body as Partial<UpdateQuickReactionSettings> | null;
    if (typeof request !== "object" || request === null || !Array.isArray(request.favorites) ||
      typeof request.expected_revision !== "number" || !Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0) {
      return invalidRequest([fieldViolation("/", "must be an UpdateQuickReactionSettings object")]);
    }
    const favorites = request.favorites as EmojiRef[];
    const problems: FieldViolation[] = [];
    if (favorites.length > MAX_FAVORITES) {
      problems.push(fieldViolation("/favorites", `at most ${MAX_FAVORITES} favorites are allowed`));
    }
    favorites.forEach((emoji, index) => {
      const field = `/favorites/${index}`;
      const problem = emojiViolation(emoji, field);
      if (problem) problems.push(problem);
      if (favorites.slice(0, index).some((earlier) => sameEmoji(earlier, emoji))) {
        problems.push(fieldViolation(field, "duplicate of an earlier favorite"));
      }
    });
    if (problems.length > 0) return invalidRequest(problems);

    const stored = this.settings.get(profile) ?? { revision: 0, favorites: [] };
    const equal = stored.favorites.length === favorites.length &&
      stored.favorites.every((emoji, index) => sameEmoji(emoji, favorites[index]!));
    if (equal) return { status: 200, body: this.settingsOf(profile) };
    if (request.expected_revision !== stored.revision) return { status: 409, body: revisionConflict(stored.revision) };
    const refused = favorites
      .map((emoji, index) => ({ emoji, index }))
      .filter(({ emoji }) => !stored.favorites.some((kept) => sameEmoji(kept, emoji)) && !this.available(emoji))
      .map(({ index }) => `/favorites/${index}`);
    if (refused.length > 0) return unavailable(refused);
    const externals = favorites.flatMap((emoji, index) => this.external(emoji) ? [`/favorites/${index}`] : []);
    if (externals.length > 0) return usageNotAllowed(externals);
    this.settings.set(profile, { revision: stored.revision + 1, favorites: structuredClone(favorites) });
    return { status: 200, body: this.settingsOf(profile) };
  }

  private putReaction(profile: string, note: string, body: unknown): RestReply {
    const request = body as Partial<PutReaction> | null;
    if (typeof request !== "object" || request === null) {
      return invalidRequest([fieldViolation("/", "must be a PutReaction object")]);
    }
    const problem = emojiViolation(request.emoji, "/emoji");
    if (problem) return invalidRequest([problem]);
    const emoji = request.emoji as EmojiRef;
    // Availability is checked before the repeat no-op rule (the selection stays).
    if (!this.available(emoji)) return unavailable(["/emoji"]);
    const current = this.reactions.get(reactionKey(profile, note));
    if (current !== undefined && sameEmoji(current.emoji, emoji)) return { status: 200, body: this.reactionState(profile, note) };
    if (this.external(emoji)) {
      if (!this.othersCarry(profile, note, emoji)) return usageNotAllowed(["/emoji"]);
      if (current !== undefined) {
        return {
          status: 409,
          body: errorBody("conflict", "remove the current reaction before reacting with an external emoji", [fieldViolation("/emoji", "remove the current reaction before reacting with an external emoji")]),
        };
      }
    }
    this.reactions.set(reactionKey(profile, note), { profile, note, emoji: structuredClone(emoji) });
    return { status: 200, body: this.reactionState(profile, note) };
  }
}

/**
 * The rules every EmojiView the server sends obeys (producer EmojiView::check_consistency):
 * unavailable_reason goes with `unavailable` only; a Unicode emoji is always available
 * and has no custom data; image_state agrees with image_url (a missing image keeps a
 * shortcode to show as :name:); an emoji with an origin is existing_reaction_only.
 * Returns the first violated rule, or null. A schema-valid body can still break them.
 */
export function emojiViewInconsistency(view: EmojiView): string | null {
  if ((view.availability === "available") === (view.unavailable_reason != null)) {
    return "unavailable_reason must be present exactly when unavailable";
  }
  if (view.emoji.type === "unicode") {
    const customOnly = view.origin != null || view.image_state != null || view.shortcode != null ||
      view.image_url != null || view.usage === "existing_reaction_only";
    return customOnly || view.availability !== "available" ? "a Unicode emoji is always available and has no custom data" : null;
  }
  if (view.image_state === "present" && view.image_url == null) return "image_state present needs image_url";
  if (view.image_state === "missing" && view.image_url != null) return "image_state missing must not carry image_url";
  if (view.image_state === "missing" && (view.shortcode == null || view.shortcode === "")) {
    return "image_state missing needs a shortcode to show as :name:";
  }
  if (view.origin != null && view.usage !== "existing_reaction_only") return "an external emoji must be existing_reaction_only";
  return null;
}

/**
 * The rules every reaction chip obeys (producer EmojiReactionCount::check_consistency):
 * view agrees with the chip's emoji and is present for a custom emoji.
 */
export function chipInconsistency(chip: { emoji: EmojiRef; view?: EmojiView | null }): string | null {
  if (chip.view == null) return chip.emoji.type === "custom" ? "a custom emoji chip must carry view" : null;
  if (!sameEmoji(chip.view.emoji, chip.emoji)) return "view.emoji must equal the chip's emoji";
  return emojiViewInconsistency(chip.view);
}
