import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initializeImpl, configureLimit, enqueueInput, retry, reset, clearFinished, dismiss } from "../src/Client/Upload.js";

// Check behavior at the transport boundary, independently of rendering.
const original = { window: globalThis.window, document: globalThis.document, xhr: globalThis.XMLHttpRequest };
let input, changes, commits, listeners;
class Xhr {
  static requests = [];
  upload = {};
  status = 0;
  responseText = "";
  open(method, url) { this.url = url; this.method = method; }
  setRequestHeader() {}
  send(file) { this.file = file; Xhr.requests.push(this); }
  abort() { this.onabort?.(); }
  progress(loaded, total) { this.upload.onprogress?.({ loaded, total, lengthComputable: true }); }
  complete(status, body) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
}
const persisted = (id, name, folderId = null) => ({ id, name, folderId, mimeType: "text/plain", sizeBytes: 4, createdAt: "2026-10-04", isPublic: false });
const enqueue = (names, folder = "", destination = "マイドライブ") => {
  input.files = names.map((name) => new File(["test"], name, { type: "text/plain" }));
  input.dataset = { folderId: folder, folderName: destination };
  enqueueInput();
};
beforeEach(() => {
  reset();
  Xhr.requests = [];
  changes = [];
  commits = [];
  listeners = new Map();
  input = { files: [], dataset: {}, value: "", click() {} };
  const eventTarget = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  globalThis.window = { ...eventTarget, confirm: () => true };
  globalThis.document = { ...eventTarget, querySelector: () => input, querySelectorAll: () => [] };
  globalThis.XMLHttpRequest = Xhr;
  initializeImpl((value) => () => { changes = value; })((body) => () => { commits.push(JSON.parse(body)); })();
});
afterEach(() => {
  reset();
  globalThis.window = original.window;
  globalThis.document = original.document;
  globalThis.XMLHttpRequest = original.xhr;
});

describe("session upload queue", () => {
  test("serial upload freezes destinations and waits for persistence", () => {
    enqueue(["first.txt", "second.txt"], "folder-a", "マイドライブ / A");
    expect(Xhr.requests).toHaveLength(1);
    expect(changes.map((job) => job.status)).toEqual(["sending", "queued"]);
    enqueue(["third.txt"], "folder-b", "マイドライブ / B");
    Xhr.requests[0].progress(4, 4);
    expect(changes[0].status).toBe("saving");
    expect(commits).toHaveLength(0);
    expect(Xhr.requests).toHaveLength(1);
    Xhr.requests[0].complete(201, persisted("one", "first.txt", "folder-a"));
    expect(changes[0].status).toBe("completed");
    expect(Xhr.requests).toHaveLength(2);
    expect(Xhr.requests[1].url).toContain("folder_id=folder-a");
    Xhr.requests[1].complete(201, persisted("two", "second.txt", "folder-a"));
    expect(Xhr.requests[2].url).toContain("folder_id=folder-b");
    expect(commits).toHaveLength(2);
  });
  test("definite rejection continues the queue and permits explicit safe retry", () => {
    enqueue(["first.txt", "second.txt"]);
    Xhr.requests[0].complete(429, { error: { code: "too_many_requests" } });
    expect(changes[0].retryable).toBe(true);
    expect(Xhr.requests).toHaveLength(2);
    const first = changes[0].id;
    retry(first)();
    expect(Xhr.requests).toHaveLength(2);
    Xhr.requests[1].complete(201, persisted("two", "second.txt"));
    expect(Xhr.requests).toHaveLength(3);
    expect(changes.find((job) => job.id === first).status).toBe("sending");
  });
  test("network loss and server errors are uncertain, with no blind retry", () => {
    enqueue(["first.txt", "second.txt"]);
    Xhr.requests[0].onerror();
    expect(changes[0].status).toBe("uncertain");
    expect(changes[0].retryable).toBe(false);
    retry(changes[0].id)();
    expect(Xhr.requests).toHaveLength(2);
    Xhr.requests[1].complete(500, { error: { code: "internal" } });
    expect(changes[1].status).toBe("uncertain");
  });
  test("invalid successful response never becomes completed", () => {
    enqueue(["first.txt"]);
    Xhr.requests[0].complete(201, { id: "partial", name: "first.txt" });
    expect(changes[0].status).toBe("uncertain");
    expect(commits).toHaveLength(0);
  });
  test("logout discards references and isolates stale callbacks from the next session", () => {
    enqueue(["first.txt", "second.txt"]);
    const oldRequest = Xhr.requests[0];
    reset();
    initializeImpl((value) => () => { changes = value; })((body) => () => { commits.push(body); })();
    enqueue(["new-session.txt"], "new-folder");
    oldRequest.complete(201, persisted("old", "first.txt"));
    expect(changes.map((job) => job.name)).toEqual(["new-session.txt"]);
    expect(commits).toHaveLength(0);
    expect(Xhr.requests).toHaveLength(2);
  });
  test("oversize is rejected before transport; leaving warns only during live uploads", () => {
    configureLimit(3)();
    enqueue(["large.txt"]);
    expect(Xhr.requests).toHaveLength(0);
    expect(changes[0].status).toBe("failed");
    let warned = false;
    listeners.get("beforeunload")({ preventDefault() { warned = true; } });
    expect(warned).toBe(false);
    configureLimit(100)();
    enqueue(["small.txt"]);
    listeners.get("beforeunload")({ preventDefault() { warned = true; } });
    expect(warned).toBe(true);
    Xhr.requests[0].complete(201, persisted("small", "small.txt"));
    clearFinished();
    expect(changes.map((job) => job.name)).toEqual(["large.txt"]);
  });
  test("history removal releases rejected files but cannot cancel active transfers", () => {
    enqueue(["active.txt", "waiting.txt"]);
    const activeId = changes[0].id;
    dismiss(activeId)();
    expect(changes).toHaveLength(2);
    Xhr.requests[0].complete(429, { error: { code: "too_many_requests" } });
    dismiss(activeId)();
    retry(activeId)();
    expect(changes.map((job) => job.name)).toEqual(["waiting.txt"]);
    expect(Xhr.requests).toHaveLength(2);
  });
});
