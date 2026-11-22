import { describe, expect, it } from "vitest";
import { buildArticlePage, entryBlocks, outletsOf, sourceCards } from "./article-page";
import { article, headline, news, story, topic, wiki } from "./testing";

const src = (name: string, url: string) => ({ name, url });

describe("sources and entries", () => {
  it("shows an outlet once, numbering its links when it has several", () => {
    const hs = [
      headline("a", [], { sources: [src("Al Jazeera", "https://aj/1"), src("AP", "https://ap/1")] }),
      headline("b", [], { sources: [src("Al Jazeera", "https://aj/2"), src("Al Jazeera", "https://aj/1")] }),
    ];
    expect(outletsOf(hs)).toEqual([
      { name: "Al Jazeera", links: [{ url: "https://aj/1", number: 1 }, { url: "https://aj/2", number: 2 }] },
      { name: "AP", links: [{ url: "https://ap/1", number: null }] },
    ]);
  });

  it("drops links that are not http(s) but keeps the outlet's name", () => {
    expect(outletsOf([headline("a", [], { sources: [src("X", "ftp://x")] })])).toEqual([{ name: "X", links: [] }]);
  });

  it("merges entries citing the same outlets, in order of appearance", () => {
    const blocks = entryBlocks([
      headline("one", [], { sources: [src("AP", "https://ap/1"), src("BBC", "https://bbc/1")] }),
      headline("two", [], { sources: [src("Reuters", "https://r/1")] }),
      headline("three", [], { sources: [src("BBC", "https://bbc/2"), src("AP", "https://ap/2")] }),
      headline("four"),
    ]);
    expect(blocks.map((b) => b.texts.map((t) => t.text))).toEqual([["one", "three"], ["two"], ["four"]]);
    expect(blocks[0].outlets.map((o) => o.name)).toEqual(["AP", "BBC"]);
    expect(blocks[0].outlets[0].links.map((l) => l.number)).toEqual([1, 2]);
    expect(blocks[2].outlets).toEqual([]);
  });

  it("makes a card per source with a preview, once per page and per (site, title, image)", () => {
    const hs = [
      headline("a", [], {
        sources: [src("AP", "https://ap/1"), src("AP", "https://ap/1?update=2"), src("BBC", "https://bbc/1"), src("No preview", "https://n/1")],
      }),
    ];
    const previews = {
      "https://ap/1": { title: "Live", site: "AP News", image: "https://i/1.jpg", description: "d" },
      "https://ap/1?update=2": { title: "Live", site: "AP News", image: "https://i/1.jpg" },
      "https://bbc/1": { title: "BBC story" },
      "https://n/1": { title: "" },
    };
    expect(sourceCards(hs, previews)).toEqual([
      { url: "https://ap/1", site: "AP News", title: "Live", description: "d", image: "https://i/1.jpg" },
      { url: "https://bbc/1", site: "BBC", title: "BBC story", description: null, image: null },
    ]);
  });
});

describe("buildArticlePage: header", () => {
  it("returns null for an unknown story", () => {
    expect(buildArticlePage(news([]), {}, "nope")).toBeNull();
  });

  it("shows the category chips and the article's title when there are no bigger articles", () => {
    const n = news([
      story("s", { categories: ["Sports", "Business"], article: article("Alpha"), headlines: [headline("x", [topic("Alpha")])] }),
    ]);
    const page = buildArticlePage(n, {}, "s")!;
    expect(page.title).toBe("Alpha");
    expect(page.crumbs).toEqual([]);
    expect(page.categories).toEqual(["Sports", "Business"]);
    expect(page.day).toBe("2026-11-21");
    expect(page.kind).toBe("story");
  });

  it("uses the category as the title of an entry without article, and shows no chips", () => {
    const n = news([story("s", { categories: ["Sports"], headlines: [headline("x")] })]);
    const page = buildArticlePage(n, {}, "s")!;
    expect(page.title).toBe("Sports");
    expect(page.categories).toEqual([]);
    expect(page.about).toEqual({ kind: "portal", page: { title: "Portal:Current events/2026 November 21", url: "https://p/21", history_url: "https://p/21?h" } });
  });

  it("builds the breadcrumb of the bigger articles, linking those another story of the group is about", () => {
    const a = article("Alpha", "About alpha");
    const n = news([
      story("deep", {
        group: "g",
        article: a,
        more_articles: [article("Beta"), article("Gamma")],
        headlines: [headline("x", [topic("Alpha"), topic("Beta"), topic("Gamma")])],
      }),
      story("beta", { group: "g", article: a, headlines: [headline("y", [topic("Alpha"), topic("Beta")])] }),
      story("other", { group: "h", article: a, headlines: [headline("z", [topic("Alpha"), topic("Gamma")])] }),
    ]);
    const page = buildArticlePage(n, {}, "deep")!;
    expect(page.title).toBe("Gamma");
    expect(page.crumbs).toEqual([
      { label: "Alpha", href: null },
      { label: "Beta", href: "/articles/beta/" },
    ]);
    expect(page.categories).toEqual([]);
  });
});

describe("buildArticlePage: where from, about", () => {
  it("lists each portal page once", () => {
    const page2 = { title: "P2", url: "https://p/2", history_url: "https://p/2?h" };
    const n = news([
      story("s", { article: article("Alpha"), headlines: [headline("a"), headline("b"), headline("c", [], { page: page2 })] }),
    ]);
    const from = buildArticlePage(n, {}, "s")!.whereFrom;
    expect(from.kind).toBe("pages");
    if (from.kind === "pages") expect(from.pages.map((p) => p.url)).toEqual(["https://p/21", "https://p/2"]);
  });

  it("gives the moment a topic was added, and a page for a retired topic too", () => {
    const n = news([
      story("t", { kind: "topic", retired: true, pub_date: "2026-11-01T08:30:00Z", article: article("Alpha", "Text"), headlines: [headline("x")] }),
    ]);
    const page = buildArticlePage(n, {}, "t")!;
    expect(page.whereFrom).toMatchObject({ kind: "topic", addedAt: "2026-11-01T08:30:00Z" });
    expect(page.kind).toBe("topic");
    expect(page.retired).toBe(true);
    expect(page.related).toBeNull();
    expect(page.about).toEqual({ kind: "article", summary: { title: "Alpha", url: wiki("Alpha"), extract: "Text" } });
  });

  it("describes the nearest article, not the main one, and keeps the extract whole", () => {
    const long = "word ".repeat(200).trim();
    const n = news([
      story("s", {
        article: article("Alpha", "short"),
        more_articles: [article("Beta", long)],
        headlines: [headline("x", [topic("Alpha"), topic("Beta")])],
      }),
    ]);
    const about = buildArticlePage(n, {}, "s")!.about;
    expect(about).toMatchObject({ kind: "article", summary: { title: "Beta", extract: long } });
  });
});

describe("buildArticlePage: location and map of the article", () => {
  const map = { url: "https://maps.wikimedia.org/img/osm-intl,4,a,a,270x200.png?lang=en", url2x: "https://maps.wikimedia.org/img/osm-intl,4,a,a,270x200@2x.png?lang=en", width: 270, height: 200 };
  const aboutOf = (art: ReturnType<typeof article>, extra: Parameters<typeof story>[1] = {}) =>
    buildArticlePage(news([story("s", { article: art, headlines: [headline("x")], ...extra })]), {}, "s")!.about;

  it("adds the location and the map, with an alt text that names the location", () => {
    const about = aboutOf({ ...article("Alpha", "Text"), location: "Strait of Hormuz, Persian Gulf", map });
    expect(about).toEqual({
      kind: "article",
      summary: { title: "Alpha", url: wiki("Alpha"), extract: "Text" },
      location: "Strait of Hormuz, Persian Gulf",
      map: { ...map, alt: "Map of Strait of Hormuz, Persian Gulf" },
    });
  });

  it("shows a map without a location (alt names the article) and a location without a map", () => {
    expect(aboutOf({ ...article("Alpha"), map: { url: map.url, width: 270, height: 200 } })).toEqual({
      kind: "article",
      summary: { title: "Alpha", url: wiki("Alpha"), extract: null },
      map: { url: map.url, width: 270, height: 200, alt: "Map of Alpha" },
    });
    const only = aboutOf({ ...article("Alpha"), location: " Gaza Strip " });
    expect(only).toEqual({ kind: "article", summary: { title: "Alpha", url: wiki("Alpha"), extract: null }, location: "Gaza Strip" });
    expect(only).not.toHaveProperty("map");
  });

  it("adds nothing when the article has neither", () => {
    const about = aboutOf(article("Alpha", "Text"));
    expect(about).not.toHaveProperty("map");
    expect(about).not.toHaveProperty("location");
  });

  it("ignores a map that is not an image of maps.wikimedia.org, or has no size, and drops a bad 2x", () => {
    expect(aboutOf({ ...article("Alpha"), map: { ...map, url: "https://evil.example/a.png" } })).not.toHaveProperty("map");
    expect(aboutOf({ ...article("Alpha"), map: { ...map, url: "http://maps.wikimedia.org/a.png" } })).not.toHaveProperty("map");
    expect(aboutOf({ ...article("Alpha"), map: { ...map, width: 0 } })).not.toHaveProperty("map");
    const ok = aboutOf({ ...article("Alpha"), map: { ...map, url2x: "https://evil.example/a@2x.png" } });
    expect(ok).toMatchObject({ map: { url: map.url } });
    expect((ok as { map: object }).map).not.toHaveProperty("url2x");
  });

  it("does not give the article's map to a nearer article of the story", () => {
    const about = aboutOf({ ...article("Alpha", "short"), location: "Here", map }, {
      more_articles: [article("Beta", "beta text")],
      headlines: [headline("x", [topic("Alpha"), topic("Beta")])],
    });
    expect(about).toMatchObject({ kind: "article", summary: { title: "Beta" } });
    expect(about).not.toHaveProperty("map");
    expect(about).not.toHaveProperty("location");
  });
});

describe("buildArticlePage: the extract of an article the story only names", () => {
  it("is found on another story, from another day, when this one does not know the article", () => {
    // `this` names Alpha > Beta > Gamma but only knows Gamma; Beta's text is on a story of another day.
    const lonely = story("this", {
      group: "g1",
      article: article("Gamma", "Gamma text"),
      headlines: [headline("x", [topic("Alpha"), topic("Beta"), topic("Gamma")])],
    });
    const other = story("other", {
      group: "g2",
      pub_date: "2026-11-10T10:00:00Z",
      article: article("Beta", "Beta text"),
      more_articles: [article("Alpha", "Alpha text")],
      headlines: [headline("y", [topic("Beta")])],
    });
    const ancestors = buildArticlePage(news([lonely, other]), {}, "this")!.related!.articles;
    expect(ancestors.map((a) => [a.title, a.extract])).toEqual([
      ["Beta", "Beta text"],
      ["Alpha", "Alpha text"],
    ]);
  });

  it("prefers a version that has an extract over a newer one that has none", () => {
    const lonely = story("this", {
      group: "g1",
      article: article("Gamma"),
      headlines: [headline("x", [topic("Beta"), topic("Gamma")])],
    });
    const bare = story("bare", { group: "g2", article: article("Beta"), headlines: [headline("y", [topic("Beta")])] });
    const rich = story("rich", {
      group: "g3",
      pub_date: "2026-11-01T10:00:00Z",
      article: article("Beta", "Beta text"),
      headlines: [headline("z", [topic("Beta")])],
    });
    const ancestors = buildArticlePage(news([lonely, bare, rich]), {}, "this")!.related!.articles;
    expect(ancestors[0].extract).toBe("Beta text");
  });
});
