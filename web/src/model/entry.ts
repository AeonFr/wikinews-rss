/** Small shapes shared by the home page and the article page models. */
import type { ArticleMap, ArticleRef, Headline, Story } from "../data/types";
import { articlePath } from "../data/urls";
import { inlineHtml, plainText, shorten } from "./text";

/** One entry's text: safe inline `html` (links and emphasis only), the plain `text` and its length in characters. */
export interface TextItem {
  html: string;
  text: string;
  length: number;
}

export function textItem(headline: Headline): TextItem {
  const text = plainText(headline.html);
  return { html: inlineHtml(headline.html), text, length: text.length };
}

/** An image of a story: `href` is where clicking it goes. */
export interface ModelImage {
  url: string;
  /** Name of the outlet the image comes from. */
  source: string;
  href: string;
}

/** The story's image (http/https only) linking to `href`; null when it has none. */
export function storyImage(story: Story, href: string): ModelImage | null {
  const image = story.image;
  if (!image || !/^https?:\/\//i.test(image.url)) return null;
  return { url: image.url, source: image.source, href };
}

/** Path of a story's article page (with the site's base path). */
export function storyHref(story: Pick<Story, "id">): string {
  return articlePath(story.id);
}

/** "About the article": the start of an article's text (`extract`, null if Wikipedia gave none) and where to read it. */
export interface Summary {
  title: string;
  url: string;
  extract: string | null;
}

/** A map of the article for the "About the article" column. `alt` describes it. */
export interface ArticleMapView extends ArticleMap {
  alt: string;
}

const MAPS_HOST = "https://maps.wikimedia.org/";

/** The article's infobox map, if it has one hosted on maps.wikimedia.org (anything else is ignored); with its alt text. */
export function mapOf(article: ArticleRef): ArticleMapView | null {
  const map = article.map;
  if (!map || !map.url.startsWith(MAPS_HOST) || !(map.width > 0) || !(map.height > 0)) return null;
  const url2x = map.url2x?.startsWith(MAPS_HOST) ? map.url2x : undefined;
  return {
    url: map.url,
    ...(url2x ? { url2x } : {}),
    width: map.width,
    height: map.height,
    alt: `Map of ${article.location?.trim() || article.title}`,
  };
}

/** An article's summary, its text cut to `limit` characters when given (the article page shows it whole). */
export function summaryOf(article: ArticleRef, limit?: number): Summary {
  const extract = article.extract?.trim() || null;
  return {
    title: article.title,
    url: article.url,
    extract: extract !== null && limit !== undefined ? shorten(extract, limit) : extract,
  };
}

// ---- Entries and sources --------------------------------------------------------------------

/** One cited outlet. A single link is the outlet's name as a link; several are numbered ("Al Jazeera (1, 2)"). */
export interface Outlet {
  name: string;
  /** http/https pages only; `number` is 1, 2, ... when the outlet has several links, else null. */
  links: { url: string; number: number | null }[];
}

/** Entries that cite the same outlets, shown together with one "Sources" line (`outlets` is empty: no line). */
export interface EntryBlock {
  texts: TextItem[];
  outlets: Outlet[];
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

/** The outlets cited by some headlines: each name once, its pages in order of appearance. */
export function outletsOf(headlines: Headline[]): Outlet[] {
  const pages = new Map<string, string[]>();
  for (const { sources } of headlines) {
    for (const source of sources) {
      const name = source.name || source.url;
      const urls = pages.get(name) ?? [];
      if (!urls.includes(source.url)) urls.push(source.url);
      pages.set(name, urls);
    }
  }
  return [...pages].map(([name, urls]) => {
    const links = urls.filter(isHttp);
    return { name, links: links.map((url, i) => ({ url, number: links.length > 1 ? i + 1 : null })) };
  });
}

/** Headlines citing the same outlets are shown together (the first one's position decides the order). */
export function entryBlocks(headlines: Headline[]): EntryBlock[] {
  const blocks = new Map<string, Headline[]>();
  for (const headline of headlines) {
    const key = JSON.stringify(headline.sources.map((source) => source.name || source.url).sort());
    const list = blocks.get(key) ?? [];
    list.push(headline);
    blocks.set(key, list);
  }
  return [...blocks.values()].map((group) => ({ texts: group.map(textItem), outlets: outletsOf(group) }));
}

