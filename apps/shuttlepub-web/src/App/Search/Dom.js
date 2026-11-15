// DOM-free helpers of the search screen (highlighting) and the one scroll observer that loads
// the next page. Everything is safe to import during SSR: nothing touches the DOM at load.

const fold = (text) => text.normalize("NFKC").toLowerCase();

// The matching is done on the whole text folded at once (NFKC, then lowercase), the way the mock does
// (the producer leaves case and word handling undecided, so this is the mock's provisional rule).
// To mark the original text, it is cut into chunks whose folds, joined, are the fold of the whole
// text: the finest cutting that holds is used (a base with its combining marks, then words, then
// the whole text), because folding depends on context (Greek final sigma, Hangul jamo, NFKC
// composition). A match then marks the chunks its folded characters belong to.
const clusters = (text) => {
  const list = [];
  for (const point of Array.from(text)) {
    const last = list[list.length - 1];
    if (last !== undefined && /^\p{M}/u.test(fold(point))) last.push(point);
    else list.push([point]);
  }
  return list.map((points) => points.join(""));
};

const words = (text) => text.match(/\s+|\S+/gu) ?? [];

const chunksOf = (text, whole) => {
  for (const cut of [clusters, words]) {
    const chunks = cut(text);
    if (chunks.map(fold).join("") === whole) return chunks;
  }
  return [text];
};

// The text cut into [{ text, hit }] pieces; a piece is a hit where the keyword matches.
// The pieces become text nodes (never markup), so nothing in a note can inject HTML.
export const highlightSegments = (query) => (text) => {
  const needle = fold(query.trim());
  const whole = fold(text);
  if (needle === "" || !whole.includes(needle)) return [{ text, hit: false }];
  const chunks = chunksOf(text, whole);
  const owner = [];
  chunks.forEach((chunk, index) => {
    for (let unit = 0; unit < fold(chunk).length; unit += 1) owner.push(index);
  });
  const marked = new Array(chunks.length).fill(false);
  let from = whole.indexOf(needle);
  while (from !== -1) {
    for (let unit = from; unit < from + needle.length; unit += 1) marked[owner[unit]] = true;
    from = whole.indexOf(needle, from + needle.length);
  }
  const segments = [];
  chunks.forEach((chunk, index) => {
    const last = segments[segments.length - 1];
    if (last !== undefined && last.hit === marked[index]) last.text += chunk;
    else segments.push({ text: chunk, hit: marked[index] });
  });
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
