/** Shapes of data/news.json and data/sources.json (written by wikipedia_rss/site.py). */

/** Static map from the article's infobox: an image of https://maps.wikimedia.org/, hotlinked. */
export interface ArticleMap {
  url: string;
  /** The same image at twice the resolution (for `srcset`). */
  url2x?: string;
  /** Size in pixels of `url`. */
  width: number;
  height: number;
}

export interface ArticleRef {
  title: string;
  url: string;
  /** Wikipedia's summary of the article. */
  extract?: string;
  /** "Location" row of the article's infobox (plain text). Only on a story's own `article`. */
  location?: string;
  /** Map of the article's infobox. Only on a story's own `article`. */
  map?: ArticleMap;
}

export interface Source {
  name: string;
  url: string;
}

/** A topic line above an entry. `url` is null when the line links no article. */
export interface HeadlineTopic {
  label: string;
  url: string | null;
  /** Every article linked on the line, `url` among them. */
  links?: { label: string; url: string }[];
}

/** One entry of the portal. `html` is inline HTML: only <a href>, <i> and <b>. */
export interface Headline {
  id: string;
  html: string;
  category: string;
  sources: Source[];
  /** The nested topic lines above the entry, outermost first. */
  topics: HeadlineTopic[];
  page: { title: string; url: string; history_url: string };
}

export interface StoryImage {
  url: string;
  /** Name of the outlet the image comes from. */
  source: string;
  /** Page of the source it comes from. */
  link: string;
}

export interface Story {
  id: string;
  /** Id shared by the stories nested under one top-level article of a day. */
  group: string;
  title: string;
  /** ISO UTC, e.g. "2026-11-21T18:49:53Z". */
  pub_date: string;
  categories: string[];
  /** The top-level article of the group; null for an entry straight from the portal. */
  article: ArticleRef | null;
  more_articles: ArticleRef[];
  headlines: Headline[];
  image?: StoryImage;
  /** "Topics in the news" item. */
  kind?: "topic";
  /** Retired topics keep their page but are not listed. */
  retired?: true;
}

export interface NewsData {
  /** ISO UTC. */
  updated: string;
  retention_days: number;
  portal: { title: string; url: string };
  /** Newest first. */
  stories: Story[];
}

/** Link preview of a cited source (data/sources.json); any field may be missing. */
export interface SourcePreview {
  title: string;
  description?: string;
  image?: string;
  site?: string;
}

/** Previews by source URL. */
export type SourcePreviews = Record<string, SourcePreview>;

export interface SourcesData {
  sources: SourcePreviews;
}
