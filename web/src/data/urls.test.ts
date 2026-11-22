import { describe, expect, it } from "vitest";
import { articlePath, feedPath, homePath, withBase } from "./urls";

describe("withBase", () => {
  it("works with the root base", () => {
    expect(withBase("/articles/a/", "/")).toBe("/articles/a/");
    expect(withBase("articles/a/", "/")).toBe("/articles/a/");
    expect(withBase("", "/")).toBe("/");
  });

  it("prefixes a project base, with or without trailing slash", () => {
    expect(withBase("/feeds/en.xml", "/wikinews-rss")).toBe("/wikinews-rss/feeds/en.xml");
    expect(withBase("feeds/en.xml", "/wikinews-rss/")).toBe("/wikinews-rss/feeds/en.xml");
    expect(withBase("", "/wikinews-rss")).toBe("/wikinews-rss/");
  });
});

describe("articlePath", () => {
  it("is a directory path under the base", () => {
    expect(articlePath("2026-11-21-614b5e1049c9", "/")).toBe("/articles/2026-11-21-614b5e1049c9/");
    expect(articlePath("2026-11-21-614b5e1049c9", "/wikinews-rss")).toBe(
      "/wikinews-rss/articles/2026-11-21-614b5e1049c9/",
    );
  });
});

describe("feedPath and homePath", () => {
  it("respect the base", () => {
    expect(feedPath("/wikinews-rss")).toBe("/wikinews-rss/feeds/en.xml");
    expect(homePath("/wikinews-rss")).toBe("/wikinews-rss/");
    expect(homePath("/")).toBe("/");
  });
});
