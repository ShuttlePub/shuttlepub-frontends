// DOM-free helpers of the search screen (highlighting) and the one scroll observer that loads
// the next page. Everything is safe to import during SSR: nothing touches the DOM at load.

const fold = (text) => text.normalize("NFKC").toLowerCase();

// The matching is done on the whole text folded at once (NFKC, then lowercase), the way the mock does
// (the producer leaves case and word handling undecided, so this is the mock's provisional rule).
// To mark the original text, the fold is built piece by piece so that every folded character knows
// the part of the original text it came from:
//  1. NFKC is applied per normalization segment (a base with what composes with it: marks, Hangul
//     jamo, ...). Whole-text NFKC is the concatenation of the segments' NFKC, so a segment's output
//     belongs to exactly that segment's original text.
//  2. Lowercasing is applied per code point, except the one context-dependent case JS has, Final_Sigma
//     (U+03A3): it is decided with the Unicode condition on the whole NFKC text.
// If the pieces do not add up to the whole fold (they always should), nothing is marked.

const CASED = /\p{Cased}/u;
const IGNORABLE = /\p{Case_Ignorable}/u;
const MARK = /^\p{M}/u;

const nfkc = (text) => text.normalize("NFKC");

// A code point with the combining marks after it (a point that normalizes to a mark, like half-width ﾞ, counts).
const clusters = (text) => {
  const list = [];
  for (const point of Array.from(text)) {
    const last = list[list.length - 1];
    const mark = point.charCodeAt(0) >= 0x300 && (MARK.test(point) || MARK.test(nfkc(point)));
    if (last !== undefined && mark) last.push(point);
    else list.push([point]);
  }
  return list.map((points) => points.join(""));
};

// The clusters grouped into normalization segments: a cluster starts a new segment when normalizing
// it together with the segment before gives the two normalized apart (nothing composes across).
const segments = (text) => {
  const groups = [];
  let current = null;
  for (const atom of clusters(text)) {
    const out = nfkc(atom);
    if (current === null) {
      current = { text: atom, out };
      continue;
    }
    const joined = nfkc(current.text + atom);
    if (joined === current.out + out) {
      groups.push(current);
      current = { text: atom, out };
    } else {
      current.text += atom;
      current.out = joined;
    }
  }
  if (current !== null) groups.push(current);
  return groups;
};

// Unicode's Final_Sigma condition: a cased letter before and none after, case-ignorable characters
// being skipped on both sides. A character that is both (U+0345) is skipped: that is how ICU, which the
// engines' toLowerCase is built on, reads it.
const finalSigma = (points, index) => {
  let before = index - 1;
  while (before >= 0 && IGNORABLE.test(points[before])) before -= 1;
  if (before < 0 || !CASED.test(points[before])) return false;
  let after = index + 1;
  while (after < points.length && IGNORABLE.test(points[after])) after += 1;
  return !(after < points.length && CASED.test(points[after]));
};

// { groups, folded, owner }: the folded text, and for each of its UTF-16 units the index of the
// segment (of the original text) it came from. Null when the pieces do not add up to the whole fold.
export const alignedFold = (text) => {
  const groups = segments(text);
  const points = [];
  const pointGroup = [];
  groups.forEach((group, index) => {
    for (const point of group.out) {
      points.push(point);
      pointGroup.push(index);
    }
  });
  let folded = "";
  const owner = [];
  points.forEach((point, index) => {
    const lower = point === "\u03A3" ? (finalSigma(points, index) ? "\u03C2" : "\u03C3") : point.toLowerCase();
    for (let unit = 0; unit < lower.length; unit += 1) owner.push(pointGroup[index]);
    folded += lower;
  });
  if (folded !== fold(text)) return null;
  return { groups, folded, owner };
};

// The text cut into [{ text, hit }] pieces; a piece is a hit where the keyword matches.
// The pieces become text nodes (never markup), so nothing in a note can inject HTML.
export const highlightSegments = (query) => (text) => {
  const needle = fold(query.trim());
  const plain = [{ text, hit: false }];
  if (needle === "" || !fold(text).includes(needle)) return plain;
  const aligned = alignedFold(text);
  if (aligned === null) return plain;
  const { groups, folded, owner } = aligned;
  const marked = new Array(groups.length).fill(false);
  let from = folded.indexOf(needle);
  while (from !== -1) {
    for (let unit = from; unit < from + needle.length; unit += 1) marked[owner[unit]] = true;
    from = folded.indexOf(needle, from + needle.length);
  }
  const pieces = [];
  groups.forEach((group, index) => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.hit === marked[index]) last.text += group.text;
    else pieces.push({ text: group.text, hit: marked[index] });
  });
  return pieces;
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
