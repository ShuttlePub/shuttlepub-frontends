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
    this.parentElement = {
      setAttribute: (name, value) => { this.attributes[name] = value; },
      removeAttribute: (name) => { delete this.attributes[name]; },
    };
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
  expect(listeners.map(({ type, capture }) => [type, capture])).toEqual([["error", true], ["load", true]]);
  const [error] = listeners.map((entry) => entry.listener);
  const broken = new FakeImage();
  error({ target: broken });
  expect(broken.attributes).toEqual({ "data-image-failed": "true" });
  // Other images (avatars, ...) and non-image targets are left alone.
  const avatar = new FakeImage({ cls: "avatar" });
  error({ target: avatar });
  error({ target: {} });
  expect(avatar.attributes).toEqual({});
});

// Flame reuses the wrapper when another emoji takes the same place (favourites replaced in place):
// the failed mark must follow the image that is there now, not stay with the wrapper.
test("the mark follows the current image: a re-render without a new src keeps it, a load clears it, a new error sets it again", async () => {
  const listeners = setup();
  const dom = await import(`../src/App/Dom.js?image-failure=${++instance}`);
  dom.trackImageFailures();
  const [error, load] = listeners.map((entry) => entry.listener);
  const image = new FakeImage();
  error({ target: image });
  expect(image.attributes).toEqual({ "data-image-failed": "true" });
  // The same emoji drawn again: no event, the mark stays (no flicker back to a broken image).
  expect(image.attributes).toEqual({ "data-image-failed": "true" });
  // Another emoji replaces it in the same wrapper and its image loads.
  load({ target: image });
  expect(image.attributes).toEqual({});
  // Loading an avatar never touches a mark.
  const avatar = new FakeImage({ cls: "avatar" });
  avatar.attributes["data-image-failed"] = "true";
  load({ target: avatar });
  expect(avatar.attributes).toEqual({ "data-image-failed": "true" });
  // And a replacement that fails marks again.
  error({ target: image });
  expect(image.attributes).toEqual({ "data-image-failed": "true" });
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
