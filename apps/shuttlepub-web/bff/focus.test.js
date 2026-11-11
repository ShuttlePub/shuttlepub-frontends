import { afterEach, expect, test } from "bun:test";

const globals = ["document", "Element", "getComputedStyle", "requestAnimationFrame"];
const original = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
let instance = 0;

afterEach(() => {
  for (const key of globals) {
    if (original[key] === undefined) delete globalThis[key];
    else globalThis[key] = original[key];
  }
});

async function fixture() {
  const nodes = new Map();
  const frames = [];
  const listeners = [];
  const focused = [];
  class Element {
    constructor(id, parent = null, attrs = {}) {
      this.id = id;
      this.parentElement = parent;
      this.attrs = attrs;
      this.isConnected = true;
      this.visible = true;
      this.disabled = false;
      this.preferred = null;
      nodes.set(id, this);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    getClientRects() { return this.visible ? [{}] : []; }
    closest() { return null; }
    querySelector() { return this.preferred; }
    focus() {
      document.activeElement = this;
      focused.push(this.id);
      listeners.forEach((listen) => listen({ target: this }));
    }
  }
  const body = new Element("body");
  const document = {
    body,
    activeElement: body,
    addEventListener: (_, listen) => listeners.push(listen),
    getElementById: (id) => nodes.get(id) ?? null,
    querySelector: (selector) => nodes.get(selector.replace(/^#/, "")) ?? null,
  };
  Object.assign(globalThis, {
    document, Element,
    getComputedStyle: (element) => ({ visibility: element.visibility ?? "visible" }),
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  const dom = await import(`../src/App/Dom.js?focus=${++instance}`);
  dom.trackFocus();
  const add = (id, parent, attrs) => new Element(id, parent, attrs);
  const origin = (postId, mine = false) =>
    add(`${mine ? "react-mine-" : "react-"}${postId}`, null, { "data-focus-post": postId });
  const remove = (...elements) => {
    for (const element of elements) {
      element.isConnected = false;
      nodes.delete(element.id);
      if (document.activeElement === element) document.activeElement = body;
    }
  };
  const request = (target, extras = {}) => dom.requestFocus({
    target, postId: "post-a", firstIn: false, onlyIfLost: false, ...extras,
  })();
  const flush = () => frames.splice(0).forEach((callback) => callback());
  return { dom, add, origin, remove, request, flush, document, focused };
}

test("Esc return -> GET removes button -> reserved focus resolves current mine chip", async () => {
  const f = await fixture();
  const picker = f.add("sp-picker", null, { "data-focus-post": "post-a" });
  const search = f.add("sp-picker-search", picker);
  const button = f.origin("post-a");
  search.focus();
  f.remove(search, picker); // Esc has patched the DOM; its effect runs now.
  f.dom.focusById(button.id)();
  f.remove(button); // GET completes before the next animation frame.
  const mine = f.origin("post-a", true);
  f.request(mine.id, { onlyIfLost: true });
  f.flush();
  expect(f.document.activeElement).toBe(mine);
  expect(f.focused.filter((id) => id === mine.id)).toHaveLength(1);
});

test("hidden preferred chip falls back to the current reaction button", async () => {
  for (const hidden of ["layout", "visibility"]) {
    const f = await fixture();
    const mine = f.origin("post-a", true);
    if (hidden === "layout") mine.visible = false;
    else mine.visibility = "hidden";
    const button = f.origin("post-a");
    f.dom.focusById(mine.id)();
    f.flush();
    expect(f.document.activeElement).toBe(button);
  }
});

test("picker opening and breakpoint refocus use the same execution-time fallback", async () => {
  for (const firstIn of [false, true]) {
    const f = await fixture();
    const picker = f.add("sp-picker", null, { "data-focus-post": "post-a" });
    const search = f.add("sp-picker-search", picker);
    picker.preferred = search;
    f.request(firstIn ? "#sp-picker" : search.id, { firstIn });
    f.remove(search, picker);
    const mine = f.origin("post-a", true);
    f.flush();
    expect(f.document.activeElement).toBe(mine);
  }
});

test("GET restoration uses the shared reservation and rechecks reaction state again at execution", async () => {
  const f = await fixture();
  const picker = f.add("sp-picker", null, { "data-focus-post": "post-a" });
  const search = f.add("sp-picker-search", picker);
  const mine = f.origin("post-a", true);
  search.focus();
  f.remove(search, picker);
  f.request(mine.id, { onlyIfLost: true });
  f.remove(mine); // A subsequent removal wins before the queued repair runs.
  const button = f.origin("post-a");
  f.flush();
  expect(f.document.activeElement).toBe(button);
});

test("initial loads and focus lost from another post never acquire focus", async () => {
  const f = await fixture();
  const mine = f.origin("post-a", true);
  f.request(mine.id, { onlyIfLost: true });
  f.flush();
  expect(f.document.activeElement).toBe(f.document.body);
  const other = f.add("sp-picker", null, { "data-focus-post": "post-b" });
  other.focus();
  f.remove(other);
  f.request(mine.id, { onlyIfLost: true });
  f.flush();
  expect(f.document.activeElement).toBe(f.document.body);
});

test("a user moving focus after reservation owns focus, even if the target disappears", async () => {
  const f = await fixture();
  const button = f.origin("post-a");
  button.focus();
  f.dom.focusById(button.id)();
  f.remove(button);
  f.origin("post-a", true);
  const other = f.add("compose-open");
  other.focus();
  f.flush();
  expect(f.document.activeElement).toBe(other);
});

test("newer explicit operations supersede old returns; background repairs do not", async () => {
  const f = await fixture();
  f.dom.focusById("react-post-a")();
  f.request("react-mine-post-a", { onlyIfLost: true });
  const other = f.add("other-dialog");
  f.dom.focusById(other.id)();
  f.origin("post-a", true);
  f.flush();
  expect(f.document.activeElement).toBe(other);
});

test("post ownership is explicit, not parsed from opaque IDs that can start with mine-", async () => {
  const f = await fixture();
  const postId = "mine-opaque-id";
  const button = f.origin(postId);
  button.focus();
  f.dom.focusById(button.id)();
  f.remove(button);
  const mine = f.origin(postId, true);
  f.flush();
  expect(f.document.activeElement).toBe(mine);
});
