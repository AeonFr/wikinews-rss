/** The model of an article page (`/articles/<id>/`): everything the page shows, with no markup. */
import { dayOf } from "../data/days";
import type { ArticleRef, Headline, HeadlineTopic, NewsData, SourcePreviews, Story } from "../data/types";
import { articleKey, nearestKey, nearestTopic, pageLabel, storyArticles, topicUrl } from "./articles";
import { type ArticleMapView, type EntryBlock, type Summary, entryBlocks, mapOf, storyHref, summaryOf } from "./entry";
import { indexOf } from "./news-index";
import { type Related, buildRelated, groupSiblings } from "./related";

export interface PortalPage {
  title: string;
  url: string;
  history_url: string;
}

/** Where the entries come from. A topic says when it was added to the portal; the renderer formats the date. */
export type WhereFrom =
  | { kind: "topic"; addedAt: string; page: PortalPage }
  | { kind: "pages"; pages: PortalPage[] };

export interface Crumb {
  label: string;
  /** The page of another story of the group that is about this article; null: plain text. */
  href: string | null;
}

export interface SourceCard {
  url: string;
  /** The site, else the outlet's name, else the host. */
  site: string;
  title: string;
  description: string | null;
  image: string | null;
}

/** The "About the article" column. */
export type About =
  | { kind: "article"; summary: Summary; location?: string; map?: ArticleMapView }
  | { kind: "portal"; page: PortalPage };

export interface ArticlePage {
  id: string;
  /** "topic" and retired topics included: they have pages like any story. */
  kind: "story" | "topic";
  retired: boolean;
  /** `<h1>`: the nearest article's label, else the article's title, else the category. */
  title: string;
  /**
   * `title` is only the editors' category (the story has neither an article nor a nearest topic): the page shows no
   * title, and an article taken from the entry's highlighted link (`about`) is named in its own column instead.
   */
  titleIsCategory: boolean;
  /** ISO UTC moment of the story; `day` is its UTC day. */
  pubDate: string;
  day: string;
  /** Bigger articles it is nested under, outermost first. */
  crumbs: Crumb[];
  /** Shown instead of crumbs when there are none. Empty for an entry without article (its category is the title). */
  categories: string[];
  entries: EntryBlock[];
  whereFrom: WhereFrom;
  sourceCards: SourceCard[];
  /** null when there is nothing to show: no news about the article and no related article. */
  related: Related | null;
  about: About;
}

// ---- Entries and sources --------------------------------------------------------------------

function whereFrom(story: Story): WhereFrom {
  if (story.kind === "topic") return { kind: "topic", addedAt: story.pub_date, page: story.headlines[0].page };
  const pages = new Map<string, PortalPage>();
  for (const { page } of story.headlines) if (!pages.has(page.url)) pages.set(page.url, page);
  return { kind: "pages", pages: [...pages.values()] };
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];

/** A card per cited source that has a preview; links to the same page or with the same (site, title, image) once. */
export function sourceCards(headlines: Headline[], previews: SourcePreviews): SourceCard[] {
  const seen = new Set<string>();
  const cards: SourceCard[] = [];
  for (const source of headlines.flatMap((headline) => headline.sources)) {
    const preview = previews[source.url];
    if (!preview?.title || !isHttp(source.url)) continue;
    const key = `${preview.site ?? ""}\n${preview.title}\n${preview.image ?? ""}`;
    if (seen.has(source.url) || seen.has(key)) continue;
    seen.add(source.url);
    seen.add(key);
    cards.push({
      url: source.url,
      site: preview.site || source.name || hostOf(source.url),
      title: preview.title,
      description: preview.description || null,
      image: preview.image && isHttp(preview.image) ? preview.image : null,
    });
  }
  return cards;
}

// ---- Where it sits ---------------------------------------------------------------------------

function crumbsOf(above: HeadlineTopic[], siblings: Story[]): Crumb[] {
  return above.map((topic) => {
    const key = articleKey(topicUrl(topic) ?? "");
    const page = siblings.find((sibling) => nearestKey(sibling) === key);
    return { label: topic.label, href: page ? storyHref(page) : null };
  });
}

/**
 * The article the entries are about: the one their nearest topic names, else the story's first; null without any.
 * An entry with no article of its own takes the first of its `more_articles`: the link its editors highlighted.
 */
export function mainArticle(story: Story): ArticleRef | null {
  const articles = storyArticles(story);
  const near = nearestTopic(story);
  const url = near && topicUrl(near.topic);
  const wanted = url ? articleKey(url) : null;
  return articles.find((article) => articleKey(article.url) === wanted) ?? articles[0] ?? null;
}

/** The "About the article" column of an article: its summary and, if known, the infobox's location and map. */
export function aboutArticle(article: ArticleRef): Extract<About, { kind: "article" }> {
  const location = article.location?.trim();
  const map = mapOf(article);
  return { kind: "article", summary: summaryOf(article), ...(location ? { location } : {}), ...(map ? { map } : {}) };
}

// ---- The page --------------------------------------------------------------------------------

/** The page of a story, or null if there is no such story. */
export function buildArticlePage(news: NewsData, sources: SourcePreviews, storyId: string): ArticlePage | null {
  const index = indexOf(news);
  const story = index.byId.get(storyId);
  if (!story) return null;

  const near = nearestTopic(story);
  const siblings = groupSiblings(index, story);
  const article = mainArticle(story);
  const crumbs = crumbsOf(near?.above ?? [], siblings);
  return {
    id: story.id,
    kind: story.kind === "topic" ? "topic" : "story",
    retired: story.retired === true,
    title: pageLabel(story),
    titleIsCategory: !story.article && near === null,
    pubDate: story.pub_date,
    day: dayOf(story.pub_date),
    crumbs,
    categories: crumbs.length === 0 && story.article ? story.categories : [],
    entries: entryBlocks(story.headlines),
    whereFrom: whereFrom(story),
    sourceCards: sourceCards(story.headlines, sources),
    related: buildRelated(index, story, siblings),
    about: article ? aboutArticle(article) : { kind: "portal", page: story.headlines[0].page },
  };
}

/** The ids of every story: one page each. */
export function articleIds(news: NewsData): string[] {
  return news.stories.map((story) => story.id);
}
