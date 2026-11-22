import { describe, expect, it } from "vitest";
import { loadNews, loadSources } from "../data/load";
import type { NewsData, Story } from "../data/types";
import type { BoxContent } from "./box";
import { createSiteModel } from "./site";
import { article, headline, news, story, topic } from "./testing";

describe("createSiteModel", () => {
  it("builds the home once and page models on demand", () => {
    const model = createSiteModel(
      news([story("a", { article: article("Alpha"), headlines: [headline("x", [topic("Alpha")])] })]),
      {},
    );
    expect(model.articleIds()).toEqual(["a"]);
    expect(model.home()).toBe(model.home());
    expect(model.articlePage("a")?.title).toBe("Alpha");
    expect(model.articlePage("missing")).toBeNull();
  });
});

/** All the entries of a box or group, groups included. */
function allEntries(content: BoxContent): string[] {
  return [...content.entries.map((e) => e.storyId + e.text), ...content.groups.flatMap(allEntries)];
}

function checkContent(content: BoxContent, direct: boolean): void {
  for (const entry of content.entries) {
    expect(entry.length).toBe(entry.text.length);
    expect(entry.href.startsWith("/articles/")).toBe(true);
  }
  const lengths = content.entries.map((e) => e.length);
  expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  for (const group of content.groups) {
    expect(allEntries(group).length).toBeGreaterThanOrEqual(2);
    if (!direct) expect(group.summary).toBeNull();
    checkContent(group, false);
  }
}

describe("the real data", () => {
  const data = loadNews();
  const sources = loadSources();
  const model = createSiteModel(data, sources);

  it("builds a home that holds every recent story exactly once", () => {
    const home = model.home();
    const seen = home.days.flatMap((day) => [
      ...day.portalEntries.map((e) => e.storyId),
      ...day.tiles.map((e) => e.storyId),
      ...day.boxes.flatMap((b) => b.storyIds),
    ]);
    expect(new Set(seen).size).toBe(seen.length);
    const cutoff = new Date(`${data.updated.slice(0, 10)}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const expected = data.stories.filter((s) => s.kind !== "topic" && s.pub_date.slice(0, 10) > cutoff.toISOString().slice(0, 10));
    expect(seen.sort()).toEqual(expected.map((s) => s.id).sort());
    expect(home.days.length).toBeLessThanOrEqual(30);
    expect(home.topics.length).toBe(data.stories.filter((s) => s.kind === "topic" && !s.retired).length);
  });

  it("keeps every entry of every box, and the box rules", () => {
    const byId = new Map(data.stories.map((s) => [s.id, s]));
    for (const day of model.home().days) {
      for (const box of day.boxes) {
        const expected = box.storyIds.reduce((n, id) => n + byId.get(id)!.headlines.length, 0);
        expect(allEntries(box)).toHaveLength(expected);
        checkContent(box, true);
        // The box's own summary is only for a box without groups (a group keeps its own).
        if (box.groups.length > 0) expect(box.summary).toBeNull();
        expect(box.title.length).toBeGreaterThan(0);
        expect(box.length).toBe(box.entries.reduce((n, e) => n + e.length, 0) + box.groups.reduce((n, g) => n + g.length, 0));
        if (box.titleHref) expect(box.storyIds).toHaveLength(1);
        const preceding = (box.image ? 1 : 0) + box.entries.length;
        box.groups.forEach((g, i) => expect(g.showDivider).toBe(preceding + i > 0));
        for (const group of box.groups) {
          for (const sub of group.groups) expect(sub.showDivider).toBe(false);
        }
      }
      const withImage = (list: { image: unknown }[]) => list.map((x) => x.image !== null);
      for (const flags of [withImage(day.portalEntries), withImage(day.boxes)]) {
        expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
      }
    }
  });

  it("builds a page for every story", () => {
    for (const id of model.articleIds()) {
      const page = model.articlePage(id);
      expect(page, id).not.toBeNull();
      expect(page!.title.length).toBeGreaterThan(0);
      expect(page!.entries.flatMap((block) => block.texts)).toHaveLength(data.stories.find((s) => s.id === id)!.headlines.length);
      const listed = [...(page!.related?.main ?? []), ...(page!.related?.articles ?? []).flatMap((a) => a.news)];
      for (const other of listed) {
        expect(other.storyId).not.toBe(id);
        expect(other.href.startsWith("/articles/")).toBe(true);
      }
      expect(page!.related === null || page!.related.main.length + page!.related.articles.length > 0).toBe(true);
    }
  });
});

describe("scale", () => {
  it("builds the pages of a few thousand stories in a short time", () => {
    const base = loadNews();
    const copies = 8;
    const stories: Story[] = [];
    for (let i = 0; i < copies; i++) {
      for (const s of base.stories) {
        stories.push({ ...s, id: `${s.id}-${i}`, group: `${s.group}-${i}` });
      }
    }
    const big: NewsData = { ...base, stories };
    const model = createSiteModel(big, {});
    const start = performance.now();
    model.home();
    for (const id of model.articleIds()) model.articlePage(id);
    expect(stories.length).toBeGreaterThan(4000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
