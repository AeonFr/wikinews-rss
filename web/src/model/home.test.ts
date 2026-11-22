import { describe, expect, it } from "vitest";
import { buildHome, isSingleUnit } from "./home";
import { article, headline, news, story, topic } from "./testing";

const image = { url: "https://img/a.jpg", source: "AP", link: "https://ap/x" };

describe("buildHome: topics", () => {
  it("lists the topics that are not retired, as entries labelled with their article", () => {
    const home = buildHome(
      news([
        story("t1", { kind: "topic", article: article("Alpha"), headlines: [headline("About <b>alpha</b>")] }),
        story("t2", { kind: "topic", retired: true, headlines: [headline("old")] }),
        story("t3", { kind: "topic", headlines: [headline("no article")] }),
      ]),
    );
    expect(home.topics.map((t) => [t.storyId, t.label, t.length])).toEqual([
      ["t1", "Alpha", 11],
      ["t3", null, 10],
    ]);
    expect(home.topics[0].href).toBe("/articles/t1/");
    expect(home.topics[0].items[0].html).toBe("About <b>alpha</b>");
    expect(home.days).toEqual([]);
  });
});

describe("buildHome: days", () => {
  it("keeps the last 30 UTC days from `updated`, newest first, never topics", () => {
    const at = (d: string) => `${d}T12:00:00Z`;
    const home = buildHome(
      news(
        [
          story("a", { pub_date: at("2026-11-21"), article: article("A"), headlines: [headline("a")] }),
          story("topic", { kind: "topic", pub_date: at("2026-11-21"), headlines: [headline("t")] }),
          story("b", { pub_date: at("2026-10-23"), article: article("B"), headlines: [headline("b")] }),
          story("old", { pub_date: at("2026-10-22"), article: article("C"), headlines: [headline("c")] }),
          story("mid", { pub_date: at("2026-11-02"), article: article("D"), headlines: [headline("d")] }),
        ],
        { updated: "2026-11-21T18:00:00Z" },
      ),
    );
    expect(home.days.map((d) => d.day)).toEqual(["2026-11-21", "2026-11-02", "2026-10-23"]);
  });

  it("sorts units into portal entries, boxes and tiles", () => {
    const home = buildHome(
      news([
        // single story, one entry, article: tile
        story("tile", { article: article("Alpha"), headlines: [headline("one <i>entry</i>", [topic("Alpha")])] }),
        // no article, several entries: still a portal entry
        story("portal", { categories: ["Sports"], headlines: [headline("first"), headline("second")] }),
        // article with several entries: box
        story("box", { article: article("Beta"), headlines: [headline("x", [topic("Beta")]), headline("y", [topic("Beta")])] }),
        // several stories sharing a group: one box
        story("g1", { group: "grp", article: article("Gamma"), headlines: [headline("p", [topic("Gamma")])] }),
        story("g2", { group: "grp", article: article("Gamma"), headlines: [headline("q", [topic("Gamma")])] }),
      ]),
    );
    expect(home.days).toHaveLength(1);
    const [day] = home.days;
    expect(day.tiles.map((t) => [t.storyId, t.label, t.length, t.items[0].text])).toEqual([["tile", "Alpha", 9, "one entry"]]);
    expect(day.portalEntries.map((p) => [p.storyId, p.label, p.items.length, p.length])).toEqual([["portal", "Sports", 2, 12]]);
    expect(day.boxes.map((b) => [b.id, b.storyIds])).toEqual([
      ["box", ["box"]],
      ["grp", ["g1", "g2"]],
    ]);
    expect(day.tiles[0].href).toBe("/articles/tile/");
  });

  it("applies the unit rule", () => {
    const one = story("a", { article: article("A"), headlines: [headline("x")] });
    const two = story("b", { article: article("B"), headlines: [headline("x"), headline("y")] });
    const noArticle = story("c", { headlines: [headline("x"), headline("y")] });
    expect(isSingleUnit([one])).toBe(true);
    expect(isSingleUnit([two])).toBe(false);
    expect(isSingleUnit([noArticle])).toBe(true);
    expect(isSingleUnit([one, one])).toBe(false);
  });

  it("puts portal entries and boxes with an image first, keeping the order otherwise", () => {
    const portal = (id: string, extra = {}) => story(id, { headlines: [headline(id)], ...extra });
    const box = (id: string, extra = {}) =>
      story(id, { article: article(id), headlines: [headline("x", [topic(id)]), headline("y", [topic(id)])], ...extra });
    const home = buildHome(news([portal("p1"), portal("p2", { image }), portal("p3"), box("b1"), box("b2", { image }), box("b3")]));
    const [day] = home.days;
    expect(day.portalEntries.map((p) => p.storyId)).toEqual(["p2", "p1", "p3"]);
    expect(day.portalEntries[0].image).toEqual({ url: image.url, source: "AP", href: "/articles/p2/" });
    expect(day.boxes.map((b) => b.id)).toEqual(["b2", "b1", "b3"]);
  });

  it("puts the single-article tiles with an image first too, keeping the order otherwise", () => {
    const tile = (id: string, extra = {}) => story(id, { article: article(id), headlines: [headline(id, [topic(id)])], ...extra });
    const [day] = buildHome(news([tile("t1"), tile("t2", { image }), tile("t3"), tile("t4", { image })])).days;
    expect(day.tiles.map((t) => t.storyId)).toEqual(["t2", "t4", "t1", "t3"]);
    expect(day.tiles[0].image).toEqual({ url: image.url, source: "AP", href: "/articles/t2/" });
  });

  it("puts a story in the day of its UTC date", () => {
    const home = buildHome(
      news([story("late", { pub_date: "2026-11-20T23:59:59Z", article: article("A"), headlines: [headline("x")] })]),
    );
    expect(home.days[0].day).toBe("2026-11-20");
  });
});
