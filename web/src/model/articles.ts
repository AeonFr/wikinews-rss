/** Which Wikipedia article a story or a topic line is about. */
import type { ArticleRef, Headline, HeadlineTopic, Story } from "../data/types";
import { nearestLabel } from "../data/stories";

/** Identity of a Wikipedia link whatever its encoding: "/wiki/Gaza_war" and "/wiki/Gaza%5Fwar" are the same. */
export function articleKey(url: string): string {
  let title = url.split("/wiki/")[1] ?? url;
  try {
    title = decodeURIComponent(title);
  } catch {
    // keep the raw text
  }
  return title.replace(/_/g, " ").toLowerCase();
}

/**
 * Every article a topic line links. Older data has only `url`, newer data also `links`
 * (which then include `url`).
 */
export function topicLinks(topic: HeadlineTopic): { label: string; url: string }[] {
  if (topic.links?.length) return topic.links;
  return topic.url ? [{ label: topic.label, url: topic.url }] : [];
}

/** Whether a topic line links an article (otherwise it is only a heading). */
export function hasTopicLink(topic: HeadlineTopic): boolean {
  return topicLinks(topic).length > 0;
}

/** The first article of a topic line: the one the line is "about". */
export function topicUrl(topic: HeadlineTopic): string | null {
  return topicLinks(topic)[0]?.url ?? null;
}

/** The topic lines of a headline that link an article, outermost first. */
export function linkedTopics(headline: Headline): HeadlineTopic[] {
  return headline.topics.filter(hasTopicLink);
}

/**
 * The topic line closest to the entry that links an article (what the entry is about), and the lines
 * above it that link one (outermost first). null for an entry under no linked topic.
 */
export function nearestTopic(story: Story): { topic: HeadlineTopic; above: HeadlineTopic[] } | null {
  const chain = story.headlines[0] ? linkedTopics(story.headlines[0]) : [];
  const topic = chain[chain.length - 1];
  return topic ? { topic, above: chain.slice(0, -1) } : null;
}

/**
 * Key of the article a story is about (to find it on other days); null when it has none. An entry with neither an
 * article nor a topic line is about the first link its editors highlighted (`more_articles[0]`, in text order).
 */
export function nearestKey(story: Story): string | null {
  const near = nearestTopic(story);
  const url = near ? topicUrl(near.topic) : story.article ? null : (story.more_articles[0]?.url ?? null);
  return url ? articleKey(url) : null;
}

/** The articles a story knows (its main one and the others on its topic lines). */
export function storyArticles(story: Story): ArticleRef[] {
  return story.article ? [story.article, ...story.more_articles] : [...story.more_articles];
}

/** The article of a topic line, looked up among `articles` (null if none of its links is there). */
export function articleOfTopic(topic: HeadlineTopic, articles: ArticleRef[]): ArticleRef | null {
  const wanted = new Set(topicLinks(topic).map((link) => articleKey(link.url)));
  return articles.find((article) => wanted.has(articleKey(article.url))) ?? null;
}

/** Page title of a story: its nearest article's label, else its article's title, else its category. */
export function pageLabel(story: Story): string {
  if (story.article || nearestTopic(story)) return nearestLabel(story);
  return story.categories[0] ?? story.title;
}
