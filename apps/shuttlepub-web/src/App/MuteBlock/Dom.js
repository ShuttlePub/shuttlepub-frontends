// Focus management for the mute/block dialogs and the local date of a timestamp.

// Runs after Flame has patched the DOM for the current update; the first id that
// exists wins (the opener may be gone, e.g. a removed row).
export const focusLater = (ids) => () => {
  const run = () => {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) { element.focus(); return; }
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(run));
  else setTimeout(run, 0);
};

// "2026/10/12" in the viewer's local time zone; the raw value if it is not a date.
export const localDate = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

// Full reload: the selected Profile or the session changed under the page.
export const reloadPage = () => window.location.reload();
