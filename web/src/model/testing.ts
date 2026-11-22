/** Small builders for hand-written test data. */
import type { ArticleRef, Headline, HeadlineTopic, NewsData, Story } from "../data/types";

export const wiki = (title: string): string => `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`;

/** A topic line linking the article of the same name. */
export const topic = (label: string, linked = true): HeadlineTopic => ({
  label,
  url: linked ? wiki(label) : null,
  ...(linked ? { links: [{ label, url: wiki(label) }] } : {}),
});

export const article = (title: string, extract?: string): ArticleRef => ({
  title,
  url: wiki(title),
  ...(extract ? { extract } : {}),
});

let counter = 0;

export function headline(text: string, topics: HeadlineTopic[] = [], extra: Partial<Headline> = {}): Headline {
  return {
    id: `h${++counter}`,
    html: text,
    category: "World",
    sources: [],
    topics,
    page: { title: "Portal:Current events/2026 November 21", url: "https://p/21", history_url: "https://p/21?h" },
    ...extra,
  };
}

export function story(id: string, extra: Partial<Story> = {}): Story {
  return {
    id,
    group: id,
    title: id,
    pub_date: "2026-11-21T10:00:00Z",
    categories: ["World"],
    article: null,
    more_articles: [],
    headlines: [],
    ...extra,
  };
}

export function news(stories: Story[], extra: Partial<NewsData> = {}): NewsData {
  return {
    updated: "2026-11-21T18:00:00Z",
    retention_days: 183,
    portal: { title: "Portal:Current events", url: "https://en.wikipedia.org/wiki/Portal:Current_events" },
    stories,
    ...extra,
  };
}
