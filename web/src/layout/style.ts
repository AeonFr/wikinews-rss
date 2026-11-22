import type { BoxLayout } from "./box";
import { COLUMN_COUNTS, type GridLayout, type Placement, type Responsive } from "./types";

/**
 * The CSS custom properties a placed tile carries, per number of columns N (1, 2, 3):
 *
 * - `--rN`: its `grid-row` ("2", or "1/span 3" for the summary column);
 * - `--cN`: its `grid-column` ("1", or "2/span 2");
 * - `--hN`: only when the tile is hidden at N columns: `none` (used as `display`).
 *
 * and a grid container carries `--kN`: its number of columns at N (omitted when it is the page's: 1, 2, 3).
 * `tiles.module.css` reads them.
 *
 * `listStyles` also writes `--tN` on the tiles of a list: `1` when the tile starts in the list's first row at N
 * columns, else `0`. The first row differs per breakpoint (one tile at 1 column, three at 3), so the build says
 * which tiles it holds; the CSS uses it to drop the rule above a first row that sits under a heading or rule.
 */
function line(start: number, span: number): string {
  return span > 1 ? `${start}/span ${span}` : String(start);
}

/** The declarations for one number of columns. */
function declarations(n: number, p: Placement): string {
  if (p.hidden) return `--r${n}:auto;--c${n}:auto;--h${n}:none`;
  return `--r${n}:${line(p.row, p.rowSpan)};--c${n}:${line(p.colStart, p.span)}`;
}

/** The inline `style` of a tile: its placement at 1, 2 and 3 columns. */
export function placementStyle(placements: Responsive<Placement>): string {
  return COLUMN_COUNTS.map((n) => declarations(n, placements[n])).join(";");
}

/** The inline `style` of a grid container: how many columns it has at 1, 2 and 3 columns ("" for 1, 2, 3). */
export function gridStyle(grids: Responsive<{ cols: number }>): string {
  if (COLUMN_COUNTS.every((n) => grids[n].cols === n)) return "";
  return COLUMN_COUNTS.map((n) => `--k${n}:${grids[n].cols}`).join(";");
}

/** Joins `style` strings (some may be empty or null): a sub-group is a cell of its box and a grid of its own. */
export function joinStyles(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(";");
}

export interface ListStyles {
  /** `style` of the grid container ("" when it has the page's own 1, 2, 3 columns). */
  grid: string;
  /** `style` of each tile, by id. */
  cells: Record<string, string>;
}

/** `--tN` for a tile: 1 when it starts in the first row at N columns (see the top of this file). */
export function firstRowStyle(placements: Responsive<Placement>): string {
  return COLUMN_COUNTS.map((n) => `--t${n}:${placements[n].row === 1 ? 1 : 0}`).join(";");
}

/** The inline styles for a list laid out with `layoutAll`. */
export function listStyles(layouts: Responsive<GridLayout>): ListStyles {
  const cells: Record<string, string> = {};
  for (const p of layouts[1].placements) {
    const placements = { 1: p, 2: byId(layouts[2], p.id), 3: byId(layouts[3], p.id) };
    cells[p.id] = joinStyles(placementStyle(placements), firstRowStyle(placements));
  }
  return { grid: gridStyle(layouts), cells };
}

export interface BoxStyles {
  /** `style` of the box's (or group's) grid container. */
  grid: string;
  /** `style` of the summary column, or null if the box has none. */
  summary: string | null;
  /** `style` of the image, or null if the box has none. */
  image: string | null;
  /** `style` of each entry and sub-group, by id. */
  items: Record<string, string>;
  /** The styles inside each sub-group, by id. */
  groups: Record<string, BoxStyles>;
}

/** The inline styles for a box laid out with `layoutBoxAll`. */
export function boxStyles(layouts: Responsive<BoxLayout>): BoxStyles {
  const items: Record<string, string> = {};
  for (const p of layouts[1].items) {
    items[p.id] = placementStyle({ 1: p, 2: byId(layouts[2], p.id), 3: byId(layouts[3], p.id) });
  }
  const groups: Record<string, BoxStyles> = {};
  for (const id of Object.keys(layouts[1].groups)) {
    groups[id] = boxStyles({ 1: layouts[1].groups[id]!, 2: layouts[2].groups[id]!, 3: layouts[3].groups[id]! });
  }
  const optional = (pick: (l: BoxLayout) => Placement | null): string | null => {
    const first = pick(layouts[1]);
    if (!first) return null;
    return placementStyle({ 1: first, 2: pick(layouts[2])!, 3: pick(layouts[3])! });
  };
  return {
    grid: gridStyle(layouts),
    summary: optional((l) => l.summary),
    image: optional((l) => l.image),
    items,
    groups,
  };
}

function byId(layout: GridLayout | BoxLayout, id: string): Placement {
  const list = "items" in layout ? layout.items : layout.placements;
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`tile "${id}" missing from the ${layout.cols} column layout`);
  return found;
}
