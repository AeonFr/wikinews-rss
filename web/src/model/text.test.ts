import { describe, expect, it } from "vitest";
import { inlineHtml, plainText, shorten } from "./text";

describe("plainText", () => {
  it("drops tags and decodes entities", () => {
    expect(plainText('Tom &amp; <a href="https://x.org">Jerry</a> <i>win</i> &#39;it&#39; &#x41;')).toBe("Tom & Jerry win 'it' A");
  });
  it("collapses white space and keeps unknown entities", () => {
    expect(plainText("  a \n b &foo; ")).toBe("a b &foo;");
  });
});

describe("inlineHtml", () => {
  it("keeps links to http(s) pages and emphasis", () => {
    expect(inlineHtml('A <a href="https://x.org/?a=1&amp;b=2">link</a> and <b>bold</b> <i>it</i>')).toBe(
      'A <a href="https://x.org/?a=1&amp;b=2" rel="noopener">link</a> and <b>bold</b> <i>it</i>',
    );
  });
  it("drops other tags but keeps their text", () => {
    expect(inlineHtml('<script>x()</script><span>hi</span><img src="a">')).toBe("x()hi");
  });
  it("drops links without a safe href but keeps their text", () => {
    expect(inlineHtml('<a href="javascript:alert(1)">bad</a> <a>none</a>')).toBe("bad none");
  });
  it("balances tags", () => {
    expect(inlineHtml("<b>open <i>nested</b> after</i>")).toBe("<b>open <i>nested</i></b> after");
    expect(inlineHtml("<b>never closed")).toBe("<b>never closed</b>");
  });
  it("escapes a stray <", () => {
    expect(inlineHtml("1 < 2")).toBe("1 &lt; 2");
  });
});

describe("shorten", () => {
  it("leaves short text alone", () => {
    expect(shorten("Short text.", 300)).toBe("Short text.");
    expect(shorten("abc def", 7)).toBe("abc def");
  });
  it("cuts at a word and adds an ellipsis", () => {
    expect(shorten("one two three four", 10)).toBe("one two…");
  });
  it("keeps the last word when the cut falls right after it", () => {
    expect(shorten("one two three", 7)).toBe("one two…");
  });
  it("drops trailing punctuation before the ellipsis", () => {
    expect(shorten("one two, three four", 10)).toBe("one two…");
  });
  it("cuts a single long word", () => {
    expect(shorten("abcdefghij", 4)).toBe("abcd…");
  });
  it("never exceeds the limit by more than the ellipsis", () => {
    const text = "word ".repeat(200).trim();
    for (const n of [1, 5, 17, 100, 300]) expect(shorten(text, n).length).toBeLessThanOrEqual(n + 1);
  });
});
