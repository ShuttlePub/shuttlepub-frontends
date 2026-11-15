// DOM-free helpers of the search screen (highlighting) and the one scroll observer that loads
// the next page. Everything is safe to import during SSR: nothing touches the DOM at load.

const fold = (point) => point.normalize("NFKC").toLowerCase();

const occurrences = (haystack, needle) => {
  const found = [];
  if (needle.length === 0) return found;
  let start = 0;
  while (start + needle.length <= haystack.length) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      found.push([start, start + needle.length]);
      start += needle.length;
    } else {
      start += 1;
    }
  }
  return found;
};

const merge = (ranges) => {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
};

// The text cut into [{ text, hit }] pieces; a piece is a hit where the query matches, ignoring
// case and width. The server does not fix whether a keyword of several words is one substring
// or all words, so the whole keyword is marked where it occurs and, when it does not, each word.
// The pieces become text nodes (never markup), so nothing in a note can inject HTML.
export const highlightSegments = (query) => (text) => {
  const points = Array.from(text);
  const haystack = points.map(fold);
  const trimmed = query.trim();
  const needle = (word) => Array.from(word).map(fold);
  let ranges = occurrences(haystack, needle(trimmed));
  if (ranges.length === 0) {
    const parts = trimmed.split(/[\s\u3000]+/).filter((word) => word !== "");
    ranges = merge(parts.flatMap((word) => occurrences(haystack, needle(word))));
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  const segments = [];
  let position = 0;
  for (const [start, end] of ranges) {
    if (start > position) segments.push({ text: points.slice(position, start).join(""), hit: false });
    segments.push({ text: points.slice(start, end).join(""), hit: true });
    position = end;
  }
  if (position < points.length) segments.push({ text: points.slice(position).join(""), hit: false });
  return segments;
};

export const inputValue = (event) => () => (event.target instanceof HTMLInputElement ? event.target.value : "");

// Calls `callback` once for each end-of-results sentinel (data-search-sentinel, whose value
// identifies the page it follows) that comes near the viewport. The sentinel exists only while
// the next page loads by itself, so an interrupted or failed search never triggers it.
export const trackSearchSentinel = (callback) => () => {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  let notified = null;
  let scheduled = false;
  const check = () => {
    scheduled = false;
    const sentinel = document.querySelector("[data-search-sentinel]");
    if (sentinel === null) {
      notified = null;
      return;
    }
    const key = sentinel.getAttribute("data-search-sentinel");
    if (key === notified) return;
    if (sentinel.getBoundingClientRect().top <= window.innerHeight + 240) {
      notified = key;
      callback();
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(check);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
};
