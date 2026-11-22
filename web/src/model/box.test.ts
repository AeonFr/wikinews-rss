import { describe, expect, it } from "vitest";
import { buildBox } from "./box";
import { article, headline, story, topic, wiki } from "./testing";

const A = article("Alpha", "Alpha is a long article. ".repeat(20));
const B = article("Beta", "Beta summary.");
const C = article("Gamma", "Gamma summary.");
const D = article("Delta", "Delta summary.");

/** A story about `nearest` with the given headlines, all of the unit's group "g". */
const unitStory = (id: string, headlines: ReturnType<typeof headline>[], more = [B, C, D], extra = {}) =>
  story(id, { group: "g", article: A, more_articles: more, headlines, ...extra });

describe("buildBox: title, link and summary", () => {
  it("makes a box of one story with its entries directly under the article", () => {
    const s = unitStory("s1", [headline("a long entry here", [topic("Alpha")]), headline("short", [topic("Alpha")])]);
    const box = buildBox([s]);
    expect(box.title).toBe("Alpha");
    expect(box.titleHref).toBe("/articles/s1/");
    expect(box.entries.map((e) => e.text)).toEqual(["short", "a long entry here"]);
    expect(box.groups).toEqual([]);
    expect(box.summary?.url).toBe(A.url);
    // Shortened to 300 characters at a word boundary.
    expect(box.summary?.extract?.length).toBeLessThanOrEqual(301);
    expect(box.summary?.extract?.endsWith("…")).toBe(true);
    expect(box.entries[0].href).toBe("/articles/s1/");
  });

  it("does not link the title when the box has several stories", () => {
    const s1 = unitStory("s1", [headline("one", [topic("Alpha")])]);
    const s2 = unitStory("s2", [headline("two", [topic("Alpha")])]);
    const box = buildBox([s1, s2]);
    expect(box.titleHref).toBeNull();
    expect(box.entries.map((e) => e.href)).toEqual(["/articles/s1/", "/articles/s2/"]);
    expect(box.storyIds).toEqual(["s1", "s2"]);
  });

  it("does not link the title when the story's nearest article is a sub-topic", () => {
    const s = unitStory("s1", [headline("one", [topic("Alpha"), topic("Beta")]), headline("two", [topic("Alpha"), topic("Beta")])]);
    const box = buildBox([s]);
    // Root has exactly one sub-topic and no entries: the box is Beta, whose page is the story's.
    expect(box.title).toBe("Beta");
    expect(box.titleHref).toBe("/articles/s1/");
    const other = unitStory("s1", [headline("one", [topic("Alpha"), topic("Beta")]), headline("x", [topic("Alpha")])]);
    expect(buildBox([other]).titleHref).toBeNull();
  });

  it("uses the first topic with a link as root, skipping headings", () => {
    const s = unitStory("s1", [
      headline("one", [topic("Heading", false), topic("Alpha"), topic("Beta")]),
      headline("two", [topic("Heading", false), topic("Alpha"), topic("Beta")]),
      headline("three", [topic("Alpha")]),
    ]);
    const box = buildBox([s]);
    expect(box.title).toBe("Alpha");
    expect(box.groups.map((g) => g.title)).toEqual(["Beta"]);
    expect(box.entries.map((e) => e.text)).toEqual(["three"]);
  });
});

describe("buildBox: groups", () => {
  it("makes a sub-topic with several entries a group and dissolves one with a single entry", () => {
    const s = unitStory("s1", [
      headline("loose", [topic("Alpha")]),
      headline("b1", [topic("Alpha"), topic("Beta")]),
      headline("b2 longer", [topic("Alpha"), topic("Beta")]),
      headline("single in gamma", [topic("Alpha"), topic("Gamma")]),
    ]);
    const box = buildBox([s]);
    expect(box.groups.map((g) => g.title)).toEqual(["Beta"]);
    expect(box.groups[0].entries.map((e) => e.text)).toEqual(["b1", "b2 longer"]);
    const dissolved = box.entries.find((e) => e.text === "single in gamma");
    expect(dissolved?.context).toBe("Gamma");
    expect(box.entries.find((e) => e.text === "loose")?.context).toBeNull();
    expect(box.entries.map((e) => e.text)).toEqual(["loose", "single in gamma"]);
  });

  it("keeps the deepest label as context for a dissolved entry", () => {
    const s = unitStory("s1", [
      headline("x", [topic("Alpha")]),
      headline("deep", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
    ]);
    expect(buildBox([s]).entries.find((e) => e.text === "deep")?.context).toBe("Gamma");
  });

  it("titles a sub-topic holding only another one with the chain", () => {
    const s = unitStory("s1", [
      headline("loose", [topic("Alpha")]),
      headline("one", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
      headline("two", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
    ]);
    const [group] = buildBox([s]).groups;
    expect(group.chain).toEqual(["Beta", "Gamma"]);
    expect(group.title).toBe("Beta › Gamma");
    expect(group.entries).toHaveLength(2);
  });

  it("collapses a root with exactly one sub-topic and no entries of its own into it, using the inner title", () => {
    const s = unitStory("s1", [
      headline("one", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
      headline("two", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
    ]);
    const box = buildBox([s]);
    expect(box.title).toBe("Gamma");
    expect(box.groups).toEqual([]);
    expect(box.entries).toHaveLength(2);
    expect(box.summary?.url).toBe(C.url);
  });

  it("collapses repeatedly: the collapsed box can have the sub-groups of the sub-topic", () => {
    const s = unitStory("s1", [
      headline("a", [topic("Alpha"), topic("Beta")]),
      headline("b", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
      headline("c", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
    ]);
    const box = buildBox([s]);
    expect(box.title).toBe("Beta");
    expect(box.entries.map((e) => e.text)).toEqual(["a"]);
    expect(box.groups.map((g) => g.title)).toEqual(["Gamma"]);
  });

  it("keeps at most MAX_LEVELS below the root", () => {
    const deep = [topic("Alpha"), topic("Beta"), topic("Gamma"), topic("Delta")];
    const s = unitStory("s1", [headline("x", [topic("Alpha")]), headline("one", deep), headline("two", deep)]);
    const [group] = buildBox([s]).groups;
    expect(group.chain).toEqual(["Beta", "Gamma"]);
    expect(group.entries).toHaveLength(2);
  });

  it("lists groups after the loose entries and divides a group only if something precedes it", () => {
    const first = [headline("g1a", [topic("Alpha"), topic("Beta")]), headline("g1b", [topic("Alpha"), topic("Beta")])];
    const second = [headline("g2a", [topic("Alpha"), topic("Gamma")]), headline("g2b", [topic("Alpha"), topic("Gamma")])];

    const onlyGroups = buildBox([unitStory("s1", [...first, ...second])]);
    expect(onlyGroups.groups.map((g) => [g.title, g.showDivider])).toEqual([
      ["Beta", false],
      ["Gamma", true],
    ]);

    const withLoose = buildBox([unitStory("s1", [headline("loose", [topic("Alpha")]), ...first])]);
    expect(withLoose.groups[0].showDivider).toBe(true);
  });

  it("counts the image as preceding the first group", () => {
    const s = unitStory(
      "s1",
      [
        headline("g1a", [topic("Alpha"), topic("Beta")]),
        headline("g1b", [topic("Alpha"), topic("Beta")]),
        headline("g2a", [topic("Alpha"), topic("Gamma")]),
        headline("g2b", [topic("Alpha"), topic("Gamma")]),
      ],
      [B, C],
      { image: { url: "https://img/a.jpg", source: "AP", link: "https://ap/x" } },
    );
    expect(buildBox([s]).groups[0].showDivider).toBe(true);
  });
});

describe("buildBox: summaries", () => {
  const twoGroups = [
    headline("g1a", [topic("Alpha"), topic("Beta")]),
    headline("g1b", [topic("Alpha"), topic("Beta")]),
    headline("g2a", [topic("Alpha"), topic("Gamma")]),
    headline("g2b", [topic("Alpha"), topic("Gamma")]),
  ];

  it("gives the summary to the groups, not the box, when the box has groups", () => {
    const box = buildBox([unitStory("s1", twoGroups)]);
    expect(box.summary).toBeNull();
    expect(box.groups.map((g) => g.summary?.title)).toEqual(["Beta", "Gamma"]);
    expect(box.groups[0].summary?.extract).toBe("Beta summary.");
  });

  it("never gives a summary to a group nested in a group", () => {
    const nested = [
      headline("n1", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
      headline("n2", [topic("Alpha"), topic("Beta"), topic("Gamma")]),
      headline("b1", [topic("Alpha"), topic("Beta")]),
      headline("x1", [topic("Alpha"), topic("Delta")]),
      headline("x2", [topic("Alpha"), topic("Delta")]),
    ];
    const box = buildBox([unitStory("s1", nested)]);
    const beta = box.groups.find((g) => g.title === "Beta");
    expect(beta?.summary).not.toBeNull();
    expect(beta?.groups.map((g) => g.title)).toEqual(["Gamma"]);
    expect(beta?.groups[0].summary).toBeNull();
    expect(beta?.groups[0].showDivider).toBe(false);
  });

  it("has no summary for a group whose article is unknown", () => {
    const s = unitStory("s1", twoGroups, [B]);
    expect(buildBox([s]).groups.map((g) => g.summary?.title ?? null)).toEqual(["Beta", null]);
  });

  it("has no summary for the box when its article is unknown, and no text when the article has none", () => {
    const noArticle = story("s1", { group: "g", headlines: [headline("a", [topic("Alpha")]), headline("b", [topic("Alpha")])] });
    expect(buildBox([noArticle]).summary).toBeNull();
    const plain = unitStory("s1", [headline("a", [topic("Alpha")]), headline("b", [topic("Alpha")])]);
    plain.article = article("Alpha");
    expect(buildBox([plain]).summary?.extract).toBeNull();
  });
});

describe("buildBox: image and lengths", () => {
  const image = { url: "https://img/a.jpg", source: "AP", link: "https://ap/x" };

  it("sends the image of a single story to its page and of several stories to its source", () => {
    const one = unitStory("s1", [headline("a", [topic("Alpha")]), headline("b", [topic("Alpha")])], [B], { image });
    expect(buildBox([one]).image).toEqual({ url: image.url, source: "AP", href: "/articles/s1/" });
    const s1 = unitStory("s1", [headline("a", [topic("Alpha")])]);
    const s2 = unitStory("s2", [headline("b", [topic("Alpha")])], [B], { image });
    expect(buildBox([s1, s2]).image?.href).toBe(image.link);
  });

  it("ignores images that are not http(s)", () => {
    const s = unitStory("s1", [headline("a", [topic("Alpha")])], [B], { image: { ...image, url: "data:x" } });
    expect(buildBox([s]).image).toBeNull();
  });

  it("measures the plain text of the entries", () => {
    const s = unitStory("s1", [headline('<a href="https://x.org">abc</a> &amp; de', [topic("Alpha")]), headline("xy", [topic("Alpha")])]);
    const box = buildBox([s]);
    expect(box.entries.map((e) => e.length)).toEqual([2, 8]);
    expect(box.length).toBe(10);
    expect(box.entries[1].html).toBe('<a href="https://x.org" rel="noopener">abc</a> &amp; de');
  });

  it("keeps the unit order among entries of equal length", () => {
    const s1 = unitStory("s1", [headline("bb", [topic("Alpha")])]);
    const s2 = unitStory("s2", [headline("aa", [topic("Alpha")])]);
    expect(buildBox([s1, s2]).entries.map((e) => e.text)).toEqual(["bb", "aa"]);
  });

  it("works with the older data where topic lines have a url but no links", () => {
    const old = (label: string) => ({ label, url: wiki(label) });
    const s = unitStory("s1", [
      headline("x1", [old("Alpha"), old("Beta")]),
      headline("x2", [old("Alpha"), old("Beta")]),
      headline("y", [old("Alpha")]),
    ]);
    const box = buildBox([s]);
    expect(box.groups[0].summary?.title).toBe("Beta");
  });
});
