// Mock-mode quick reaction world (D03): the server's custom emoji, the three mock
// Profiles' favourites / reactions (S3 state, served through QuickReactionStore) and,
// PROVISIONAL, what other people reacted with (reactions.ts, not contract-checked).
//
// Contents follow the agreed UI mock (host intents/shuttlepub/features/
// quick-reaction-ui/mocks/index.html): Profile 1 has five favourites one of which
// became unavailable, Profile 2 never saved any (no favourites row in the picker,
// ui-spec P3), Profile 3 has three. Custom emoji images are inline SVG data URIs so
// mock mode needs no image host.

import { availableProfilesFixture } from "../profile.ts";
import { NOTE_IDS, replyPostFixtures, timelinePostFixtures } from "./post-fixtures.ts";
import type { CustomEmojiSetup, EmojiRef, QuickReactionSetup, QuickReactionStore } from "./quick-reaction.ts";
import type { NoteReactionSummary, ReactionGroup, Reactor } from "./reactions.ts";

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;

const custom = (id: string, body: string, availability: CustomEmojiSetup["availability"] = "available", reason?: CustomEmojiSetup["reason"]): [string, CustomEmojiSetup] =>
  [id, { shortcode: id, image_url: svg(body), availability, ...(reason ? { reason } : {}) }];

/** The mock server's custom emoji. old_blob was disabled after people favourited it. */
export const MOCK_CUSTOM_EMOJI: Record<string, CustomEmojiSetup> = Object.fromEntries([
  custom("neko_yes", '<path d="M6 11 8.5 3l5.5 5h4l5.5-5L26 11c2.5 4 2.5 11-1.5 15-4 3.5-14 3.5-18 0C2.5 22 3.5 15 6 11Z" fill="#f9e2af"/><circle cx="12" cy="16" r="1.9" fill="#1e1e2e"/><circle cx="20" cy="16" r="1.9" fill="#1e1e2e"/><path d="M13 21q3 2.6 6 0" stroke="#1e1e2e" stroke-width="1.7" fill="none" stroke-linecap="round"/>'),
  custom("shuttle", '<circle cx="16" cy="16" r="15" fill="#cba6f7"/><circle cx="16" cy="16" r="6.5" fill="#1e1e2e"/><ellipse cx="16" cy="16" rx="12.5" ry="4" fill="none" stroke="#1e1e2e" stroke-width="2.2" transform="rotate(-22 16 16)"/>'),
  custom("kusa", '<rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#a6e3a1"/><path d="M9 9h14M12 6v6M20 6v6M8 15h16M16 15v11M16 19l-7 6M16 19l7 6" stroke="#1e1e2e" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  custom("tea_time", '<path d="M5 12h17v7a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7Z" fill="#fab387"/><path d="M22 14h2a3 3 0 0 1 0 6h-2" stroke="#fab387" stroke-width="2.5" fill="none"/><path d="M10 3c-1.2 2 1.2 3 0 5.5M15.5 3c-1.2 2 1.2 3 0 5.5" stroke="#bac2de" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  custom("ok_sign", '<circle cx="16" cy="16" r="15" fill="#89b4fa"/><path d="M8 12.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7ZM16 11v10M16 16l6-5M16 16l6 5" stroke="#1e1e2e" stroke-width="2.2" fill="none" stroke-linecap="round"/>'),
  custom("old_blob", '<path d="M16 3c8 0 13 6 13 13s-5 13-13 13S3 24 3 16 8 3 16 3Z" fill="#89dceb"/><circle cx="11.5" cy="14" r="2" fill="#1e1e2e"/><circle cx="20.5" cy="14" r="2" fill="#1e1e2e"/><path d="M11 20q5 4 10 0" stroke="#1e1e2e" stroke-width="2" fill="none" stroke-linecap="round"/>', "unavailable", "disabled"),
]);

const u = (value: string): EmojiRef => ({ type: "unicode", value });
const c = (id: string): EmojiRef => ({ type: "custom", id });

const [profile1, profile2, profile3] = availableProfilesFixture.map((profile) => profile.id) as [string, string, string];

/** Initial S3 state of the mock (restored by POST /__mock/reset). */
export const MOCK_QUICK_REACTION_SETUP: QuickReactionSetup = {
  emoji: MOCK_CUSTOM_EMOJI,
  profiles: [profile1, profile2, profile3],
  notes: [...timelinePostFixtures, ...replyPostFixtures].map((post) => post.noteId),
  settings: {
    [profile1]: { revision: 3, favorites: [u("👍"), u("🎉"), c("neko_yes"), u("🙏"), c("old_blob")] },
    [profile3]: { revision: 1, favorites: [u("✨"), u("💜"), c("kusa")] },
  },
  reactions: [
    { profile: profile1, note: NOTE_IDS["post-sora-zine"], emoji: u("🎉") },
    { profile: profile3, note: NOTE_IDS["post-kei-release"], emoji: c("kusa") },
  ],
};

// --- PROVISIONAL: other people's reactions -------------------------------------------

const PEOPLE: readonly Reactor[] = [
  ["Mika", "mika@misskey.example"], ["sora", "sora@shuttlepub.example"], ["ねこ太", "nekota@mstdn.example"],
  ["Ren", "ren@shuttlepub.example"], ["あおい", "aoi@shuttlepub.example"], ["Kei", "kei@shuttlepub.example"],
  ["ゆず", "yuzu@misskey.example"], ["Taro", "taro@mstdn.example"], ["hina", "hina@shuttlepub.example"],
  ["Leo", "leo@misskey.example"], ["みどり", "midori@shuttlepub.example"], ["Yuki", "yuki@mstdn.example"],
].map(([displayName, handle]) => ({ id: `reactor-${handle!.split("@")[0]}`, handle: handle!, displayName: displayName! }));

/** Counts per emoji on each Note from people outside this mock (as in the agreed mock). */
const OTHERS: Record<string, readonly [EmojiRef, number][]> = {
  [NOTE_IDS["post-mika-picker"]]: [[u("👍"), 3], [c("neko_yes"), 2], [u("🎉"), 1]],
  [NOTE_IDS["post-sora-zine"]]: [[u("🎉"), 4], [u("✨"), 2], [u("💜"), 1]],
  [NOTE_IDS["post-nekota-coffee"]]: [[u("☕"), 4], [u("👍"), 1]],
  [NOTE_IDS["post-kei-release"]]: [
    [c("kusa"), 6], [u("😂"), 3], [u("👀"), 2], [c("shuttle"), 2], [u("🙏"), 1],
    [u("🔥"), 1], [u("💯"), 1], [u("🥹"), 1], [u("👏"), 1],
  ],
  [NOTE_IDS["post-taro-reply"]]: [[u("💜"), 1]],
};

function seed(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash;
}

const key = (emoji: EmojiRef) => emoji.type === "unicode" ? `u:${emoji.value}` : `c:${emoji.id}`;

/**
 * Other people's reactions on a Note as seen by `viewer`: the fixed counts above plus
 * the other mock Profiles' S3 reactions (the viewer's own reaction is never included;
 * it comes from GET .../reaction). Sorted by count, most first (stable).
 */
export function mockReactionSummary(store: QuickReactionStore, viewer: string, note: string): NoteReactionSummary {
  const groups = new Map<string, ReactionGroup>();
  let offset = seed(note);
  for (const [emoji, count] of OTHERS[note] ?? []) {
    const reactors = Array.from({ length: count }, (_, index) => PEOPLE[(offset + index) % PEOPLE.length]!);
    offset += count + 2;
    groups.set(key(emoji), { emoji: store.view(emoji), count, reactors: structuredClone(reactors) });
  }
  for (const reaction of store.reactionsOn(note)) {
    if (reaction.profile === viewer) continue;
    const profile = availableProfilesFixture.find((entry) => entry.id === reaction.profile);
    if (profile === undefined) continue;
    const reactor: Reactor = { id: profile.id, handle: `${profile.handle}@shuttlepub.example`, displayName: profile.displayName };
    const group = groups.get(key(reaction.emoji)) ?? { emoji: store.view(reaction.emoji), count: 0, reactors: [] };
    group.count += 1;
    group.reactors.unshift(reactor);
    groups.set(key(reaction.emoji), group);
  }
  return { note_id: note, groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}
