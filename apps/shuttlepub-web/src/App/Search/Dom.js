// DOM-free helpers of the search screen (highlighting) and the one scroll observer that loads
// the next page. Everything is safe to import during SSR: nothing touches the DOM at load.

const fold = (text) => text.normalize("NFKC").toLowerCase();

// A cluster is a code point with the combining marks after it (a point that folds to a mark, like
// half-width ﾞ, counts), the unit that is folded (NFKC composes a base with its marks, so
// e + U+0301 is é). Each cluster remembers the UTF-16 units
// of its folded form, so a match found in the folded text maps back to the original text.
const clusters = (text) => {
  const list = [];
  for (const point of Array.from(text)) {
    const last = list[list.length - 1];
    if (last !== undefined && /^\p{M}/u.test(fold(point))) last.text += point;
    else list.push({ text: point });
  }
  return list;
};

// The text cut into [{ text, hit }] pieces; a piece is a hit where the keyword matches as the
// mock (and the producer) match it: the whole keyword as one substring after NFKC and lowercase,
// so ガ and ｶﾞ, ff and ﬀ, é and e + U+0301 are the same. Whether a keyword of several words is
// one substring or all words is not fixed by the contract, so words are not split.
// The pieces become text nodes (never markup), so nothing in a note can inject HTML.
export const highlightSegments = (query) => (text) => {
  const needle = fold(query.trim());
  if (needle === "") return [{ text, hit: false }];
  const list = clusters(text);
  let folded = "";
  const owner = [];
  list.forEach((cluster, index) => {
    const part = fold(cluster.text);
    for (let unit = 0; unit < part.length; unit += 1) owner.push(index);
    folded += part;
  });
  const marked = new Array(list.length).fill(false);
  let found = false;
  let from = folded.indexOf(needle);
  while (from !== -1) {
    found = true;
    for (let unit = from; unit < from + needle.length; unit += 1) marked[owner[unit]] = true;
    from = folded.indexOf(needle, from + needle.length);
  }
  if (!found) return [{ text, hit: false }];
  const segments = [];
  list.forEach((cluster, index) => {
    const last = segments[segments.length - 1];
    if (last !== undefined && last.hit === marked[index]) last.text += cluster.text;
    else segments.push({ text: cluster.text, hit: marked[index] });
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
