// D09 (d09-q02): a custom emoji image that fails to load is replaced by its :name:; no broken
// image is left behind. The wrapper gets data-image-failed (App.Dom.trackImageFailures).

import { afterEach, expect, test } from "bun:test";

const originalDocument = globalThis.document;
const originalImage = globalThis.HTMLImageElement;
let instance = 0;

afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalImage === undefined) delete globalThis.HTMLImageElement;
  else globalThis.HTMLImageElement = originalImage;
});

class FakeImage {
  constructor({ complete = false, naturalWidth = 0, cls = "sp-emo-img" } = {}) {
    this.complete = complete;
    this.naturalWidth = naturalWidth;
    this.classList = { contains: (name) => name === cls };
    this.attributes = {};
    this.parentElement = { setAttribute: (name, value) => { this.attributes[name] = value; } };
  }
}

function setup(existing = []) {
  const listeners = [];
  globalThis.HTMLImageElement = FakeImage;
  globalThis.document = {
    addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture }),
    querySelectorAll: (selector) => selector === "img.sp-emo-img" ? existing : [],
  };
  return listeners;
}

test("an image error marks its wrapper; the listener is capturing because error does not bubble", async () => {
  const listeners = setup();
  const dom = await import(`../src/App/Dom.js?image-failure=${++instance}`);
  dom.trackImageFailures();
  dom.trackImageFailures();
  expect(listeners).toHaveLength(1);
  expect(listeners[0]).toMatchObject({ type: "error", capture: true });
  const broken = new FakeImage();
  listeners[0].listener({ target: broken });
  expect(broken.attributes).toEqual({ "data-image-failed": "true" });
  // Other images (avatars, ...) and non-image targets are left alone.
  const avatar = new FakeImage({ cls: "avatar" });
  listeners[0].listener({ target: avatar });
  listeners[0].listener({ target: {} });
  expect(avatar.attributes).toEqual({});
});

test("images that failed before hydration are found by the scan; loaded and pending ones are not marked", async () => {
  const failed = new FakeImage({ complete: true, naturalWidth: 0 });
  const loaded = new FakeImage({ complete: true, naturalWidth: 24 });
  const pending = new FakeImage({ complete: false });
  setup([failed, loaded, pending]);
  const dom = await import(`../src/App/Dom.js?image-failure=${++instance}`);
  dom.trackImageFailures();
  expect(failed.attributes).toEqual({ "data-image-failed": "true" });
  expect(loaded.attributes).toEqual({});
  expect(pending.attributes).toEqual({});
});
