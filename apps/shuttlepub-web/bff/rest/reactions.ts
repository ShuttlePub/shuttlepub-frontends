// App-owned, PROVISIONAL shapes for reaction data the pinned OpenAPI does not offer.
//
// The S3 contract (quick-reaction.ts) covers the acting Profile's own favourites and
// its own reaction on one Note. The post card also needs what *other* people reacted
// with (ui-spec C1/C3/C4 counts, D1 tooltips and the reactor list) and the picker needs
// the server's custom emoji catalogue. ShuttlePub has no endpoint for either yet, so
// these shapes exist only so the UI can be built against mock fixtures, like posts.ts.
// Real mode reports both as not_implemented and never invents them.

import type { EmojiView } from "./quick-reaction.ts";

/** PROVISIONAL. Someone who reacted. handle is user@host without the leading "@". */
export type Reactor = {
  id: string;
  handle: string;
  displayName: string;
};

/** PROVISIONAL. One emoji's reactions on a Note, excluding the acting Profile's own. */
export type ReactionGroup = {
  emoji: EmojiView;
  count: number;
  /** Everyone counted in `count`, most recent first. */
  reactors: Reactor[];
};

/** PROVISIONAL. Other people's reactions on a Note (the viewer's own comes from S3). */
export type NoteReactionSummary = {
  note_id: string;
  groups: ReactionGroup[];
};
