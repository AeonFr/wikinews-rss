import { describe, expect, it } from "vitest";
import { nearestLabel } from "./stories";
import type { Headline, Story } from "./types";

const headline = (topics: Headline["topics"]): Headline => ({
  id: "h",
  html: "x",
  category: "c",
  sources: [],
  topics,
  page: { title: "p", url: "u", history_url: "h" },
});
const story = (headlines: Headline[], article: Story["article"] = null): Story => ({
  id: "s",
  group: "s",
  title: "Story title",
  pub_date: "2026-11-21T00:00:00Z",
  categories: [],
  article,
  more_articles: [],
  headlines,
});

describe("nearestLabel", () => {
  it("is the innermost topic that links an article", () => {
    const topics = [
      { label: "Outer", url: "https://a" },
      { label: "Inner", url: "https://b" },
      { label: "No link", url: null },
    ];
    expect(nearestLabel(story([headline(topics)]))).toBe("Inner");
  });
  it("falls back to the article, then the story title", () => {
    expect(nearestLabel(story([headline([])], { title: "Article", url: "u" }))).toBe("Article");
    expect(nearestLabel(story([headline([])]))).toBe("Story title");
  });
});
