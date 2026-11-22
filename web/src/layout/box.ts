import { assignOrder, layoutTiles, type TileItem, type TileKind } from "./tiles";
import {
  BOX_THRESHOLDS,
  IMAGE_BESIDE_MAX,
  responsive,
  type Cols,
  type Placement,
  type Responsive,
  type Thresholds,
} from "./types";

/** A text entry of a box or group. */
export interface BoxEntryInput {
  id: string;
  textLength: number;
}

/** A sub-group of a box or group: a full row of its own, with its own grid. */
export interface BoxGroupInput {
  id: string;
  group: BoxInput;
}

export type BoxItemInput = BoxEntryInput | BoxGroupInput;

/** A grouped box, or a group inside one (same rules, one level further down). */
export interface BoxInput {
  /** Has a summary ("About the article") column. */
  summary?: boolean;
  /** Has an image (boxes only). */
  image?: boolean;
  /** Loose entries first, then sub-groups: the order in which they are packed. */
  items: readonly BoxItemInput[];
}

export interface BoxOptions {
  /** Default `BOX_THRESHOLDS`. */
  thresholds?: Thresholds;
}

export interface BoxLayout {
  /** Columns of the box's own grid. */
  cols: number;
  /** Columns of the entries area: `cols - 1` when there is a summary column (and `cols > 1`), else `cols`. */
  entryCols: number;
  /** Rows of the grid. */
  rows: number;
  /** The summary column (null: none). Spans every row of the entries; stacked (1 column) it is a row of its own. */
  summary: Placement | null;
  /** The image (null: none). `hidden` when it would take all columns of the box. */
  image: Placement | null;
  /** Entries and sub-groups, in input order; `colStart` counts from the box's first column (summary included). */
  items: Placement[];
  /** The layout inside each sub-group, by id (its grid has `entryCols` columns). */
  groups: Record<string, BoxLayout>;
}

const IMAGE = "\u0000image";

function isGroup(item: BoxItemInput): item is BoxGroupInput {
  return "group" in item;
}

/**
 * Lays out a box (or a group) with `cols` columns.
 *
 * - With a summary column and more than one column, the entries use the columns after it and the summary spans all
 *   their rows. With one column everything is stacked: image, summary, then the entries.
 * - The image is one column wide and first in its row. If a text longer than 170 characters ends up beside it, it
 *   takes the whole entries area on its own row and the texts go below. If it then spans all the columns of the box
 *   (3 of 3, or both of a 2 column box) it is hidden (`image.hidden`) and the rows are laid out without it.
 */
export function layoutBox(box: BoxInput, cols: number, options: BoxOptions = {}): BoxLayout {
  const thresholds = options.thresholds ?? BOX_THRESHOLDS;
  const hasSummary = !!box.summary;
  const hasImage = !!box.image;
  const textLength = new Map<string, number>();
  const tiles: TileItem[] = box.items.map((item) => {
    if (isGroup(item)) return { id: item.id, kind: "fullRow" };
    textLength.set(item.id, item.textLength);
    return { id: item.id, kind: "text", textLength: item.textLength };
  });

  const entryCols = cols > 1 && hasSummary ? cols - 1 : cols;
  const offset = cols - entryCols;
  const withImage = (kind: TileKind): TileItem[] => [{ id: IMAGE, kind }, ...tiles];

  let layout = layoutTiles(hasImage ? withImage("image") : tiles, entryCols, { thresholds });
  let imageHidden = false;
  if (hasImage && entryCols > 1) {
    // A long text beside the image: the image takes the whole entries area, the texts go below.
    const image = layout.placements[0]!;
    const crowded = layout.placements.some(
      (p) => p.id !== IMAGE && p.row === image.row && (textLength.get(p.id) ?? 0) > IMAGE_BESIDE_MAX,
    );
    if (crowded) layout = layoutTiles(withImage("fullRow"), entryCols, { thresholds });
  }
  if (hasImage && cols > 1 && layout.placements[0]!.span >= cols) {
    // It would take every column of the box: leave it out.
    imageHidden = true;
    layout = layoutTiles(tiles, entryCols, { thresholds });
  }

  const items = hasImage && !imageHidden ? layout.placements.slice(1) : layout.placements;
  let image: Placement | null = null;
  if (hasImage) image = imageHidden ? hiddenPlacement(IMAGE) : layout.placements[0]!;
  let summary: Placement | null = null;
  let rows = layout.rows;

  if (cols === 1) {
    // Stacked: image, summary, entries. The rows are the stacking order.
    if (hasSummary) {
      const summaryRow = hasImage ? 2 : 1;
      for (const p of items) if (p.row >= summaryRow) p.row++;
      summary = place("summary", summaryRow, 1, 1, 1);
      rows++;
    }
  } else {
    for (const p of items) p.colStart += offset;
    if (image && !image.hidden) image.colStart += offset;
    if (hasSummary) summary = place("summary", 1, 1, 1, Math.max(1, layout.rows));
  }

  assignOrder([...(summary ? [summary] : []), ...(image ? [image] : []), ...items]);

  const groups: Record<string, BoxLayout> = {};
  for (const item of box.items) {
    if (isGroup(item)) groups[item.id] = layoutBox(item.group, entryCols, options);
  }
  return { cols, entryCols, rows, summary, image, items, groups };
}

function place(id: string, row: number, colStart: number, span: number, rowSpan: number): Placement {
  return { id, row, colStart, span, rowSpan, order: 0, hidden: false };
}

function hiddenPlacement(id: string): Placement {
  return { id, row: 1, colStart: 1, span: 1, rowSpan: 1, order: -1, hidden: true };
}

/** `layoutBox` for 1, 2 and 3 columns. */
export function layoutBoxAll(box: BoxInput, options: BoxOptions = {}): Responsive<BoxLayout> {
  return responsive((cols: Cols) => layoutBox(box, cols, options));
}
