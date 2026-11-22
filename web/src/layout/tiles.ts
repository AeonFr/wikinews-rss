import {
  PAGE_THRESHOLDS,
  responsive,
  type Cols,
  type GridLayout,
  type Placement,
  type Responsive,
  type Thresholds,
} from "./types";

export type SizeClass = "short" | "flex" | "long";

/** Short: at most `shortMax` characters; long: at least `longMin`; anything in between is flex. */
export function sizeClass(textLength: number, thresholds: Thresholds = PAGE_THRESHOLDS): SizeClass {
  if (textLength <= thresholds.shortMax) return "short";
  if (textLength >= thresholds.longMin) return "long";
  return "flex";
}

/**
 * What a tile is:
 * - `text`: sized by `textLength` (short and flex need one column, long needs two, at most `cols`);
 * - `image`: a standalone image, one column wide, first in its row and the last to grow;
 * - `fullRow`: takes a whole row (a grouped box, a sub-group, a portal entry with an image).
 */
export type TileKind = "text" | "image" | "fullRow";

export interface TileItem {
  /** Unique within the list. */
  id: string;
  /** Default `text`. */
  kind?: TileKind;
  /** Characters of the visible text. Only needed for `text` tiles (a long text in a row decides who grows). */
  textLength?: number;
}

export interface TileOptions {
  /** Default `PAGE_THRESHOLDS`; use `BOX_THRESHOLDS` inside boxes and groups. */
  thresholds?: Thresholds;
}

interface Slot {
  item: TileItem;
  kind: TileKind;
  length: number;
  size: SizeClass;
  span: number;
  index: number;
}

interface Row {
  used: number;
  slots: Slot[];
}

/** Sort key for the visual order of placements. */
export function assignOrder(placements: Placement[]): void {
  const visible = placements
    .filter((p) => !p.hidden)
    .sort((a, b) => a.row - b.row || a.colStart - b.colStart);
  visible.forEach((p, i) => (p.order = i));
}

/**
 * Places the tiles of a list in a grid of `cols` columns (any number of columns >= 1).
 *
 * 1. Each tile goes to the first row with room for it, so short tiles fill the gaps wide ones leave.
 * 2. With 3 columns, a last row holding one tile after a row of three one-column text tiles takes the last
 *    tile of that row (it would otherwise be stretched over the whole width).
 * 3. Per row: the first flex tile widens by one if the row has a gap; whatever is left goes to the tile with
 *    the longest text (an image is the last to grow). No row ends up with an empty column.
 * 4. Within a row the image comes first, then wider tiles first (otherwise in input order).
 *
 * With one column everything is stacked: no spans.
 */
export function layoutTiles(items: readonly TileItem[], cols: number, options: TileOptions = {}): GridLayout {
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError(`cols must be a positive integer, got ${cols}`);
  const thresholds = options.thresholds ?? PAGE_THRESHOLDS;
  const ids = new Set<string>();
  const slots: Slot[] = items.map((item, index) => {
    if (ids.has(item.id)) throw new Error(`duplicate tile id "${item.id}"`);
    ids.add(item.id);
    const kind = item.kind ?? "text";
    const length = item.textLength ?? 0;
    return { item, kind, length, size: sizeClass(length, thresholds), span: 1, index };
  });

  const need = (slot: Slot): number => {
    if (slot.kind === "fullRow") return cols;
    if (slot.kind === "text" && slot.size === "long") return Math.min(2, cols);
    return 1;
  };

  // 1. First row with room.
  const rows: Row[] = [];
  for (const slot of slots) {
    slot.span = need(slot);
    let row = rows.find((r) => cols - r.used >= slot.span);
    if (!row) {
      row = { used: 0, slots: [] };
      rows.push(row);
    }
    row.used += slot.span;
    row.slots.push(slot);
  }

  // 2. A lone tile after a row of three one-column tiles: the row before gives it a companion.
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  if (
    cols === 3 &&
    last &&
    before &&
    last.slots.length === 1 &&
    last.slots[0]!.kind !== "fullRow" &&
    before.slots.length === 3 &&
    before.slots.every((s) => s.kind === "text" && s.span === 1)
  ) {
    last.slots.unshift(before.slots.pop()!);
    before.used--;
    last.used++;
  }

  // 3 and 4. Fill the rows, then order them.
  for (const row of rows) {
    if (row.used < cols) {
      const flex = row.slots.find((s) => s.kind === "text" && s.size === "flex");
      if (flex) {
        flex.span++;
        row.used++;
      }
    }
    if (row.used < cols) {
      const growing = row.slots.filter((s) => s.kind !== "image");
      const candidates = growing.length ? growing : row.slots;
      let longest = candidates[0]!;
      for (const s of candidates) if (s.length > longest.length) longest = s;
      longest.span += cols - row.used;
      row.used = cols;
    }
    row.slots.sort((a, b) => Number(b.kind === "image") - Number(a.kind === "image") || b.span - a.span);
  }

  const byId = new Map<string, Placement>();
  rows.forEach((row, r) => {
    let col = 1;
    for (const slot of row.slots) {
      byId.set(slot.item.id, {
        id: slot.item.id,
        row: r + 1,
        colStart: col,
        span: slot.span,
        rowSpan: 1,
        order: 0,
        hidden: false,
      });
      col += slot.span;
    }
  });
  const placements = items.map((item) => byId.get(item.id)!);
  assignOrder(placements);
  return { cols, rows: rows.length, placements };
}

/** The layouts of a list for 1, 2 and 3 columns. */
export function layoutAll(items: readonly TileItem[], options: TileOptions = {}): Responsive<GridLayout> {
  return responsive((cols: Cols) => layoutTiles(items, cols, options));
}
