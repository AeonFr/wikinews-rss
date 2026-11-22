import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DATA_DIR, loadNews, loadSources } from "./load";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "news-data-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadNews", () => {
  it("reads news.json", () => {
    const news = { updated: "2026-11-21T18:49:53Z", retention_days: 183, portal: { title: "P", url: "u" }, stories: [] };
    writeFileSync(join(dir, "news.json"), JSON.stringify(news));
    expect(loadNews(dir)).toEqual(news);
  });

  it("explains a missing file", () => {
    expect(() => loadNews(join(dir, "nope"))).toThrow(/Missing .*news\.json/);
  });

  it("explains an invalid file", () => {
    writeFileSync(join(dir, "news.json"), "{");
    expect(() => loadNews(dir)).toThrow(/Cannot read .*news\.json/);
  });
});

describe("loadSources", () => {
  it("is empty without sources.json", () => {
    expect(loadSources(dir)).toEqual({});
  });

  it("returns the previews by URL", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sources.json"), JSON.stringify({ sources: { "https://a/": { title: "A" } } }));
    expect(loadSources(dir)).toEqual({ "https://a/": { title: "A" } });
  });
});

describe("the real data", () => {
  it("has the expected shape", () => {
    const news = loadNews(DEFAULT_DATA_DIR);
    expect(news.stories.length).toBeGreaterThan(0);
    expect(news.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const story = news.stories[0]!;
    expect(typeof story.id).toBe("string");
    expect(story.headlines.length).toBeGreaterThan(0);
    expect(Object.keys(loadSources(DEFAULT_DATA_DIR)).length).toBeGreaterThan(0);
  });
});
