// The highlight of the search screen marks exactly the text the keyword matched in the mock's
// fold (NFKC of the whole text, then lowercase): see src/App/Search/Dom.js.
import { describe, expect, test } from "bun:test";
import { alignedFold, highlightSegments } from "../../src/App/Search/Dom.js";

const marked = (query: string, text: string): string[] =>
  (highlightSegments as (q: string) => (t: string) => { text: string; hit: boolean }[])(query)(text)
    .filter((piece) => piece.hit)
    .map((piece) => piece.text);

const rebuilt = (query: string, text: string): string =>
  (highlightSegments as (q: string) => (t: string) => { text: string; hit: boolean }[])(query)(text)
    .map((piece) => piece.text)
    .join("");

const ZWJ = "\u200D";

describe("highlight alignment", () => {
  test("the pieces add up to the whole fold, character by character", () => {
    const samples = [
      "", "abc", "検索結果", "ｶﾞ", "a\uFB00b", "ae\u0301 b", "🎉検索", "\u1100\u1161\u11A8", "前\uAC00後", "ΟΣ", "ΟΣΟΣ ΑΣ.", "Ο" + ZWJ.repeat(9) + "Σ",
      "İstanbul", "ΣΑΣ", "x\u0301\u0301\u0301y", "\u0301abc", "ｱﾞ\uFF9F", "Ο'Σ", "Ο'Σ'Α",
    ];
    for (const text of samples) {
      const aligned = alignedFold(text);
      expect(aligned, JSON.stringify(text)).not.toBeNull();
      expect(aligned!.folded).toBe(text.normalize("NFKC").toLowerCase());
      expect(aligned!.owner.length).toBe(aligned!.folded.length);
      expect(aligned!.groups.map((group: { text: string }) => group.text).join("")).toBe(text);
    }
  });

  test("random mixes (context-dependent parts included) always add up", () => {
    const alphabet = [
      "a", "B", "Σ", "Ο", "σ", "ς", "'", ".", " ", ZWJ, "\u0301", "\u0323", "\u1100", "\u1161", "\u11A8", "\uAC00", "ｶ", "ﾞ", "ガ", "検", "索", "🎉", "\uFB00",
      "İ", "\u00E9", "\uFF21", "\u2126", "\u0345", "ǅ",
    ];
    let seed = 12345;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let round = 0; round < 3000; round += 1) {
      const length = 1 + (next() % 14);
      let text = "";
      for (let i = 0; i < length; i += 1) text += alphabet[next() % alphabet.length];
      const aligned = alignedFold(text);
      expect(aligned, JSON.stringify(text)).not.toBeNull();
      expect(aligned!.folded, JSON.stringify(text)).toBe(text.normalize("NFKC").toLowerCase());
    }
  });
});

describe("highlight ranges", () => {
  test("a final sigma far behind case-ignorable characters does not widen the highlight", () => {
    for (const count of [0, 1, 8, 9, 100]) {
      const ignorable = ZWJ.repeat(count);
      expect(marked("検索", "検索結果を説明するΟ" + ignorable + "Σ"), "ZWJ x" + count).toEqual(["検索"]);
      expect(marked("a", "abc Ο" + ignorable + "Σ def"), "ZWJ x" + count).toEqual(["a"]);
      const apostrophes = "'".repeat(count);
      expect(marked("検索", "検索結果を説明するΟ" + apostrophes + "Σ"), "' x" + count).toEqual(["検索"]);
      expect(marked("a", "abc Ο" + apostrophes + "Σ def"), "' x" + count).toEqual(["a"]);
    }
  });

  test("the sigma follows the final-sigma condition the mock has", () => {
    expect(marked("ος", "ΟΣ")).toEqual(["ΟΣ"]);
    expect(marked("οσ", "ΟΣ")).toEqual([]);
    expect(marked("ς", "Ο" + ZWJ.repeat(100) + "Σ")).toEqual(["Σ"]);
    expect(marked("σ", "Ο" + ZWJ.repeat(100) + "Σ")).toEqual([]);
    expect(marked("ς", "Ο'".repeat(1) + "'".repeat(100) + "Σ")).toEqual(["Σ"]);
    expect(marked("σ", "検" + ZWJ.repeat(100) + "Σ")).toEqual(["Σ"]);
    expect(marked("σα", "ΣΑ")).toEqual(["ΣΑ"]);
    expect(marked("ας", "ΑΣ.")).toEqual(["ΑΣ"]);
    expect(marked("ασ", "ΑΣΑ")).toEqual(["ΑΣ"]);
  });

  test("composition is local", () => {
    expect(marked("\uAC00", "前\u1100\u1161後")).toEqual(["\u1100\u1161"]);
    expect(marked("\u1100\u1161", "前\uAC00後")).toEqual(["\uAC00"]);
    expect(marked("\uAC01", "前\uAC00\u11A8後")).toEqual(["\uAC00\u11A8"]);
    expect(marked("ガ", "あｶﾞい")).toEqual(["ｶﾞ"]);
    expect(marked("ｶﾞ", "あガい")).toEqual(["ガ"]);
    expect(marked("ff", "a\uFB00b")).toEqual(["\uFB00"]);
    expect(marked("\u00E9", "ae\u0301 b")).toEqual(["e\u0301"]);
    expect(marked("e\u0301", "a\u00E9 b")).toEqual(["\u00E9"]);
    expect(marked("🎉", "a🎉b🎉")).toEqual(["🎉", "🎉"]);
    expect(marked("検索", "投稿の検索と検索")).toEqual(["検索", "検索"]);
  });

  test("no match marks nothing and the text is kept whole", () => {
    expect(marked("zzz", "abc")).toEqual([]);
    expect(marked("", "abc")).toEqual([]);
    expect(rebuilt("検索", "検索結果を説明するΟ" + ZWJ.repeat(9) + "Σ")).toBe("検索結果を説明するΟ" + ZWJ.repeat(9) + "Σ");
  });

  test("long texts are fast", () => {
    const start = performance.now();
    marked("a", "a".repeat(50000) + "ΟΣ");
    marked("検索", "検索結果".repeat(12500) + "Ο" + ZWJ.repeat(5000) + "Σ");
    marked("a", "Σ".repeat(20000) + "a");
    marked("a", "a" + ZWJ.repeat(50000) + "Σ");
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
