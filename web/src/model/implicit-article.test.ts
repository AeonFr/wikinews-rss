/** An entry with no article of its own is about the link its editors highlighted (kept in `more_articles`). */
import { describe, expect, it } from "vitest";
import { buildArticlePage, mainArticle } from "./article-page";
import { buildHome } from "./home";
import { indexOf } from "./news-index";
import { article, headline, news, story, topic, wiki } from "./testing";

const MAP = { url: "https://maps.wikimedia.org/img/x.png", url2x: "https://maps.wikimedia.org/img/x@2x.png", width: 270, height: 200 };
const voyager = { ...article("Voyager 1", "Voyager 1 is a space probe.\nIt was launched in 1977."), location: "Interstellar space", map: MAP };

/** A portal-only entry (no article, no topics) that highlights Voyager 1, as news.json will have it, and its twin without. */
const withLink = () => story("v", { categories: ["Science"], more_articles: [voyager], headlines: [headline("Probe <i>Voyager 1</i> flies far")] });
const withoutLink = () => story("v", { categories: ["Science"], headlines: [headline("Probe <i>Voyager 1</i> flies far")] });
const other = () => story("o", { pub_date: "2026-11-20T10:00:00Z", article: article("Alpha"), headlines: [headline("x", [topic("Alpha")])] });

describe("an entry with a highlighted link", () => {
  it("shows the About column of that article, with its location and map", () => {
    const page = buildArticlePage(news([withLink()]), {}, "v")!;
    expect(mainArticle(withLink())?.title).toBe("Voyager 1");
    expect(page.about).toEqual({
      kind: "article",
      summary: { title: "Voyager 1", url: wiki("Voyager 1"), extract: "Voyager 1 is a space probe.\nIt was launched in 1977." },
      location: "Interstellar space",
      map: { ...MAP, alt: "Map of Interstellar space" },
    });
  });

  it("takes the first highlighted link when there are several", () => {
    const s = withLink();
    s.more_articles = [article("Pale Blue Dot", "Photo."), voyager];
    const page = buildArticlePage(news([s]), {}, "v")!;
    expect(page.about).toMatchObject({ kind: "article", summary: { title: "Pale Blue Dot" } });
  });

  it("still has no page title: it is only the category", () => {
    const page = buildArticlePage(news([withLink()]), {}, "v")!;
    expect(page.title).toBe("Science");
    expect(page.titleIsCategory).toBe(true);
    expect(page.categories).toEqual([]);
    expect(page.crumbs).toEqual([]);
    expect(page.related).toBeNull();
  });

  it("is the same page as before for what does not change", () => {
    const a = buildArticlePage(news([withLink()]), {}, "v")!;
    const b = buildArticlePage(news([withoutLink()]), {}, "v")!;
    expect({ ...a, about: null }).toEqual({ ...b, about: null });
    expect(b.about.kind).toBe("portal");
    expect(b.titleIsCategory).toBe(true);
  });
});

describe("titleIsCategory", () => {
  it("is false for a story with an article, or with a nearest topic but no article", () => {
    const n = news([
      other(),
      story("t", { headlines: [headline("y", [topic("Beta")])], more_articles: [article("Beta")] }),
    ]);
    expect(buildArticlePage(n, {}, "o")!.titleIsCategory).toBe(false);
    const nearTopic = buildArticlePage(n, {}, "t")!;
    expect(nearTopic.titleIsCategory).toBe(false);
    expect(nearTopic.title).toBe("Beta");
  });
});

describe("the implicit article is not a nearest article", () => {
  it("adds nothing to byNearest, nor to the related news of the others", () => {
    const n = news([withLink(), other()]);
    const index = indexOf(n);
    expect([...index.byNearest.keys()]).toEqual(["alpha"]);
    expect([...index.byNearestNewestFirst.keys()]).toEqual(["alpha"]);
    // another story about Voyager 1 does not list the entry as news about its article
    const s = story("w", { pub_date: "2026-11-21T09:00:00Z", article: article("Voyager 1"), headlines: [headline("z", [topic("Voyager 1")])] });
    const related = buildArticlePage(news([withLink(), s]), {}, "w")!.related;
    expect(related).toBeNull();
  });

  it("leaves the home page as it was", () => {
    const stories = (make: () => ReturnType<typeof withLink>) => news([make(), other()]);
    expect(buildHome(stories(withLink))).toEqual(buildHome(stories(withoutLink)));
    const day = buildHome(stories(withLink)).days[0];
    expect(day.portalEntries.map((entry) => [entry.storyId, entry.label])).toEqual([["v", "Science"]]);
  });
});
