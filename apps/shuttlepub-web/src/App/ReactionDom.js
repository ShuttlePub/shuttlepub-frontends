// Browser helpers of the quick reaction UI (D03). Only event handlers and update
// effects call these; SSR imports the module but never runs them.

let pendingRemoval = null;
let pageHideRegistered = false;
// Retain settled outcomes as well as pending Promises until the restore barrier.
const keepalives = new Set();
let restoreSerial = 0;

const REMOVE_MUTATION =
  "mutation RemoveNoteReaction($profileId: ID!, $noteId: ID!) { removeNoteReaction(profileId: $profileId, noteId: $noteId) { noteId } }";

// D03 q09: a removed reaction is sent when its undo toast goes away, and at the latest
// when the page goes away. keepalive lets the request outlive the page.
const sendPendingOnPageHide = () => {
  if (pendingRemoval === null) return;
  const { profileId, noteId } = pendingRemoval;
  pendingRemoval = null;
  // Start immediately on pagehide (not in a deferred microtask). Even synchronous
  // fetch errors become a settled failure, and restoration always revalidates.
  let sent;
  try {
    sent = fetch("/graphql", {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: REMOVE_MUTATION, variables: { profileId, noteId } }),
    });
  } catch {
    sent = Promise.reject(new Error("keepalive did not start"));
  }
  const outcome = Promise.resolve(sent)
    .then(async (response) => response.ok && !(await response.json()).errors?.length)
    .catch(() => false);
  keepalives.add(outcome);
};

export const setPendingRemoval = (profileId) => (noteId) => () => {
  pendingRemoval = { profileId, noteId };
  if (!pageHideRegistered && typeof window !== "undefined") {
    window.addEventListener("pagehide", sendPendingOnPageHide);
    pageHideRegistered = true;
  }
};

export const clearPendingRemoval = () => {
  pendingRemoval = null;
};

// True when a mouseout / focusout leaves the closest `selector` ancestor of the target
// (moving between its children is not leaving).
export const leavesClosest = (selector) => (event) => () => {
  const from = event.target instanceof Element ? event.target.closest(selector) : null;
  if (from === null) return false;
  const to = event.relatedTarget;
  return !(to instanceof Node && from.contains(to));
};

// Firefox starts a drag only when data is set; dragover must preventDefault to allow a drop.
export const startDrag = (event) => () => {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "favorite");
  }
};

// The toast's buttons remove the toast. Blurring first lets its focusout run before
// that render: a focused node removed during Flame's patch fires focusout
// synchronously, re-entering the update with the model of before the click.
export const blurTarget = (event) => () => {
  if (event.target instanceof HTMLElement) event.target.blur();
};

// Moves focus to `id` after the next render only when focus was lost (its element
// was removed and focus fell back to the body), never away from where the user is.
export const focusIfLost = (id) => () => {
  const run = () => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const target = document.getElementById(id);
    if (target) target.focus();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
};

// Freeze interaction synchronously, but do not refetch until all pagehide writes
// settle. A failed / ambiguous keepalive is not retried: GET corrects local truth.
export const onPageRestored = (begin) => (complete) => () => {
  if (typeof window === "undefined") return;
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const serial = ++restoreSerial;
    const waiting = [...keepalives];
    begin();
    Promise.all(waiting).then(() => {
      for (const request of waiting) keepalives.delete(request);
      if (serial === restoreSerial) complete();
    });
  });
};
