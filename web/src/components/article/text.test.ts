import { describe, expect, it } from "vitest";
import { buildArticlePage } from "../../model";
import { article, headline, news, story } from "../../model/testing";
import { outletLinkLabel, pageMeta, paragraphs, SITE_NAME } from "./text";

describe("paragraphs", () => {
  it("splits at line breaks and drops empty lines", () => {
    expect(paragraphs("One.\n\n  Two.  \nThree.")).toEqual(["One.", "Two.", "Three."]);
  });
  it("is empty without text", () => {
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs(" \n ")).toEqual([]);
  });
});

describe("outletLinkLabel", () => {
  it("names the outlet and the number", () => {
    expect(outletLinkLabel({ name: "Al Jazeera", links: [] }, 2)).toBe("Al Jazeera, link 2");
  });
});

describe("pageMeta", () => {
  const pageOf = (...texts: string[]) => {
    const s = story("s", { article: article("Topic A"), headlines: texts.map((t) => headline(t)) });
    return buildArticlePage(news([s]), {}, "s")!;
  };

  it("titles the page with the first entry and the site name, without markup", () => {
    const meta = pageMeta(pageOf("A <b>short</b> entry.", "Another."));
    expect(meta.title).toBe(`A short entry. – ${SITE_NAME}`);
    expect(meta.description).toBe("A short entry. Another.");
  });

  it("shortens long entries at a word", () => {
    const long = "word ".repeat(100).trim();
    const meta = pageMeta(pageOf(long));
    expect(meta.title.length).toBeLessThanOrEqual(70 + 3 + SITE_NAME.length);
    expect(meta.title.endsWith(`… – ${SITE_NAME}`)).toBe(true);
    expect(meta.description.length).toBeLessThanOrEqual(200);
    expect(meta.description.endsWith("…")).toBe(true);
  });

  it("falls back to the page title without entries", () => {
    const meta = pageMeta(pageOf());
    expect(meta.title).toBe(`Topic A – ${SITE_NAME}`);
    expect(meta.description).toBe("Topic A");
  });
});
