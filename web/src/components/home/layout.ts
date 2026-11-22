/** Pure glue between the home page model and the column layout engine (no Astro, no DOM). */
import {
  type BoxInput,
  type BoxItemInput,
  type BoxStyles,
  type ListStyles,
  type TileItem,
  boxStyles,
  layoutAll,
  layoutBoxAll,
  listStyles,
} from "../../layout";
import type { BoxContent, HomeEntry } from "../../model";

/** The tiles of a list of entries: an entry with an image takes the full row (image, then text beside it). */
export function entryItems(entries: readonly HomeEntry[]): TileItem[] {
  return entries.map((entry) => ({
    id: entry.storyId,
    kind: entry.image ? "fullRow" : "text",
    textLength: entry.length,
  }));
}

/** The inline styles (grid + one per entry, by story id) of a list of entries: portal entries, topics, tiles. */
export function entryListStyles(entries: readonly HomeEntry[]): ListStyles {
  return listStyles(layoutAll(entryItems(entries)));
}

/** Id of the i-th loose entry and of the i-th group of a box or group in its layout. */
export const entryId = (index: number): string => `e${index}`;
export const groupId = (index: number): string => `g${index}`;

/** What the layout engine needs to know about a group: summary, entries (shortest first), then sub-groups. */
function contentInput(content: BoxContent): BoxInput {
  const items: BoxItemInput[] = [
    ...content.entries.map((entry, i) => ({ id: entryId(i), textLength: entry.length })),
    ...content.groups.map((group, i) => ({ id: groupId(i), group: contentInput(group) })),
  ];
  return { summary: content.summary !== null, image: content.image !== null, items };
}

/** The layout input of a box; `image` says the unit has one to place. */
export function boxInput(box: BoxContent, image: boolean): BoxInput {
  return { ...contentInput(box), image };
}

/** All the inline styles of a box and of the groups in it (see `entryId` / `groupId` for the keys). */
export function boxLayoutStyles(box: BoxContent, image: boolean): BoxStyles {
  return boxStyles(layoutBoxAll(boxInput(box, image)));
}

/** Inline HTML of an entry for the home page: the entry itself is the link, so links inside it are dropped. */
export function withoutLinks(html: string): string {
  return html.replace(/<a\b[^>]*>/gi, "").replace(/<\/a>/gi, "");
}

/** The id of a day's heading, for `aria-labelledby`. */
export function dayHeadingId(day: string): string {
  return `day-${day}`;
}

/** Title attribute of an image: where it comes from. */
export function imageTitle(source: string): string | undefined {
  return source ? `Image: ${source}` : undefined;
}
