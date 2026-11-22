import { describe, expect, it } from "vitest";
import { addDays, dayOf } from "../data/days";
import type { Story } from "../data/types";
import { buildArticlePage } from "./article-page";
import { indexNews } from "./news-index";
import { RELATED_WINDOW_DAYS, newsAround } from "./related";
import { article, headline, news, story, topic } from "./testing";

const DAY = "2026-11-21";
const at = (offset: number, hour = 10) => `${addDays(DAY, offset)}T${String(hour).padStart(2, "0")}:00:00Z`;

/** A story about `title` (nearest article) on the day `offset` days from DAY, nested under `above` in its own group. */
function mk(id: string, offset: number, title: string, above: string[] = [], extra: Partial<Story> = {}): Story {
  return story(id, {
    pub_date: at(offset),
    group: extra.group ?? id,
    article: article(above[0] ?? title),
    more_articles: [title, ...above].map((t) => article(t)),
    headlines: [headline(`text of ${id}`, [...above, title].map((t) => topic(t)))],
    ...extra,
  });
}

const page = (stories: Story[], id: string) => buildArticlePage(news(stories), {}, id)!;
const mainIds = (stories: Story[], id: string) => page(stories, id).related?.main.map((n) => n.storyId) ?? [];
describe("the window around a day: main article", () => {
  const cur = mk("cur", 0, "Hormuz");

  it("includes exactly 7 days before and after, and not 8", () => {
    const stories = [cur, mk("m7", -7, "Hormuz"), mk("m8", -8, "Hormuz"), mk("p7", 7, "Hormuz"), mk("p8", 8, "Hormuz")];
    // m8 and p8 are outside the window; they appear only as the fallback when their side has nothing in the window.
    expect(mainIds(stories, "cur")).toEqual(["p7", "m7"]);
    expect(RELATED_WINDOW_DAYS).toBe(7);
  });

  it("compares UTC calendar days, not 24-hour distances", () => {
    const late = { ...mk("late", -7, "Hormuz"), pub_date: `${addDays(DAY, -7)}T00:00:00Z` };
    const early = { ...mk("early", 7, "Hormuz"), pub_date: `${addDays(DAY, 7)}T23:59:59Z` };
    const farLate = { ...mk("far", 8, "Hormuz"), pub_date: `${addDays(DAY, 8)}T00:00:00Z` };
    const stories = [{ ...cur, pub_date: at(0, 23) }, late, early, farLate];
    expect(mainIds(stories, "cur")).toEqual(["early", "late"]);
  });

  it("lists the stories of the same day (other than this one), with the rest", () => {
    const stories = [cur, mk("same1", 0, "Hormuz"), mk("later", 3, "Hormuz")];
    stories[1].pub_date = at(0, 15);
    expect(mainIds(stories, "cur")).toEqual(["later", "same1"]);
    // The story itself is never listed on its own page.
    expect(mainIds(stories, "same1")).toEqual(["later", "cur"]);
  });

  it("lists newest first, mixing later and earlier days, ties in news order", () => {
    const a = mk("a", -2, "Hormuz");
    const b = mk("b", 2, "Hormuz");
    const c = mk("c", 2, "Hormuz");
    const d = mk("d", -6, "Hormuz");
    const e = mk("e", 6, "Hormuz", [], { pub_date: at(6, 3) });
    const stories = [cur, d, a, c, b, e]; // c and b have the same moment; c comes first in the news
    expect(mainIds(stories, "cur")).toEqual(["e", "c", "b", "a", "d"]);
    // ... whatever the order of the news among different moments.
    expect(mainIds([...stories].reverse(), "cur")).toEqual(["e", "b", "c", "a", "d"]);
  });

  it("adds only the most recent earlier story when nothing earlier is in the window", () => {
    const stories = [cur, mk("far1", -30, "Hormuz"), mk("far2", -90, "Hormuz"), mk("old", -9, "Hormuz")];
    expect(mainIds(stories, "cur")).toEqual(["old"]);
    expect(mainIds(stories.filter((s) => s.id !== "old"), "cur")).toEqual(["far1"]);
  });

  it("adds only the nearest later story when nothing later is in the window", () => {
    const stories = [cur, mk("far1", 30, "Hormuz"), mk("far2", 90, "Hormuz"), mk("near", 9, "Hormuz")];
    expect(mainIds(stories, "cur")).toEqual(["near"]);
    expect(mainIds(stories.filter((s) => s.id !== "near"), "cur")).toEqual(["far1"]);
  });

  it("applies the two fallbacks independently of each other", () => {
    const earlierOnly = [cur, mk("m1", -2, "Hormuz"), mk("p20", 20, "Hormuz"), mk("p40", 40, "Hormuz")];
    expect(mainIds(earlierOnly, "cur")).toEqual(["p20", "m1"]); // earlier in the window, later by fallback
    const laterOnly = [cur, mk("p1", 2, "Hormuz"), mk("m20", -20, "Hormuz"), mk("m40", -40, "Hormuz")];
    expect(mainIds(laterOnly, "cur")).toEqual(["p1", "m20"]);
    const neither = [cur, mk("p20", 20, "Hormuz"), mk("m20", -20, "Hormuz")];
    expect(mainIds(neither, "cur")).toEqual(["p20", "m20"]);
  });

  it("does not add a fallback when the window has entries on that side, nor because of same-day stories", () => {
    const withBoth = [cur, mk("m3", -3, "Hormuz"), mk("p3", 3, "Hormuz"), mk("m30", -30, "Hormuz"), mk("p30", 30, "Hormuz")];
    expect(mainIds(withBoth, "cur")).toEqual(["p3", "m3"]);
    // A same-day story is in the window but is neither earlier nor later: the fallbacks still apply.
    const sameDay = [cur, { ...mk("same", 0, "Hormuz"), pub_date: at(0, 12) }, mk("m30", -30, "Hormuz"), mk("p30", 30, "Hormuz")];
    expect(mainIds(sameDay, "cur")).toEqual(["p30", "same", "m30"]);
  });

  it("walks the whole chain by previous and next, whatever the gaps", () => {
    // Every story is reachable from every other by following the listed neighbours.
    const days = [-200, -120, -60, -50, -3, 0, 4, 40, 41, 100];
    const stories = days.map((d, i) => mk(`s${i}`, d, "Hormuz"));
    const links = new Map(stories.map((s) => [s.id, mainIds(stories, s.id)]));
    const seen = new Set<string>(["s0"]);
    const todo = ["s0"];
    while (todo.length) {
      for (const next of links.get(todo.pop()!)!) if (!seen.has(next)) (seen.add(next), todo.push(next));
    }
    expect([...seen].sort()).toEqual(stories.map((s) => s.id).sort());
  });

  it("has no main block for entries without an article, nor for another article's stories", () => {
    const other = mk("other", 1, "Hormuz");
    const portal = story("p", { pub_date: at(0), headlines: [headline("x")] });
    expect(page([portal, other], "p").related).toBeNull();
    expect(mainIds([cur, mk("x", 1, "Gaza")], "cur")).toEqual([]);
  });

  it("names the page's own article for the heading \"Also on ...\"", () => {
    expect(page([cur, mk("o", 1, "Hormuz")], "cur").related!.mainTitle).toBe("Hormuz");
    const t = story("t", { kind: "topic", pub_date: at(0), article: article("Strait of Hormuz"), headlines: [headline("t")] });
    expect(page([t, mk("o", 1, "Strait of Hormuz")], "t").related!.mainTitle).toBe("Strait of Hormuz");
  });

  it("gives a topic the news about its own article, never another topic", () => {
    const t = story("t", { kind: "topic", pub_date: at(0), article: article("Hormuz", "x"), headlines: [headline("t")] });
    const t2 = story("t2", { kind: "topic", pub_date: at(1), article: article("Hormuz", "x"), headlines: [headline("t2")] });
    expect(mainIds([t, t2, mk("other", 1, "Hormuz")], "t")).toEqual(["other"]);
  });

  it("recognises the same article through a differently encoded link, and never lists topics", () => {
    const encoded = story("enc", {
      pub_date: at(2),
      article: article("Hormuz"),
      headlines: [headline("e", [{ label: "Hormuz", url: "https://en.wikipedia.org/wiki/hormuz" }])],
    });
    const t = story("topic", { kind: "topic", pub_date: at(1), article: article("Hormuz"), headlines: [headline("t", [topic("Hormuz")])] });
    expect(mainIds([cur, encoded, t], "cur")).toEqual(["enc"]);
  });

  it("gives each news item its day, link and entries", () => {
    const other = mk("o", -3, "Hormuz");
    other.headlines.push(headline("second entry", [topic("Hormuz")]));
    expect(page([cur, other], "cur").related!.main).toEqual([
      {
        storyId: "o",
        href: "/articles/o/",
        day: addDays(DAY, -3),
        blocks: [{ outlets: [], texts: [expect.objectContaining({ text: "text of o" }), expect.objectContaining({ text: "second entry" })] }],
      },
    ]);
  });
});

describe("related articles", () => {
  // this: Alpha > Beta > Gamma. Other branches of the same group and day sit around it.
  const group = { group: "g" };
  const cur = mk("cur", 0, "Gamma", ["Alpha", "Beta"], group);
  const sibDelta = mk("sibDelta", 0, "Delta", ["Alpha"], group); // Alpha > Delta: another branch
  const sibEps = mk("sibEps", 0, "Epsilon", ["Alpha", "Beta"], group); // Alpha > Beta > Epsilon: a sibling of this one
  const sibGamma = mk("sibGamma", 0, "Gamma", ["Alpha", "Beta"], group); // same article as the main one
  const sibBeta = mk("sibBeta", 0, "Beta", ["Alpha"], group); // an ancestor
  const stories = [cur, sibDelta, sibEps, sibGamma, sibBeta];

  it("lists only the articles above, deepest first: never the siblings' articles of the same group", () => {
    const titles = page(stories, "cur").related!.articles.map((a) => a.title);
    expect(titles).toEqual(["Beta", "Alpha"]);
  });

  it("gives each article its news, only the stories whose nearest article it is", () => {
    const articles = page(stories, "cur").related!.articles;
    const by = Object.fromEntries(articles.map((a) => [a.title, a.news.map((n) => n.storyId)]));
    expect(by.Beta).toEqual(["sibBeta"]);
    expect(by.Alpha).toEqual([]); // no story about Alpha itself: still listed, with no news
    expect(page(stories, "cur").related!.main.map((n) => n.storyId)).toEqual(["sibGamma"]);
  });

  it("the Yemen case: a story under Crisis > War > Strait lists Crisis and War, not the other branch", () => {
    const strait = mk("strait", 0, "Strait", ["Crisis", "War"], group);
    const yemen = mk("yemen", 0, "Houthi conflict", ["Crisis", "Yemeni civil war"], group);
    const offensives = mk("off", 0, "Yemen offensives", ["Crisis", "Yemeni civil war"], group);
    const titles = page([strait, yemen, offensives], "strait").related!.articles.map((a) => a.title);
    expect(titles).toEqual(["War", "Crisis"]);
  });

  it("does not repeat the main article or an ancestor as a related article, nor stories of other groups", () => {
    const other = mk("other", 0, "Zeta", ["Alpha"], { group: "elsewhere" });
    const titles = page([...stories, other], "cur").related!.articles.map((a) => a.title);
    expect(titles).not.toContain("Gamma");
    expect(titles).not.toContain("Zeta");
    expect(titles.filter((t) => t === "Beta")).toHaveLength(1);
  });

  it("keeps an ancestor with no news in the window and no earlier or later story (title and extract only)", () => {
    const only = [mk("s", 0, "Gamma", ["Alpha"])];
    only[0].article = article("Alpha", "Alpha text");
    only[0].more_articles = [article("Gamma")];
    const related = page(only, "s").related!;
    expect(related.main).toEqual([]);
    expect(related.articles).toEqual([{ title: "Alpha", url: "https://en.wikipedia.org/wiki/Alpha", extract: "Alpha text", news: [] }]);
  });

  it("gives each related article its own window and fallbacks, independently of the main article's", () => {
    const more = [
      ...stories,
      mk("alphaNear", -4, "Alpha"),
      mk("alphaOld1", -60, "Alpha"),
      mk("alphaLater", 30, "Alpha"),
      mk("alphaLater2", 80, "Alpha"),
      mk("betaOld", -25, "Beta"),
      mk("betaOlder", -50, "Beta"),
      mk("betaSoon", 5, "Beta"),
    ];
    const by = Object.fromEntries(page(more, "cur").related!.articles.map((a) => [a.title, a.news.map((n) => n.storyId)]));
    expect(by.Alpha).toEqual(["alphaLater", "alphaNear"]); // earlier in the window, so no earlier fallback; later fallback
    expect(by.Beta).toEqual(["betaSoon", "sibBeta", "betaOld"]); // nothing earlier in the window: the most recent earlier one, only
  });

  it("takes the extract from the story's own articles, else from any other story", () => {
    const lonely = mk("cur", 0, "Gamma", ["Alpha", "Beta"]);
    lonely.more_articles = [article("Gamma")];
    lonely.article = article("Gamma");
    const knows = mk("knows", -40, "Beta", ["Alpha"]);
    knows.article = article("Alpha", "Alpha text");
    knows.more_articles = [article("Beta", "Beta text")];
    const related = page([lonely, knows], "cur").related!;
    expect(related.articles.map((a) => [a.title, a.extract])).toEqual([
      ["Beta", "Beta text"],
      ["Alpha", "Alpha text"],
    ]);
    // The story that knows Beta is its earlier fallback.
    expect(related.articles[0].news.map((n) => n.storyId)).toEqual(["knows"]);
  });

  it("falls back to the topic's own label and link when no story knows the article", () => {
    const bare = mk("s", 0, "Gamma", ["Alpha"]);
    bare.more_articles = [];
    bare.article = article("Gamma");
    const articles = page([bare], "s").related!.articles;
    expect(articles).toEqual([{ title: "Alpha", url: "https://en.wikipedia.org/wiki/Alpha", extract: null, news: [] }]);
  });

  it("is null when there is nothing: no news about the article, no ancestors", () => {
    expect(page([mk("s", 0, "Gamma")], "s").related).toBeNull();
    // Another article's stories do not count.
    expect(page([mk("s", 0, "Gamma"), mk("x", 1, "Delta")], "s").related).toBeNull();
  });

  it("shows a nested story with no news around it as its ancestors alone", () => {
    const related = page([mk("s", 0, "Gamma", ["Alpha", "Beta"])], "s").related!;
    expect(related.main).toEqual([]);
    expect(related.articles.map((a) => [a.title, a.news.length])).toEqual([["Beta", 0], ["Alpha", 0]]);
  });

  it("lists the ancestors of a topic page too, and the news about the topic's own article as its main block", () => {
    const t = story("t", {
      kind: "topic",
      pub_date: at(0),
      article: article("Gamma"),
      more_articles: [article("Alpha", "A")],
      headlines: [headline("t", [topic("Alpha"), topic("Gamma")])],
    });
    const related = page([t, mk("g", 1, "Gamma"), mk("a", 1, "Alpha")], "t").related!;
    expect(related.main.map((n) => n.storyId)).toEqual(["g"]);
    expect(related.articles.map((a) => [a.title, a.news.map((n) => n.storyId)])).toEqual([["Alpha", ["a"]]]);
  });
});

describe("newsAround, against a plain scan", () => {
  it("gives the same as filtering the list by hand, on random data", () => {
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const stories: Story[] = [];
    for (let i = 0; i < 300; i++) {
      const offset = Math.floor(random() * 120) - 60;
      stories.push({ ...mk(`r${i}`, offset, "Hormuz"), pub_date: at(offset, Math.floor(random() * 24)) });
    }
    const index = indexNews(news(stories));
    const sorted = index.byNearestNewestFirst.get("hormuz")!;
    expect(sorted).toHaveLength(300);
    for (const current of [...stories.slice(0, 60), mk("x", 0, "Hormuz"), mk("y", 500, "Hormuz"), mk("z", -500, "Hormuz")]) {
      const day = dayOf(current.pub_date);
      const others = sorted.filter((s) => s.id !== current.id);
      const inWindow = (s: Story) => dayOf(s.pub_date) >= addDays(day, -7) && dayOf(s.pub_date) <= addDays(day, 7);
      const earlier = others.filter((s) => dayOf(s.pub_date) < day);
      const later = others.filter((s) => dayOf(s.pub_date) > day);
      const expected = new Set<Story>(others.filter(inWindow));
      if (!earlier.some(inWindow) && earlier.length) expected.add(earlier[0]);
      if (!later.some(inWindow) && later.length) expected.add(later[later.length - 1]);
      expect(newsAround(sorted, current).map((s) => s.id)).toEqual(others.filter((s) => expected.has(s)).map((s) => s.id));
    }
  });

  it("sorts each article's stories newest first in the index", () => {
    const index = indexNews(news([mk("a", -1, "Hormuz"), mk("b", 3, "Hormuz"), mk("c", -5, "Hormuz")]));
    expect(index.byNearestNewestFirst.get("hormuz")!.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });
});
