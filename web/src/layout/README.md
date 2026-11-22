# Column layout (build time)

The home page has no JavaScript, so where each tile goes is computed **at build time for 1, 2 and 3
columns**, written on each tile as CSS custom properties, and the browser picks the set that matches its
width with media queries (`< 40rem`: 1 column, `>= 40rem`: 2, `>= 62rem`: 3). The rules are those of
`docs/site-spec.md` section 5. Everything here is pure TypeScript (no Astro, no DOM).

```
types.ts        Cols, Responsive<T>, Placement, GridLayout, thresholds
tiles.ts        layoutTiles(items, cols), layoutAll(items)         lists of tiles
box.ts          layoutBox(box, cols), layoutBoxAll(box)            grouped boxes and groups
style.ts        listStyles(), boxStyles(), placementStyle(), gridStyle()   -> inline `style` strings
tiles.module.css  the CSS that reads the variables
index.ts        re-exports everything: `import { ... } from "../layout"`
```

## 1. A list of tiles (single tiles, portal entries, topics, a day's boxes)

```ts
import { layoutAll, listStyles } from "../layout";

const items = stories.map((s) => ({ id: s.id, textLength: plain.length }));   // kind: "text" (default)
const { grid, cells } = listStyles(layoutAll(items));
```

```astro
---
import tiles from "../layout/tiles.module.css";
---
<ul class={tiles.grid} style={grid}>
  {stories.map((s) => <li class={tiles.cell} style={cells[s.id]}>...</li>)}
</ul>
```

`TileItem` is `{ id, kind?, textLength? }`:

| `kind`      | for                                                                                   | needs |
| ----------- | ------------------------------------------------------------------------------------- | ----- |
| `"text"` (default) | an entry/tile with text; `textLength` in characters, short <= 149, long >= 225 | 1 column (long: 2, at most `cols`) |
| `"fullRow"` | a grouped box, a sub-group, **a portal entry/topic that has an image**                | every column |
| `"image"`   | a standalone image tile (one column, first in its row, last to grow)                  | 1 column |

A portal entry with an image is a `fullRow` item; inside it use the `withImage` classes (image is the
first column, text the other columns, stacked under 40rem):

```astro
<div class={`${tiles.cell} ${tiles.withImage}`} style={cells[s.id]}>
  <a class={tiles.withImageImage}><img ...></a>
  <div class={tiles.withImageText}>...</div>
</div>
```

Pass `{ thresholds: BOX_THRESHOLDS }` (short <= 280, long >= 500) to `layoutAll` for a list that is not a box
but has the narrower-column thresholds (boxes do it themselves).

`layoutAll(items)` returns `{ 1: GridLayout, 2: GridLayout, 3: GridLayout }`; a `GridLayout` is
`{ cols, rows, placements }` and a `Placement` is `{ id, row, colStart, span, rowSpan, order, hidden }`
(1-based grid lines; `placements` are in input order; `order` is the visual rank, -1 if hidden).
Use these directly if you need the numbers (tests, a summary row count...).

## 2. A grouped box

```ts
import { layoutBoxAll, boxStyles, joinStyles, type BoxInput } from "../layout";

const input: BoxInput = {
  summary: true,                       // has an "About the article" column
  image: true,                         // the unit has an image
  items: [                             // loose entries first (shortest first), then the sub-groups
    { id: "e1", textLength: 120 },
    { id: "e2", textLength: 340 },
    { id: "g1", group: { summary: true, items: [{ id: "e3", textLength: 90 }, { id: "e4", textLength: 150 }] } },
  ],
};
const styles = boxStyles(layoutBoxAll(input));
// styles = { grid, summary, image, items: { e1, e2, g1 }, groups: { g1: { grid, summary, image, items: { e3, e4 }, groups } } }
```

```astro
<div class={tiles.grid} style={styles.grid}>              <!-- the box's own grid: the page's 1, 2, 3 columns -->
  {styles.summary && <div class={tiles.cell} style={styles.summary}>About the article...</div>}
  {styles.image && <a class={`${tiles.cell} ${tiles.hideable}`} style={styles.image}><img ...></a>}
  <p class={tiles.cell} style={styles.items.e1}>...</p>
  <p class={tiles.cell} style={styles.items.e2}>...</p>
  <!-- a sub-group is a cell of the box AND a grid of its own -->
  <div class={`${tiles.cell} ${tiles.grid}`} style={joinStyles(styles.items.g1, styles.groups.g1.grid)}>
    {styles.groups.g1.summary && <div class={tiles.cell} style={styles.groups.g1.summary}>...</div>}
    <p class={tiles.cell} style={styles.groups.g1.items.e3}>...</p>
    <p class={tiles.cell} style={styles.groups.g1.items.e4}>...</p>
  </div>
</div>
```

Render the box's children in a sensible DOM order (title, image, summary, entries...); explicit
placement does the rest. Set `--gap-y` / `--gap-x` on a grid to change its gaps (default `1.75rem` /
`2.5rem`); give the box's grid its own gap in your component CSS if it differs (a group is tighter).
The group's `style` is two strings (its placement in the box, and its own `--k` column counts, which is empty
when they equal the page's): join them with `joinStyles(a, b)`.

What `layoutBox` does, at each number of columns (`cols`):

- **entries area**: `cols - 1` columns when there is a summary column (so 2 on desktop, 1 on 2 columns),
  else `cols`. `entryCols` in the result. The summary is column 1 and spans all the rows of the entries
  (`rowSpan`). Entries' `colStart` already includes the summary column.
- **sub-groups** are full-row items of the entries area. A group is its own grid with `entryCols` columns
  (its `cols`); inside it the same rules apply, with its own summary column if it has one. With 1 column
  everything is stacked and the group's summary is a row above its entries.
- **image**: one column, first in its row. If any text longer than 170 characters would sit beside it, it takes
  the whole entries area on its own row and the texts go below. If it then spans every column of the box (3 of 3,
  or both columns of a 2-column box) it is `hidden` at that number of columns (the rows are laid out without it;
  the `hideable` class turns that into `display: none`). It is never hidden stacked.
- **1 column**: no spans; rows are the stacking order `image, summary, entries...` (the image right under the
  title, above the summary).

The result for one number of columns is a `BoxLayout`:
`{ cols, entryCols, rows, summary, image, items, groups }` (`summary` / `image` are a `Placement` or null,
`items` placements in input order, `groups` the nested `BoxLayout` by id).

## 3. The CSS variable scheme

Per tile (set inline by the `*Styles` functions), for N = 1, 2, 3 columns:

| variable | meaning | example |
| -------- | ------- | ------- |
| `--rN`   | `grid-row` at N columns   | `2`, `1/span 3` (summary) |
| `--cN`   | `grid-column` at N columns | `1`, `2/span 2` |
| `--hN`   | only if hidden at N columns: `none` | `none` |

On a grid container, only when its column count is not the page's 1, 2, 3 (a group inside a box with a summary):
`--k1 --k2 --k3`, the number of columns at 1, 2 and 3 (`grid-template-columns: repeat(var(--kN), minmax(0, 1fr))`).
`tiles.module.css` defaults `--k1..3` to `1, 2, 3` on `.grid`, and uses

```css
.cell { grid-row: var(--r1); grid-column: var(--c1); }
@media (min-width: 40rem) { .cell { grid-row: var(--r2); grid-column: var(--c2); } }
@media (min-width: 62rem) { .cell { grid-row: var(--r3); grid-column: var(--c3); } }
```

Row and column are always explicit, so the visual order does not depend on the DOM order (and `order` is not
emitted). Hidden tiles are emitted as `--rN:auto;--cN:auto;--hN:none`. Classes of `tiles.module.css`:
`grid`, `cell`, `hideable` (with `cell`: honours `--hN`), `withImage` + `withImageImage` + `withImageText`.

### First row (`--t1 --t2 --t3`)

`listStyles` also writes `--tN` on every tile of a list: `1` if the tile starts in the list's **first row** at N
columns, else `0` (the first row is not the same set of tiles at 1, 2 and 3 columns). `tiles.module.css` turns it
into `--top` for the current width (`.cell { --top: var(--t1) }`, `--t2`/`--t3` in the media queries).

What it is for: every tile has a hairline on top (the column rule) and a day heading or the Topics banner has its own
rule above the list; a first row would show two lines with an empty gap between them. A list that sits right under
such a heading gets the `first` class (`EntryList`, `BoxList`), and then
`padding-top: calc(var(--pad) * (1 - var(--top)))` and `border-top-width: calc(var(--w-hair) * (1 - var(--top)))`
remove the line and the padding of just the tiles of the first row, at whichever width. Anywhere else (a list that
follows other content in the day: portal entries -> boxes -> tiles, any may be missing) the first row keeps its
line, which then is the only one between the two blocks. The heading's margin below it (`.block.first` in
`DaySection.module.css`) is the whole gap. Boxes are always one per row, so `BoxList` needs no flag: its first `li`
loses its line. Only lists get `--tN` (boxes' own items and groups do not need it).

Notes: custom properties inherit, so every direct child of a `.grid` must be styled (the functions emit a style for
every item). Items in a `.grid` must be its direct children. Gaps between touching boxes are the component's own CSS.
