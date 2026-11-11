// Keeps the username dialogs (<dialog data-username-dialog>) behaving as real modals:
// - opening: showModal() (the browser makes the rest of the page inert and traps Tab), focus moves to
//   [data-initial-focus] inside the dialog; the opener is remembered
// - each step switch (data-step) moves the focus again to that step's [data-initial-focus]
// - Escape: the native "cancel" is turned into a click on the dialog's [data-cancel] button so the app
//   state (not the DOM) decides what closes
// - closing (the dialog leaves the DOM): focus goes back to the opener, or to [data-dialog-return]
const SELECTOR = "dialog[data-username-dialog]";
const FALLBACK_RETURN = '[data-dialog-return], a[href="/accounts/new"]';

export const installDialogFocus = () => {
  let opener = null;
  let current = null;
  let step = null;

  const focusInitial = (dialog) => {
    const target = dialog.querySelector("[data-initial-focus]") ?? dialog.querySelector("input, button, a[href]");
    if (target instanceof HTMLElement) target.focus();
  };

  const hooked = new WeakSet();

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // A native modal dialog keeps the page behind inert but lets Tab continue into the browser UI; wrap it instead.
  const trapTab = (dialog, event) => {
    if (event.key !== "Tab") return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const hookCancel = (dialog) => {
    if (hooked.has(dialog)) return;
    hooked.add(dialog);
    dialog.addEventListener("keydown", (event) => trapTab(dialog, event));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      const cancel = dialog.querySelector("[data-cancel]");
      if (cancel instanceof HTMLElement) cancel.click();
    });
    // A second Escape can still close the native dialog; the app state decides, so route it the same way.
    dialog.addEventListener("close", () => {
      const cancel = dialog.isConnected ? dialog.querySelector("[data-cancel]") : null;
      if (cancel instanceof HTMLElement) cancel.click();
    });
  };

  const restoreFocus = () => {
    const target = opener && opener.isConnected ? opener : document.querySelector(FALLBACK_RETURN);
    opener = null;
    if (target instanceof HTMLElement) target.focus();
  };

  const sync = () => {
    const dialog = document.querySelector(SELECTOR);
    if (dialog instanceof HTMLDialogElement) {
      hookCancel(dialog);
      if (!dialog.open) {
        if (current === null) opener = document.activeElement;
        dialog.showModal();
        current = dialog;
        step = dialog.dataset.step ?? null;
        focusInitial(dialog);
      } else if (dialog !== current) {
        current = dialog;
        step = dialog.dataset.step ?? null;
        focusInitial(dialog);
      } else if ((dialog.dataset.step ?? null) !== step) {
        step = dialog.dataset.step ?? null;
        focusInitial(dialog);
      }
    } else if (current !== null) {
      current = null;
      step = null;
      restoreFocus();
    }
  };

  new MutationObserver(sync).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-step"],
  });
  sync();
};
