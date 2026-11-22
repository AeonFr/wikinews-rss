import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BREAKPOINTS_REM,
  boxStyles,
  gridStyle,
  joinStyles,
  layoutAll,
  layoutBoxAll,
  listStyles,
  placementStyle,
  type BoxInput,
  type Placement,
  type TileItem,
} from "./index";

const css = readFileSync(new URL("./tiles.module.css", import.meta.url), "utf8");

const p = (over: Partial<Placement>): Placement => ({
  id: "x",
  row: 1,
  colStart: 1,
  span: 1,
  rowSpan: 1,
  order: 0,
  hidden: false,
  ...over,
});

/** What the browser would do: pick the variables of the breakpoint and read them as grid-row / grid-column. */
function resolve(style: string, n: 1 | 2 | 3): { gridRow: string; gridColumn: string; display?: string } {
  const vars = new Map(style.split(";").map((d) => d.split(":") as [string, string]));
  return {
    gridRow: vars.get(`--r${n}`)!.replace("/", " / "),
    gridColumn: vars.get(`--c${n}`)!.replace("/", " / "),
    display: vars.get(`--h${n}`),
  };
}

describe("placementStyle", () => {
  it("writes row and column per breakpoint", () => {
    const style = placementStyle({
      1: p({ row: 3 }),
      2: p({ row: 2, colStart: 2 }),
      3: p({ row: 1, colStart: 2, span: 2 }),
    });
    expect(style).toBe("--r1:3;--c1:1;--r2:2;--c2:2;--r3:1;--c3:2/span 2");
  });

  it("writes row spans (the summary column)", () => {
    const style = placementStyle({ 1: p({}), 2: p({ rowSpan: 3 }), 3: p({ rowSpan: 2 }) });
    expect(style).toContain("--r2:1/span 3");
    expect(style).toContain("--r3:1/span 2");
  });

  it("marks only the breakpoints where the tile is hidden", () => {
    const style = placementStyle({ 1: p({}), 2: p({ hidden: true }), 3: p({ hidden: true }) });
    expect(style).toBe("--r1:1;--c1:1;--r2:auto;--c2:auto;--h2:none;--r3:auto;--c3:auto;--h3:none");
    expect(style).not.toContain("--h1");
  });
});

describe("gridStyle", () => {
  it("is empty for the page's own 1, 2, 3 columns", () => {
    expect(gridStyle({ 1: { cols: 1 }, 2: { cols: 2 }, 3: { cols: 3 } })).toBe("");
  });
  it("gives the columns of a grid inside a box with a summary", () => {
    expect(gridStyle({ 1: { cols: 1 }, 2: { cols: 1 }, 3: { cols: 2 } })).toBe("--k1:1;--k2:1;--k3:2");
  });
});

describe("joinStyles", () => {
  it("joins the non-empty styles", () => {
    expect(joinStyles("--r1:1", "", null, undefined, "--k1:1")).toBe("--r1:1;--k1:1");
    expect(joinStyles("", null)).toBe("");
  });
});

describe("listStyles", () => {
  const items: TileItem[] = [
    { id: "a", textLength: 100 },
    { id: "b", textLength: 300 },
    { id: "c", textLength: 100 },
  ];

  it("emits, for every tile, the placement the layout computed at each breakpoint", () => {
    const layouts = layoutAll(items);
    const { grid, cells } = listStyles(layouts);
    expect(grid).toBe("");
    for (const id of ["a", "b", "c"]) {
      for (const n of [1, 2, 3] as const) {
        const placement = layouts[n].placements.find((q) => q.id === id)!;
        const resolved = resolve(cells[id]!, n);
        expect(resolved.gridRow).toBe(String(placement.row));
        expect(resolved.gridColumn).toBe(placement.span > 1 ? `${placement.colStart} / span ${placement.span}` : String(placement.colStart));
      }
    }
    expect(cells.b).toBe("--r1:2;--c1:1;--r2:2;--c2:1/span 2;--r3:1;--c3:1/span 2;--t1:0;--t2:0;--t3:1");
  });

  it("flags, per breakpoint, the tiles that start in the first row (--tN)", () => {
    const layouts = layoutAll(items);
    const { cells } = listStyles(layouts);
    const flag = (id: string, n: 1 | 2 | 3) => cells[id]!.match(new RegExp(`--t${n}:(\\d)`))![1];
    for (const n of [1, 2, 3] as const) {
      for (const q of layouts[n].placements) expect(flag(q.id, n), `${q.id} at ${n}`).toBe(q.row === 1 ? "1" : "0");
    }
    // one column: only the first tile; three columns: a and b share the first row
    expect(["a", "b", "c"].map((id) => flag(id, 1))).toEqual(["1", "0", "0"]);
    expect(["a", "b", "c"].map((id) => flag(id, 3))).toEqual(["1", "1", "0"]);
  });
});

describe("boxStyles", () => {
  const input: BoxInput = {
    summary: true,
    image: true,
    items: [
      { id: "a", textLength: 100 },
      { id: "grp", group: { summary: true, items: [{ id: "x", textLength: 100 }, { id: "y", textLength: 100 }] } },
    ],
  };
  const styles = boxStyles(layoutBoxAll(input));

  it("has a style for the summary, the image, every entry and every group", () => {
    expect(styles.summary).toBe("--r1:2;--c1:1;--r2:1/span 3;--c2:1;--r3:1/span 2;--c3:1");
    expect(styles.image).toBe("--r1:1;--c1:1;--r2:1;--c2:2;--r3:1;--c3:2");
    expect(Object.keys(styles.items)).toEqual(["a", "grp"]);
    expect(Object.keys(styles.groups)).toEqual(["grp"]);
  });

  it("gives the box's grid the page's columns and a group the columns of the entries area", () => {
    expect(styles.grid).toBe("");
    expect(styles.groups.grp!.grid).toBe("--k1:1;--k2:1;--k3:2");
    expect(styles.groups.grp!.summary).not.toBeNull();
    expect(Object.keys(styles.groups.grp!.items)).toEqual(["x", "y"]);
  });

  it("has no summary or image style when the box has none", () => {
    const plain = boxStyles(layoutBoxAll({ items: [{ id: "a", textLength: 10 }] }));
    expect(plain.summary).toBeNull();
    expect(plain.image).toBeNull();
  });

  it("marks a hidden image at the breakpoints where it is left out", () => {
    const hidden = boxStyles(layoutBoxAll({ image: true, items: [{ id: "a", textLength: 200 }] }));
    // 1 column: shown; 2 and 3 columns without a summary: a long text beside it makes it full width
    expect(hidden.image).toBe("--r1:1;--c1:1;--r2:auto;--c2:auto;--h2:none;--r3:auto;--c3:auto;--h3:none");
  });
});

describe("tiles.module.css", () => {
  it("reads every variable the serialisation emits, at the matching breakpoint", () => {
    const base = css.split("@media")[0]!;
    expect(base).toContain("grid-row: var(--r1)");
    expect(base).toContain("grid-column: var(--c1)");
    expect(base).toContain("repeat(var(--k1)");
    expect(base).toContain("var(--h1, block)");
    for (const [n, rem] of [
      [2, BREAKPOINTS_REM.two],
      [3, BREAKPOINTS_REM.three],
    ] as const) {
      const block = css.split(`@media (min-width: ${rem}rem)`)[1]!;
      expect(block, `${rem}rem`).toContain(`grid-row: var(--r${n})`);
      expect(block).toContain(`grid-column: var(--c${n})`);
      expect(block).toContain(`repeat(var(--k${n})`);
      expect(block).toContain(`var(--h${n}, block)`);
    }
  });

  it("picks --tN (first row) into --top at the matching breakpoint", () => {
    expect(css.split("@media")[0]).toContain("--top: var(--t1)");
    expect(css.split(`@media (min-width: ${BREAKPOINTS_REM.two}rem)`)[1]).toContain("--top: var(--t2)");
    expect(css.split(`@media (min-width: ${BREAKPOINTS_REM.three}rem)`)[1]).toContain("--top: var(--t3)");
  });

  it("defaults the page's own grid to 1, 2 and 3 columns", () => {
    expect(css).toMatch(/--k1: 1;\s*--k2: 2;\s*--k3: 3;/);
  });
});
