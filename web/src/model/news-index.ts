/** Lookups over the stories, built once so that a page model never scans all the stories. */
import type { ArticleRef, NewsData, Story } from "../data/types";
import { articleKey, nearestKey, storyArticles } from "./articles";

export interface NewsIndex {
  news: NewsData;
  byId: Map<string, Story>;
  /** Stories of a group, in news order. */
  byGroup: Map<string, Story[]>;
  /** Stories about the same nearest article (see `nearestKey`), in news order. */
  byNearest: Map<string, Story[]>;
  /**
   * The same lists as `byNearest`, newest first by `pub_date` (ties in news order): the lookups of "news about
   * an article around a day" binary-search them instead of scanning the stories.
   */
  byNearestNewestFirst: Map<string, Story[]>;
  /**
   * Every article any story knows, by `articleKey`: the newest story's version, unless that has no extract and
   * an older one does. A story only knows its own articles, but the page of a story shows the articles it is
   * nested under, which other stories may know.
   */
  articles: Map<string, ArticleRef>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The moment of a story in milliseconds (0 if its date is unreadable). */
const moment = (story: Story): number => Date.parse(story.pub_date) || 0;

export function indexNews(news: NewsData): NewsIndex {
  const byId = new Map<string, Story>();
  const byGroup = new Map<string, Story[]>();
  const byNearest = new Map<string, Story[]>();
  const articles = new Map<string, ArticleRef>();
  for (const story of news.stories) {
    for (const article of storyArticles(story)) {
      const key = articleKey(article.url);
      const known = articles.get(key);
      if (!known || (!known.extract && article.extract)) articles.set(key, article);
    }
    byId.set(story.id, story);
    if (story.group) push(byGroup, story.group, story);
    const key = nearestKey(story);
    if (key !== null && story.kind !== "topic") push(byNearest, key, story);
  }
  const byNearestNewestFirst = new Map<string, Story[]>();
  for (const [key, list] of byNearest) {
    // Array#sort is stable, so equal moments keep the news order.
    byNearestNewestFirst.set(key, [...list].sort((a, b) => moment(b) - moment(a)));
  }
  return { news, byId, byGroup, byNearest, byNearestNewestFirst, articles };
}

const cache = new WeakMap<NewsData, NewsIndex>();

/** The index of `news`, built the first time and kept for as long as the same object is used. */
export function indexOf(news: NewsData): NewsIndex {
  let index = cache.get(news);
  if (!index) {
    index = indexNews(news);
    cache.set(news, index);
  }
  return index;
}
