import { describe, expect, it } from "vitest";
import { BOX_THRESHOLDS, layoutAll, layoutTiles, sizeClass, type GridLayout, type TileItem } from "./index";

const S = 100; // short on the page (<= 149)
const F = 180; // flex (150-224)
const L = 300; // long (>= 225)

const text = (id: string, textLength: number): TileItem => ({ id, textLength });
const box = (id: string): TileItem => ({ id, kind: "fullRow" });
const image = (id: string): TileItem => ({ id, kind: "image" });

/** "id:row.col+span" for each placement, in input order. */
function show(layout: GridLayout): string[] {
  return layout.placements.map((p) => `${p.id}:${p.row}.${p.colStart}+${p.span}`);
}

describe("sizeClass", () => {
  it("is short up to 149, long from 225, flex between", () => {
    expect([0, 149].map((n) => sizeClass(n))).toEqual(["short", "short"]);
    expect([150, 224].map((n) => sizeClass(n))).toEqual(["flex", "flex"]);
    expect([225, 1000].map((n) => sizeClass(n))).toEqual(["long", "long"]);
  });

  it("uses higher thresholds inside boxes: short up to 280, long from 500", () => {
    expect(sizeClass(280, BOX_THRESHOLDS)).toBe("short");
    expect(sizeClass(281, BOX_THRESHOLDS)).toBe("flex");
    expect(sizeClass(499, BOX_THRESHOLDS)).toBe("flex");
    expect(sizeClass(500, BOX_THRESHOLDS)).toBe("long");
  });
});

describe("layoutTiles: basics", () => {
  it("an empty list has no rows", () => {
    expect(layoutTiles([], 3)).toEqual({ cols: 3, rows: 0, placements: [] });
  });

  it("a single tile takes the whole row at any number of columns", () => {
    expect(show(layoutTiles([text("a", S)], 3))).toEqual(["a:1.1+3"]);
    expect(show(layoutTiles([text("a", S)], 2))).toEqual(["a:1.1+2"]);
    expect(show(layoutTiles([text("a", L)], 1))).toEqual(["a:1.1+1"]);
  });

  it("three short tiles fill one row of three", () => {
    expect(show(layoutTiles([text("a", S), text("b", S), text("c", S)], 3))).toEqual([
      "a:1.1+1",
      "b:1.2+1",
      "c:1.3+1",
    ]);
  });

  it("rejects bad input", () => {
    expect(() => layoutTiles([text("a", S), text("a", S)], 3)).toThrow(/duplicate/);
    expect(() => layoutTiles([], 0)).toThrow(RangeError);
    expect(() => layoutTiles([], 1.5)).toThrow(RangeError);
  });
});

describe("layoutTiles: one column", () => {
  it("stacks everything, without spans", () => {
    const items = [text("a", L), text("b", S), box("c"), image("d"), text("e", F)];
    expect(show(layoutTiles(items, 1))).toEqual(["a:1.1+1", "b:2.1+1", "c:3.1+1", "d:4.1+1", "e:5.1+1"]);
  });
});

describe("layoutTiles: sizes and packing", () => {
  it("a long tile needs two columns (at most the columns there are)", () => {
    expect(show(layoutTiles([text("a", L), text("b", S)], 3))).toEqual(["a:1.1+2", "b:1.3+1"]);
    expect(show(layoutTiles([text("a", L), text("b", S)], 2))).toEqual(["a:1.1+2", "b:2.1+2"]);
  });

  it("two long tiles do not share a row of three: each takes its own", () => {
    expect(show(layoutTiles([text("a", L), text("b", L)], 3))).toEqual(["a:1.1+3", "b:2.1+3"]);
  });

  it("a tile goes to the first row with room, so short tiles fill the gaps of wide ones", () => {
    const items = [text("a", L), text("b", L), text("c", S)];
    // a takes 2 of row 1; b does not fit in the 1 left, so it gets row 2; c fills row 1.
    expect(show(layoutTiles(items, 3))).toEqual(["a:1.1+2", "b:2.1+3", "c:1.3+1"]);
  });

  it("a flex tile widens by one to avoid a gap", () => {
    expect(show(layoutTiles([text("a", F), text("b", S)], 3))).toEqual(["a:1.1+2", "b:1.3+1"]);
  });

  it("only the first flex tile widens, even if another has the longer text", () => {
    expect(show(layoutTiles([text("a", 160), text("b", 200)], 3))).toEqual(["a:1.1+2", "b:1.3+1"]);
  });

  it("the leftover goes to the tile with the longest text (ties: the first)", () => {
    expect(show(layoutTiles([text("a", 100), text("b", 140)], 3))).toEqual(["a:1.3+1", "b:1.1+2"]);
    expect(show(layoutTiles([text("a", 120), text("b", 120)], 3))).toEqual(["a:1.1+2", "b:1.3+1"]);
  });

  it("no row ever has an empty column", () => {
    for (const cols of [2, 3]) {
      for (const n of [1, 2, 3, 4, 5, 6, 7]) {
        const layout = layoutTiles(Array.from({ length: n }, (_, i) => text(`t${i}`, 50 + i * 30)), cols);
        for (let r = 1; r <= layout.rows; r++) {
          const row = layout.placements.filter((p) => p.row === r);
          expect(row.reduce((sum, p) => sum + p.span, 0)).toBe(cols);
        }
      }
    }
  });

  it("orders each row: wider tiles first; of the same width the one with more text first, then input order", () => {
    expect(show(layoutTiles([text("a", S), text("b", L)], 3))).toEqual(["a:1.3+1", "b:1.1+2"]);
    expect(show(layoutTiles([text("a", S), text("b", S)], 2))).toEqual(["a:1.1+1", "b:1.2+1"]);
    // equal widths: the longer text goes first, whatever the input order
    expect(show(layoutTiles([text("a", 40), text("b", 90)], 2))).toEqual(["a:1.2+1", "b:1.1+1"]);
    expect(show(layoutTiles([text("a", 40), text("b", 60), text("c", 90)], 3))).toEqual(["a:1.3+1", "b:1.2+1", "c:1.1+1"]);
  });

  it("keeps the tile after an image beside it, whatever the lengths of the others", () => {
    // the image's own text (the first after it in the input) is short; the other text is longer but goes after it
    expect(show(layoutTiles([image("i"), text("mine", 40), text("other", 120)], 3, { thresholds: BOX_THRESHOLDS }))).toEqual([
      "i:1.1+1",
      "mine:1.2+1",
      "other:1.3+1",
    ]);
  });

  it("gives the visual rank in `order`", () => {
    const layout = layoutTiles([text("a", S), text("b", L), text("c", L)], 3);
    // row 1: b (cols 1-2), a (col 3); row 2: c
    expect(Object.fromEntries(layout.placements.map((p) => [p.id, p.order]))).toEqual({ a: 1, b: 0, c: 2 });
  });
});

describe("layoutTiles: full-row tiles (boxes, portal entries with an image)", () => {
  it("take every column and leave room for nothing else in their row", () => {
    const items = [text("a", S), box("b"), text("c", S)];
    // a and c share the first row; the box has a row of its own.
    expect(show(layoutTiles(items, 3))).toEqual(["a:1.1+2", "b:2.1+3", "c:1.3+1"]);
    expect(show(layoutTiles(items, 2))).toEqual(["a:1.1+1", "b:2.1+2", "c:1.2+1"]);
  });

  it("a portal entry with an image is a full-row tile: the component splits it 1 column image, rest text", () => {
    const layout = layoutTiles([box("portal"), text("a", S), text("b", S)], 3);
    expect(show(layout)).toEqual(["portal:1.1+3", "a:2.1+2", "b:2.3+1"]);
  });
});

describe("layoutTiles: three columns, lone last tile", () => {
  it("moves the last tile of a row of three down to join a lone last tile", () => {
    const items = [text("a", S), text("b", S), text("c", S), text("d", S)];
    // Without the rebalance: a b c / d stretched over 3. With it: two rows of two, a wide and a narrow tile each.
    expect(show(layoutTiles(items, 3))).toEqual(["a:1.1+2", "b:1.3+1", "c:2.1+2", "d:2.3+1"]);
  });

  it("also when the lone tile is long", () => {
    const items = [text("a", S), text("b", S), text("c", S), text("d", L)];
    expect(show(layoutTiles(items, 3))).toEqual(["a:1.1+2", "b:1.3+1", "c:2.3+1", "d:2.1+2"]);
  });

  it("does not happen with a box as the last tile", () => {
    const items = [text("a", S), text("b", S), text("c", S), box("d")];
    expect(show(layoutTiles(items, 3))).toEqual(["a:1.1+1", "b:1.2+1", "c:1.3+1", "d:2.1+3"]);
  });

  it("does not happen when the row before has a wide tile or fewer than three", () => {
    expect(show(layoutTiles([text("a", L), text("b", S), text("c", S)], 3))).toEqual([
      "a:1.1+2",
      "b:1.3+1",
      "c:2.1+3",
    ]);
    expect(show(layoutTiles([text("a", S), text("b", S), text("c", S), text("d", S), text("e", S)], 3))).toEqual([
      "a:1.1+1",
      "b:1.2+1",
      "c:1.3+1",
      "d:2.1+2",
      "e:2.3+1",
    ]); // d and e have equal lengths: the first one grows
  });

  it("does not happen with two columns", () => {
    const items = [text("a", S), text("b", S), text("c", S)];
    expect(show(layoutTiles(items, 2))).toEqual(["a:1.1+1", "b:1.2+1", "c:2.1+2"]);
  });

  it("does not move a tile out of a row that contains an image", () => {
    const items = [image("i"), text("a", S), text("b", S), text("c", S)];
    // row 1: i a b; c alone in row 2 and stretched.
    expect(show(layoutTiles(items, 3))).toEqual(["i:1.1+1", "a:1.2+1", "b:1.3+1", "c:2.1+3"]);
  });
});

describe("layoutTiles: image tiles", () => {
  it("come first in their row, whatever the input order", () => {
    expect(show(layoutTiles([text("a", S), image("i")], 2))).toEqual(["a:1.2+1", "i:1.1+1"]);
  });

  it("are the last to grow", () => {
    expect(show(layoutTiles([image("i"), text("a", S)], 3))).toEqual(["i:1.1+1", "a:1.2+2"]);
  });

  it("grow when they are alone in a row", () => {
    expect(show(layoutTiles([image("i")], 3))).toEqual(["i:1.1+3"]);
  });
});

describe("layoutAll", () => {
  it("returns the layouts for 1, 2 and 3 columns", () => {
    const all = layoutAll([text("a", S), text("b", L), text("c", S)]);
    expect(show(all[1])).toEqual(["a:1.1+1", "b:2.1+1", "c:3.1+1"]);
    expect(show(all[2])).toEqual(["a:1.1+1", "b:2.1+2", "c:1.2+1"]);
    expect(show(all[3])).toEqual(["a:1.3+1", "b:1.1+2", "c:2.1+3"]);
    expect([all[1].cols, all[2].cols, all[3].cols]).toEqual([1, 2, 3]);
  });
});

describe("layoutTiles: invariants on pseudo-random lists", () => {
  let seed = 12345;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  it("never overlaps, never leaves a gap, never exceeds the columns", () => {
    for (let run = 0; run < 300; run++) {
      const items: TileItem[] = Array.from({ length: 1 + random(9) }, (_, i) => {
        const roll = random(10);
        if (roll === 0) return box(`t${i}`);
        if (roll === 1 && i === 0) return image(`t${i}`);
        return text(`t${i}`, random(400));
      });
      for (const cols of [1, 2, 3]) {
        const layout = layoutTiles(items, cols);
        const taken = new Map<string, string>();
        for (const p of layout.placements) {
          expect(p.span).toBeGreaterThanOrEqual(1);
          expect(p.colStart + p.span - 1).toBeLessThanOrEqual(cols);
          for (let c = p.colStart; c < p.colStart + p.span; c++) {
            const key = `${p.row}.${c}`;
            expect(taken.has(key)).toBe(false);
            taken.set(key, p.id);
          }
        }
        for (let r = 1; r <= layout.rows; r++) for (let c = 1; c <= cols; c++) expect(taken.has(`${r}.${c}`)).toBe(true);
      }
    }
  });
});
