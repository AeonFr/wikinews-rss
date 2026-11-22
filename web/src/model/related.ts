/**
 * The "Related articles" section of an article page: the news about the page's own article, then the related
 * articles (the ones this story is nested under, the ones its same-day siblings are about), each with its news
 * around the page's day. The idea is that following the previous and next news of any article reaches every
 * story about it.
 */
import { addDays, dayOf } from "../data/days";
import type { ArticleRef, HeadlineTopic, Story } from "../data/types";
import { articleKey, nearestKey, nearestTopic, storyArticles, topicUrl } from "./articles";
import { type EntryBlock, entryBlocks, storyHref } from "./entry";
import type { NewsIndex } from "./news-index";

/** How many days before and after the page's day count as "around it" (never shown on the page). */
export const RELATED_WINDOW_DAYS = 7;

/** One story of the lists: its UTC day (a link to its page) and its entries, with their sources. */
export interface RelatedNews {
  storyId: string;
  href: string;
  day: string;
  blocks: EntryBlock[];
}

/** A related article: its title (linked to Wikipedia), its text, and its news around the page's day (maybe none). */
export interface RelatedArticle {
  title: string;
  /** Link to Wikipedia (null if unknown). */
  url: string | null;
  extract: string | null;
  news: RelatedNews[];
}

export interface Related {
  /** News about the page's own article (no heading: it is the page's article; a topic's too), newest first. */
  main: RelatedNews[];
  /** The articles this one is nested under, deepest first, then the ones its same-day siblings are about. */
  articles: RelatedArticle[];
}

/** The first index of `0..length` for which `test` is true, given that it is false and then true (`length` if never). */
function firstIndex(length: number, test: (i: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (test(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * The stories of `newestFirst` (stories about one article, newest first) to list on the page of `current`:
 * those of the days from `current`'s minus the window to its plus the window (both included, the same day too),
 * except `current` itself, newest first. When no story is of an earlier day inside the window, the most recent
 * earlier one is added (whatever its distance); when none is of a later day inside the window, the nearest later
 * one is added. Binary search on the days: it never scans the list.
 */
export function newsAround(newestFirst: readonly Story[], current: Story): Story[] {
  const day = dayOf(current.pub_date);
  const dayAt = (i: number) => dayOf(newestFirst[i].pub_date);
  const n = newestFirst.length;
  const latest = addDays(day, RELATED_WINDOW_DAYS);
  const earliest = addDays(day, -RELATED_WINDOW_DAYS);
  // [0, windowEnd): later than the window; [windowEnd, sameFrom): later days in it; [sameFrom, sameTo): the day itself;
  // [sameTo, windowStart): earlier days in it; [windowStart, n): earlier than the window.
  const windowEnd = firstIndex(n, (i) => dayAt(i) <= latest);
  const sameFrom = firstIndex(n, (i) => dayAt(i) <= day);
  const sameTo = firstIndex(n, (i) => dayAt(i) < day);
  const windowStart = firstIndex(n, (i) => dayAt(i) < earliest);

  const later = windowEnd < sameFrom ? newestFirst.slice(windowEnd, sameFrom) : sameFrom > 0 ? [newestFirst[sameFrom - 1]] : [];
  const same = newestFirst.slice(sameFrom, sameTo).filter((story) => story.id !== current.id);
  const earlier = sameTo < windowStart ? newestFirst.slice(sameTo, windowStart) : sameTo < n ? [newestFirst[sameTo]] : [];
  return [...later, ...same, ...earlier];
}

const newsItem = (story: Story): RelatedNews => ({
  storyId: story.id,
  href: storyHref(story),
  day: dayOf(story.pub_date),
  blocks: entryBlocks(story.headlines),
});

/** The stories of the same group (the same top-level article of the day) other than `story`, in news order. */
export function groupSiblings(index: NewsIndex, story: Story): Story[] {
  return story.group ? (index.byGroup.get(story.group) ?? []).filter((other) => other.id !== story.id) : [];
}

/**
 * The section of `story`'s page; null when there is nothing to show (no news about its article and no related
 * article). The main block is for the news about the page's own article: a story's nearest article, a topic's article.
 */
export function buildRelated(index: NewsIndex, story: Story, siblings: Story[] = groupSiblings(index, story)): Related | null {
  const mainKey = story.kind === "topic" ? (story.article ? articleKey(story.article.url) : null) : nearestKey(story);
  const newsAbout = (key: string): RelatedNews[] => newsAround(index.byNearestNewestFirst.get(key) ?? [], story).map(newsItem);
  const own = storyArticles(story);

  const seen = new Set<string>(mainKey === null ? [] : [mainKey]);
  const articles: RelatedArticle[] = [];
  const add = (key: string | null, topic: HeadlineTopic): void => {
    if (key === null || seen.has(key)) return;
    seen.add(key);
    const article: ArticleRef | undefined = own.find((candidate) => articleKey(candidate.url) === key) ?? index.articles.get(key);
    articles.push({
      title: article?.title ?? topic.label,
      url: article?.url ?? topicUrl(topic),
      extract: article?.extract?.trim() || null,
      news: newsAbout(key),
    });
  };

  // The articles this story is nested under, deepest first; then the ones its siblings are about, in their order.
  const above = nearestTopic(story)?.above ?? [];
  for (const topic of [...above].reverse()) add(articleKey(topicUrl(topic) ?? ""), topic);
  for (const sibling of siblings) {
    const near = nearestTopic(sibling);
    if (sibling.kind !== "topic" && near) add(nearestKey(sibling), near.topic);
  }

  const main = mainKey === null ? [] : newsAbout(mainKey);
  return main.length === 0 && articles.length === 0 ? null : { main, articles };
}
