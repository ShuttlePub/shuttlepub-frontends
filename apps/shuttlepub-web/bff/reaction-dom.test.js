import { afterEach, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let instance = 0;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

const transition = (type, persisted = true) =>
  Object.assign(new Event(type), { persisted });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// F4: pageshow is deliberately dispatched BEFORE the keepalive resolves. A
// resolved HTTP response alone is insufficient: reading its body can be delayed.
test("BFCache restoration freezes immediately and awaits the whole keepalive", async () => {
  const window = new EventTarget();
  globalThis.window = window;
  const dom = await import(`../src/App/ReactionDom.js?restore=${++instance}`);
  let resolveFetch;
  let resolveBody;
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const events = [];
  dom.onPageRestored(() => events.push("freeze"))(() => events.push("reload"))();
  dom.setPendingRemoval("profile-A")("note-1")();
  window.dispatchEvent(transition("pagehide"));
  window.dispatchEvent(transition("pageshow"));
  expect(events).toEqual(["freeze"]);
  expect(calls).toHaveLength(1);
  expect(calls[0].init.keepalive).toBe(true);
  expect(JSON.parse(calls[0].init.body).variables).toEqual({
    profileId: "profile-A", noteId: "note-1",
  });
  resolveFetch({
    ok: true,
    json: () => new Promise((resolve) => { resolveBody = resolve; }),
  });
  await flush();
  expect(events).toEqual(["freeze"]);
  resolveBody({ data: { removeNoteReaction: { noteId: "note-1" } } });
  await flush();
  expect(events).toEqual(["freeze", "reload"]);
  window.dispatchEvent(transition("pagehide"));
  expect(calls).toHaveLength(1); // nothing resent
});

test("failed keepalive releases restore for revalidation, without retrying DELETE", async () => {
  const window = new EventTarget();
  globalThis.window = window;
  const dom = await import(`../src/App/ReactionDom.js?restore=${++instance}`);
  let rejectFetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    return new Promise((_, reject) => { rejectFetch = reject; });
  };
  const events = [];
  dom.onPageRestored(() => events.push("freeze"))(() => events.push("reload"))();
  dom.setPendingRemoval("profile-A")("note-1")();
  window.dispatchEvent(transition("pagehide"));
  window.dispatchEvent(transition("pageshow"));
  expect(events).toEqual(["freeze"]);
  rejectFetch(new Error("offline"));
  await flush();
  expect(events).toEqual(["freeze", "reload"]);
  expect(requests).toBe(1);
});

test("ordinary pageshow is ignored and repeated restores complete only once", async () => {
  const window = new EventTarget();
  globalThis.window = window;
  const dom = await import(`../src/App/ReactionDom.js?restore=${++instance}`);
  globalThis.fetch = () => { throw new Error("synchronous failure"); };
  const events = [];
  dom.onPageRestored(() => events.push("freeze"))(() => events.push("reload"))();
  window.dispatchEvent(transition("pageshow", false));
  expect(events).toEqual([]);
  dom.setPendingRemoval("profile-A")("note-1")();
  window.dispatchEvent(transition("pagehide"));
  window.dispatchEvent(transition("pageshow"));
  window.dispatchEvent(transition("pageshow"));
  await flush();
  expect(events).toEqual(["freeze", "freeze", "reload"]);
});
