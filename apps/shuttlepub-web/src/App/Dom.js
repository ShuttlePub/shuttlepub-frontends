// Browser helpers for focus management, keyboard handling and time formatting.
// Everything that touches `document` / `window` runs only inside event handlers or
// update effects on the client; the SSR bundle imports this module but never calls
// those functions during rendering.

const afterRender = (fn) => {
  // Flame patches the DOM synchronously after update; wait one frame so newly
  // rendered dialogs/menus exist before focusing them.
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
};

export const focusById = (id) => () => {
  afterRender(() => {
    const element = document.getElementById(id);
    if (element) element.focus({ preventScroll: false });
  });
};

export const focusFirstIn = (selector) => () => {
  afterRender(() => {
    const root = document.querySelector(selector);
    if (!root) return;
    const preferred = root.querySelector('[aria-checked="true"]') ?? root.querySelector('[role^="menuitem"], button, a[href], textarea, input');
    if (preferred) preferred.focus();
  });
};

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keeps Tab / Shift+Tab inside an aria-modal dialog.
const trapFocus = (dialog, event) => {
  const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
  if (items.length === 0) { event.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
};

// Arrow / Home / End navigation between the menu items of a role=menu.
const menuNavigation = (menu, event) => {
  const items = Array.from(menu.querySelectorAll('[role^="menuitem"]'));
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement);
  let next = 0;
  if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
  else if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
  else if (event.key === "End") next = items.length - 1;
  items[next].focus();
};

const NONE = { action: "", list: "", value: "" };

// The app's single keydown handler. Flame delegates bubbling events to its root and
// runs only the nearest handler, so all keyboard behaviour lives here:
//  - Escape -> { action: "escape" } (the update decides which layer closes)
//  - Tab inside an aria-modal dialog -> focus trap
//  - arrows inside role=menu -> move between items
//  - ArrowLeft/Right on a role=tab -> { action: "tab", list, value } of the next tab
export const keydownAction = (event) => () => {
  const target = event.target instanceof Element ? event.target : null;
  if (event.key === "Escape") return { action: "escape", list: "", value: "" };
  if (target === null) return NONE;
  if (event.key === "Tab") {
    const dialog = target.closest('[aria-modal="true"]');
    if (dialog) trapFocus(dialog, event);
    return NONE;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    const menu = target.closest('[role="menu"]');
    if (menu) menuNavigation(menu, event);
    return NONE;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const tab = target.closest('[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    if (!tab || !list) return NONE;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const index = tabs.indexOf(tab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    event.preventDefault();
    return { action: "tab", list: list.dataset.tablist ?? "", value: next.dataset.tabValue ?? "" };
  }
  return NONE;
};

// True when a click should be handled in-app (plain left click, no modifier keys).
export const isPlainClick = (event) => () =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export const preventDefault = (event) => () => { event.preventDefault(); };

export const setScrollLock = (locked) => () => {
  document.documentElement.classList.toggle("sp-scroll-locked", locked);
};

export const nowMillis = () => Date.now();

const MOBILE_QUERY = "(max-width: 767px)";

export const isMobileViewport = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;

export const onViewportChange = (callback) => () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", (event) => callback(event.matches)());
};

// POST /auth/logout (same-origin, so the browser sends Origin) then reload the shell.
export const logoutAndReload = () => {
  fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
    .catch(() => undefined)
    .finally(() => window.location.assign("/"));
};

const pad = (value) => String(value).padStart(2, "0");

// "5分前" style relative time. Future or unparsable values fall back to the date.
export const relativeTime = (now) => (iso) => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const seconds = Math.floor((now - time) / 1000);
  if (seconds < 0) return dateOnly(time);
  if (seconds < 60) return "たった今";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}日前`;
  return dateOnly(time);
};

const dateOnly = (time) => {
  const date = new Date(time);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

// "2026年1月15日 11:42" in the viewer's local time zone.
export const fullDateTime = (iso) => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const date = new Date(time);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// First user-perceived character of a name, upper-cased, for letter avatars.
export const initialOf = (name) => {
  const first = Array.from(name.trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
};

// Stable pastel (Catppuccin) background per id, as in the agreed mock.
const AVATAR_COLORS = ["#89b4fa", "#f5c2e7", "#f9e2af", "#a6e3a1", "#94e2d5", "#fab387", "#89dceb", "#b4befe", "#eba0ac", "#cba6f7"];
export const avatarColor = (id) => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

export const scrollToTop = () => { window.scrollTo(0, 0); };
