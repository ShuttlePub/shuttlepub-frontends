// Mock-mode content (timeline, one post, replies, user page) through the S8 projection.
//
// Every answer is first built as the S8 response body the backend will send
// (TimelineResponse / DirectNoteResponse, content.ts), checked against the pinned
// OpenAPI, and only then joined with the app-owned display fields (post-fixtures.ts) by
// note_id. A hidden note is never joined, so nothing of it (text, author, quote) reaches
// GraphQL. Reveal is stateless like S8's: the caller asks for it per request.

import { describeViolations, violationsForSchema } from "../openapi/contract.ts";
import { ShuttlePubApiError } from "./client.ts";
import {
  actorHost,
  controlFor,
  directView,
  timelineFor,
  type ContentCandidate,
  type DirectNote,
  type DirectNoteResponse,
  type DomainControlRef,
  type EmbeddedNotePresentation,
  type FeedItem,
  type NoteContent,
  type PostOperationAvailability,
} from "./content.ts";
import {
  MOCK_LOCAL_HOST,
  MOCK_NOTES,
  NOTE_IDS,
  REPOST_NOTE_IDS,
  TIMELINE,
  mockNote,
  mockPerson,
  mockPostsBy,
  mockReplies,
  type MockNote,
  type MockPerson,
  type TimelineEntry,
} from "./post-fixtures.ts";
import type { ContentControl, ContentViewer, Post, PostAuthor, PostOperations, PostView, QuotedPost, TimelineKind, UserPage } from "./posts.ts";

function checked<T>(schema: string, body: T): T {
  const violations = violationsForSchema(schema, body);
  if (violations.length > 0) {
    throw new ShuttlePubApiError("invalid_response", `mock ${schema} violates the pinned S8 contract: ${describeViolations(violations)}`);
  }
  return body;
}

const noteContent = (note: MockNote): NoteContent => ({ note_id: NOTE_IDS[note.id], content: note.text });

const byNoteId = (noteId: string): MockNote => {
  const found = MOCK_NOTES.find((note) => NOTE_IDS[note.id] === noteId);
  if (!found) throw new Error(`mock note ${noteId} is unknown`);
  return found;
};

function candidateOf(entry: TimelineEntry): ContentCandidate {
  if (entry.kind === "repost") {
    const original = mockNote(entry.of)!;
    return {
      actor_url: entry.by.actorUrl,
      target_actor_url: original.author.actorUrl,
      payload: { kind: "repost", note_id: REPOST_NOTE_IDS[entry.id], reposted_note: noteContent(original) },
    };
  }
  const note = mockNote(entry.id)!;
  if (note.quotes !== undefined) {
    const target = mockNote(note.quotes)!;
    return {
      actor_url: note.author.actorUrl,
      target_actor_url: target.author.actorUrl,
      payload: { kind: "quote", note: noteContent(note), quoted_note: noteContent(target) },
    };
  }
  return { actor_url: note.author.actorUrl, payload: { kind: note.inReplyToId === undefined ? "post" : "reply", note: noteContent(note) } };
}

function directNoteOf(note: MockNote): DirectNote {
  const target = note.quotes === undefined ? undefined : mockNote(note.quotes)!;
  return {
    actor_url: note.author.actorUrl,
    item: target === undefined
      ? { kind: note.inReplyToId === undefined ? "post" : "reply", note: noteContent(note) }
      : {
          kind: "quote",
          note: noteContent(note),
          quoted: { actor_url: target.author.actorUrl, note: noteContent(target), ...(target.restriction ? { restriction: target.restriction } : {}) },
        },
    ...(note.restriction ? { restriction: note.restriction } : {}),
    // The app shows reactions through S3 (quick reaction); S8's counts are not displayed.
    reaction_counts: { likes: 0, emoji: [] },
  };
}

export function authorOf(person: MockPerson, selfDomains: readonly string[]): PostAuthor {
  const domain = actorHost(person.actorUrl) ?? "";
  return { id: person.id, handle: person.handle, displayName: person.displayName, actorUrl: person.actorUrl, domain, local: selfDomains.includes(domain) };
}

/** Display fields of a note S8 showed; the text is S8's content, not the fixture's. */
function postOf(note: MockNote, content: NoteContent, selfDomains: readonly string[], extra: Partial<Post> = {}): Post {
  return {
    id: note.id,
    noteId: content.note_id,
    author: authorOf(note.author, selfDomains),
    text: content.content,
    createdAt: note.createdAt,
    replyCount: note.replyCount,
    repostCount: note.repostCount,
    repostedBy: null,
    inReplyToId: note.inReplyToId ?? null,
    quoted: null,
    ...extra,
  };
}

const controlOut = (control: Pick<DomainControlRef, "mode" | "domain" | "revision">): ContentControl =>
  ({ mode: control.mode, domain: control.domain, revision: control.revision });

function feedPost(item: FeedItem, selfDomains: readonly string[]): Post {
  switch (item.kind) {
    case "post":
    case "reply":
      return postOf(byNoteId(item.note.note_id), item.note, selfDomains);
    case "quote": {
      const target = byNoteId(item.quoted_note.note_id);
      return postOf(byNoteId(item.note.note_id), item.note, selfDomains, {
        quoted: { post: postOf(target, item.quoted_note, selfDomains), hidden: null, restriction: null },
      });
    }
    case "repost": {
      const wrapper = TIMELINE.find((entry) => entry.kind === "repost" && REPOST_NOTE_IDS[entry.id] === item.note_id);
      const by = wrapper?.kind === "repost" ? authorOf(wrapper.by, selfDomains) : null;
      return postOf(byNoteId(item.reposted_note.note_id), item.reposted_note, selfDomains, { repostedBy: by });
    }
  }
}

function embeddedOut(embedded: EmbeddedNotePresentation, selfDomains: readonly string[]): QuotedPost {
  switch (embedded.state) {
    case "visible":
      return { post: postOf(byNoteId(embedded.note.note_id), embedded.note, selfDomains), hidden: null, restriction: null };
    case "hidden":
      return { post: null, hidden: controlOut(embedded), restriction: null };
    case "restricted":
      return { post: null, hidden: null, restriction: embedded.reason };
  }
}

function operationsOut(operations: PostOperationAvailability): PostOperations {
  const one = (permission: PostOperationAvailability["reply"]) => permission.status === "blocked" ? controlOut(permission.control) : null;
  return {
    reply: one(operations.reply),
    quote: one(operations.quote),
    repost: one(operations.repost),
    like: one(operations.like),
    emojiReaction: one(operations.emoji_reaction),
  };
}

/** The GraphQL view of an S8 direct response; a hidden one keeps only its control. */
export function viewOf(id: string, response: DirectNoteResponse, selfDomains: readonly string[]): PostView {
  const presentation = response.presentation;
  switch (presentation.state) {
    case "hidden":
      return { id, post: null, hidden: controlOut(presentation), restriction: null, operations: null };
    case "restricted":
      return { id, post: null, hidden: null, restriction: presentation.reason, operations: operationsOut(presentation.operations) };
    case "visible": {
      const item = presentation.item;
      const note = byNoteId(item.note.note_id);
      const post = postOf(note, item.note, selfDomains, item.kind === "quote" ? { quoted: embeddedOut(item.quoted_note, selfDomains) } : {});
      return { id, post, hidden: null, restriction: null, operations: operationsOut(presentation.operations) };
    }
  }
}

export type MockContent = {
  getTimeline(kind: TimelineKind, viewer: ContentViewer): Promise<Post[]>;
  getPostView(id: string, viewer: ContentViewer, reveal: boolean): Promise<PostView | null>;
  getReplies(postId: string, viewer: ContentViewer): Promise<PostView[]>;
  getUserPage(handle: string, viewer: ContentViewer, reveal: boolean): Promise<UserPage | null>;
};

export function createMockContent(): MockContent {
  async function scope(viewer: ContentViewer): Promise<{ profileId: string; controls: DomainControlRef[] }> {
    return { profileId: await viewer.profileId(), controls: await viewer.controls() };
  }

  async function view(note: MockNote, viewer: ContentViewer, reveal: boolean): Promise<PostView> {
    const { profileId, controls } = await scope(viewer);
    const response = checked("DirectNoteResponse", directView(profileId, controls, directNoteOf(note), reveal));
    return viewOf(note.id, response, viewer.selfDomains);
  }

  return {
    async getTimeline(kind, viewer) {
      const { profileId, controls } = await scope(viewer);
      const entries = kind === "local"
        ? TIMELINE.filter((entry) => entry.kind === "note" && mockNote(entry.id)!.author.handle.endsWith(`@${MOCK_LOCAL_HOST}`))
        : TIMELINE;
      const response = checked("TimelineResponse", timelineFor(profileId, controls, entries.map(candidateOf)));
      return response.items.map((item) => feedPost(item, viewer.selfDomains));
    },
    async getPostView(id, viewer, reveal) {
      const note = mockNote(id);
      return note === undefined ? null : view(note, viewer, reveal);
    },
    async getReplies(postId, viewer) {
      return Promise.all(mockReplies(postId).map((reply) => view(reply, viewer, false)));
    },
    async getUserPage(handle, viewer, reveal) {
      const person = mockPerson(handle);
      if (person === undefined) return null;
      const { profileId, controls } = await scope(viewer);
      const control = controlFor(profileId, controls, person.actorUrl);
      const base = { author: authorOf(person, viewer.selfDomains), bio: person.bio, control: control ? controlOut(control) : null };
      if (control !== undefined && !reveal) return { ...base, hidden: controlOut(control), posts: [] };
      // Revealing the page reveals each listed post on its own (S8 single-note reveal):
      // blocks, gates and hidden quote targets stay as they are.
      const posts = await Promise.all(mockPostsBy(person).map((note) => view(note, viewer, control !== undefined)));
      return { ...base, hidden: null, posts };
    },
  };
}
