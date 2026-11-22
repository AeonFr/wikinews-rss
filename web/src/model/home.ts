/** The home page: topics, then per day the portal entries, the grouped boxes and the single-article tiles. */
import { groupByDay } from "../data/days";
import type { NewsData, Story } from "../data/types";
import { type Box, buildBox } from "./box";
import { type ModelImage, type TextItem, storyHref, storyImage, textItem } from "./entry";

/** Days shown on the home page, counted back from the `updated` day. */
export const HOME_DAYS = 30;

/**
 * A story shown as one block of text: a portal entry, a topic or a single-article tile. A portal entry
 * may hold several `items` (entries without an article); the others hold one.
 */
export interface HomeEntry {
  storyId: string;
  /** Path of the story's article page. */
  href: string;
  /** Small label above the text: the article's title, or the category for an entry without an article (null: none). */
  label: string | null;
  items: TextItem[];
  /** Characters of all the texts (joined by a space), for the layout. */
  length: number;
  /** The story's image, if it has one (the generator gives images to portal entries and boxes only). */
  image: ModelImage | null;
}

export interface HomeDay {
  /** UTC day, "2026-11-21". */
  day: string;
  /** Entries with no article, larger text; with an image first. */
  portalEntries: HomeEntry[];
  /** Units with several entries; with an image first. */
  boxes: Box[];
  /** Units with one entry about an article. */
  tiles: HomeEntry[];
}

export interface Home {
  /** "Topics in the news": the topics the portal still highlights. */
  topics: HomeEntry[];
  /** Newest day first. */
  days: HomeDay[];
}

/** A unit (the stories of one group on a day) is a single entry when it is one story with one entry or no article. */
export function isSingleUnit(stories: Story[]): boolean {
  return stories.length === 1 && (stories[0].headlines.length === 1 || !stories[0].article);
}

function toEntry(story: Story, label: string | null): HomeEntry {
  const items = story.headlines.map(textItem);
  const href = storyHref(story);
  return {
    storyId: story.id,
    href,
    label,
    items,
    length: items.map((item) => item.text).join(" ").length,
    image: storyImage(story, href),
  };
}

/** The stories of a day in units: the stories sharing a group, in order of first appearance. */
export function unitsOf(stories: Story[]): Story[][] {
  const units = new Map<string, Story[]>();
  for (const story of stories) {
    const key = story.group || story.id;
    const unit = units.get(key);
    if (unit) unit.push(story);
    else units.set(key, [story]);
  }
  return [...units.values()];
}

/** Moves the items with an image first, keeping the order otherwise. */
function imagesFirst<T>(items: T[], hasImage: (item: T) => boolean): T[] {
  return [...items.filter(hasImage), ...items.filter((item) => !hasImage(item))];
}

function buildDay(day: string, stories: Story[]): HomeDay {
  const portalEntries: HomeEntry[] = [];
  const boxes: Box[] = [];
  const tiles: HomeEntry[] = [];
  for (const unit of unitsOf(stories)) {
    if (!isSingleUnit(unit)) boxes.push(buildBox(unit));
    else if (unit[0].article) tiles.push(toEntry(unit[0], unit[0].article.title));
    else portalEntries.push(toEntry(unit[0], unit[0].categories[0] ?? null));
  }
  return {
    day,
    portalEntries: imagesFirst(portalEntries, (entry) => entry.image !== null),
    boxes: imagesFirst(boxes, (box) => box.image !== null),
    tiles,
  };
}

/** The topics still highlighted on the portal, as entries labelled with their article. */
export function buildTopics(news: NewsData): HomeEntry[] {
  return news.stories
    .filter((story) => story.kind === "topic" && !story.retired)
    .map((story) => toEntry(story, story.article?.title ?? null));
}

/** The whole home page. */
export function buildHome(news: NewsData, days = HOME_DAYS): Home {
  return {
    topics: buildTopics(news),
    days: groupByDay(news.stories, news.updated, days).map(({ day, stories }) => buildDay(day, stories)),
  };
}
