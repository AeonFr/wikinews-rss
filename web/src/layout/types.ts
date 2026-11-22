/** Shared types and constants of the column layout engine. See README.md. */

/** The numbers of columns the page can have: one per breakpoint. */
export type Cols = 1 | 2 | 3;

export const COLUMN_COUNTS: readonly Cols[] = [1, 2, 3];

/** Widths (rem) at which the page goes to 2 and to 3 columns. Mirrored in `tiles.module.css`. */
export const BREAKPOINTS_REM = { two: 40, three: 62 } as const;

/** One value per number of columns: `{ 1: ..., 2: ..., 3: ... }`. */
export type Responsive<T> = Record<Cols, T>;

export function responsive<T>(build: (cols: Cols) => T): Responsive<T> {
  return { 1: build(1), 2: build(2), 3: build(3) };
}

/** Text lengths (characters) at which a tile counts as short or long; in between it is "flex". */
export interface Thresholds {
  /** A text of at most this many characters is short. */
  shortMax: number;
  /** A text of at least this many characters is long. */
  longMin: number;
}

/** Tiles of the page: single-article tiles, portal entries, topics. */
export const PAGE_THRESHOLDS: Thresholds = { shortMax: 149, longMin: 225 };

/** Entries inside a grouped box or a group: higher, their columns are narrower and the texts longer. */
export const BOX_THRESHOLDS: Thresholds = { shortMax: 280, longMin: 500 };

/** A text longer than this (characters) does not sit next to a box image: the image gets its own row. */
export const IMAGE_BESIDE_MAX = 170;

/** Where a tile sits in a grid. Rows and columns are 1-based, as in CSS grid lines. */
export interface Placement {
  id: string;
  row: number;
  colStart: number;
  /** Number of columns the tile spans (always 1 in a single column grid). */
  span: number;
  /** Number of rows it spans (more than 1 only for a box's summary column). */
  rowSpan: number;
  /** Rank in the visual order (by row, then column); -1 for a hidden tile. */
  order: number;
  /** The tile is not shown at this number of columns (a box image that would take the whole box). */
  hidden: boolean;
}

/** The layout of one grid for one number of columns. `placements` are in the order of the input items. */
export interface GridLayout {
  /** Columns of the grid (the number of columns of the grid container). */
  cols: number;
  /** Rows used. */
  rows: number;
  placements: Placement[];
}
