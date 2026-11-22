import { describe, expect, it } from "vitest";
import { layoutBox, layoutBoxAll, type BoxInput, type BoxLayout, type BoxItemInput } from "./index";

// Box thresholds: short <= 280, long >= 500.
const S = 100;
const M = 200; // longer than 170 (does not sit beside an image), still short in a box
const F = 400; // flex in a box (would be long on the page)
const L = 600;

const e = (id: string, textLength: number): BoxItemInput => ({ id, textLength });
const g = (id: string, group: BoxInput): BoxItemInput => ({ id, group });

function items(layout: BoxLayout): string[] {
  return layout.items.map((p) => `${p.id}:${p.row}.${p.colStart}+${p.span}`);
}
const spot = (p: BoxLayout["summary"]) => (p ? `${p.row}.${p.colStart}+${p.span}/${p.rowSpan}` : null);

describe("layoutBox: entries area", () => {
  it("without a summary the entries use every column", () => {
    const layout = layoutBox({ items: [e("a", S), e("b", S), e("c", S)] }, 3);
    expect(layout.entryCols).toBe(3);
    expect(layout.summary).toBeNull();
    expect(items(layout)).toEqual(["a:1.1+1", "b:1.2+1", "c:1.3+1"]);
  });

  it("with a summary on 3 columns the entries use 2, and the summary spans all their rows", () => {
    const layout = layoutBox({ summary: true, items: [e("a", S), e("b", S), e("c", S)] }, 3);
    expect(layout.entryCols).toBe(2);
    expect(items(layout)).toEqual(["a:1.2+1", "b:1.3+1", "c:2.2+2"]);
    expect(spot(layout.summary)).toBe("1.1+1/2");
    expect(layout.rows).toBe(2);
  });

  it("with a summary on 2 columns the entries use 1, stacked next to the summary", () => {
    const layout = layoutBox({ summary: true, items: [e("a", S), e("b", S), e("c", L)] }, 2);
    expect(layout.entryCols).toBe(1);
    expect(items(layout)).toEqual(["a:1.2+1", "b:2.2+1", "c:3.2+1"]);
    expect(spot(layout.summary)).toBe("1.1+1/3");
  });

  it("on 1 column the summary comes first, then the entries, with no spans", () => {
    const layout = layoutBox({ summary: true, items: [e("a", S), e("b", L)] }, 1);
    expect(spot(layout.summary)).toBe("1.1+1/1");
    expect(items(layout)).toEqual(["a:2.1+1", "b:3.1+1"]);
    expect(layout.rows).toBe(3);
  });

  it("uses the box thresholds: 400 characters is flex, not long", () => {
    const layout = layoutBox({ items: [e("a", F), e("b", F), e("c", F)] }, 3);
    expect(items(layout)).toEqual(["a:1.1+1", "b:1.2+1", "c:1.3+1"]);
    const long = layoutBox({ items: [e("a", L), e("b", L)] }, 3);
    expect(items(long)).toEqual(["a:1.1+3", "b:2.1+3"]);
  });

  it("a box with one entry and a summary: the entry takes the whole entries area", () => {
    const layout = layoutBox({ summary: true, items: [e("a", S)] }, 3);
    expect(items(layout)).toEqual(["a:1.2+2"]);
    expect(spot(layout.summary)).toBe("1.1+1/1");
  });

  it("lays out entries by the same rules as tiles (lone last tile, 3 columns, no summary)", () => {
    const layout = layoutBox({ items: [e("a", S), e("b", S), e("c", S), e("d", S)] }, 3);
    expect(items(layout)).toEqual(["a:1.1+2", "b:1.3+1", "c:2.1+2", "d:2.3+1"]);
  });
});

describe("layoutBox: image", () => {
  it("is one column wide and first in its row", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", S), e("b", S)] }, 3);
    expect(spot(layout.image)).toBe("1.2+1/1");
    expect(items(layout)).toEqual(["a:1.3+1", "b:2.2+2"]);
    expect(spot(layout.summary)).toBe("1.1+1/2");
  });

  it("with a long text (> 170) beside it, takes the whole entries area on its own row", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", M), e("b", S)] }, 3);
    expect(spot(layout.image)).toBe("1.2+2/1");
    expect(items(layout)).toEqual(["a:2.2+1", "b:2.3+1"]);
    expect(spot(layout.summary)).toBe("1.1+1/2");
    expect(layout.image!.hidden).toBe(false);
  });

  it("a text of exactly 170 characters still sits beside it", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", 170)] }, 3);
    expect(spot(layout.image)).toBe("1.2+1/1");
    expect(items(layout)).toEqual(["a:1.3+1"]);
    const longer = layoutBox({ summary: true, image: true, items: [e("a", 171)] }, 3);
    expect(spot(longer.image)).toBe("1.2+2/1");
  });

  it("a long text that is not in the image's row does not matter", () => {
    // entries area 2 columns: row 1 = image + a; b (long, needs 2) goes to row 2.
    const layout = layoutBox({ summary: true, image: true, items: [e("a", S), e("b", L)] }, 3);
    expect(spot(layout.image)).toBe("1.2+1/1");
    expect(items(layout)).toEqual(["a:1.3+1", "b:2.2+2"]);
  });

  it("is hidden when it would take all 3 columns of the box", () => {
    // no summary: entries area = 3 columns; the long text beside it makes it full width
    const layout = layoutBox({ image: true, items: [e("a", M), e("b", S)] }, 3);
    expect(layout.image!.hidden).toBe(true);
    expect(layout.image!.order).toBe(-1);
    // rows are laid out without it: a and b share row 1, the longer text (a) takes the leftover
    expect(items(layout)).toEqual(["a:1.1+2", "b:1.3+1"]);
  });

  it("is hidden when it is alone in its row without a summary on 3 columns, and rows close up", () => {
    const layout = layoutBox({ image: true, items: [g("grp", { items: [e("x", S)] })] }, 3);
    expect(layout.image!.hidden).toBe(true);
    expect(items(layout)).toEqual(["grp:1.1+3"]);
  });

  it("is kept when it takes 2 of 3 columns beside a summary", () => {
    const layout = layoutBox({ summary: true, image: true, items: [g("grp", { items: [e("x", S)] })] }, 3);
    expect(spot(layout.image)).toBe("1.2+2/1");
    expect(items(layout)).toEqual(["grp:2.2+2"]);
    expect(spot(layout.summary)).toBe("1.1+1/2");
  });

  it("on 2 columns without a summary it sits beside a short text, or is hidden beside a long one", () => {
    const short = layoutBox({ image: true, items: [e("a", S)] }, 2);
    expect(spot(short.image)).toBe("1.1+1/1");
    expect(items(short)).toEqual(["a:1.2+1"]);
    const long = layoutBox({ image: true, items: [e("a", M)] }, 2);
    expect(long.image!.hidden).toBe(true);
    expect(items(long)).toEqual(["a:1.1+2"]);
  });

  it("on 2 columns with a summary it has a row of its own in the single entries column and is shown", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", S), e("b", M)] }, 2);
    expect(spot(layout.image)).toBe("1.2+1/1");
    expect(items(layout)).toEqual(["a:2.2+1", "b:3.2+1"]);
    expect(spot(layout.summary)).toBe("1.1+1/3");
  });

  it("stacked, it comes right under the title, above the summary", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", S), e("b", M)] }, 1);
    expect(spot(layout.image)).toBe("1.1+1/1");
    expect(spot(layout.summary)).toBe("2.1+1/1");
    expect(items(layout)).toEqual(["a:3.1+1", "b:4.1+1"]);
    expect(layout.rows).toBe(4);
    expect(layout.image!.order).toBeLessThan(layout.summary!.order);
  });

  it("stacked without a summary, it is the first thing before the entries and is never hidden", () => {
    const layout = layoutBox({ image: true, items: [e("a", M)] }, 1);
    expect(spot(layout.image)).toBe("1.1+1/1");
    expect(items(layout)).toEqual(["a:2.1+1"]);
  });

  it("an image alone in a box with a summary: 2 columns of 3", () => {
    const layout = layoutBox({ summary: true, image: true, items: [] }, 3);
    expect(spot(layout.image)).toBe("1.2+2/1");
    expect(spot(layout.summary)).toBe("1.1+1/1");
  });

  it("reports no image placement when the box has none", () => {
    expect(layoutBox({ items: [e("a", S)] }, 3).image).toBeNull();
  });
});

describe("layoutBox: groups", () => {
  const group = (summary: boolean, n: number): BoxInput => ({
    summary,
    items: Array.from({ length: n }, (_, i) => e(`x${i}`, S)),
  });

  it("a group is a full row of the entries area with its own grid", () => {
    const layout = layoutBox({ items: [e("a", S), e("b", S), g("grp", group(false, 3))] }, 3);
    expect(items(layout)).toEqual(["a:1.1+2", "b:1.3+1", "grp:2.1+3"]);
    const inner = layout.groups.grp!;
    expect(inner.cols).toBe(3);
    expect(items(inner)).toEqual(["x0:1.1+1", "x1:1.2+1", "x2:1.3+1"]);
  });

  it("a group with its own summary column has the box's entries area as its grid", () => {
    const layout = layoutBox({ items: [g("grp", group(true, 3))] }, 3);
    const inner = layout.groups.grp!;
    expect(inner.cols).toBe(3);
    expect(inner.entryCols).toBe(2);
    expect(spot(inner.summary)).toBe("1.1+1/2");
    expect(items(inner)).toEqual(["x0:1.2+1", "x1:1.3+1", "x2:2.2+2"]);
  });

  it("when the box has a summary, its groups have 2 columns on desktop and 1 on 2 columns", () => {
    const input: BoxInput = { summary: true, items: [g("grp", group(true, 2))] };
    const three = layoutBox(input, 3);
    expect(items(three)).toEqual(["grp:1.2+2"]);
    expect(three.groups.grp!.cols).toBe(2);
    expect(three.groups.grp!.entryCols).toBe(1);
    expect(items(three.groups.grp!)).toEqual(["x0:1.2+1", "x1:2.2+1"]);

    const two = layoutBox(input, 2);
    expect(items(two)).toEqual(["grp:1.2+1"]);
    expect(two.groups.grp!.cols).toBe(1);
    // one column: its summary is stacked above its entries
    expect(spot(two.groups.grp!.summary)).toBe("1.1+1/1");
    expect(items(two.groups.grp!)).toEqual(["x0:2.1+1", "x1:3.1+1"]);
  });

  it("stacked, groups are single-column stacks too", () => {
    const layout = layoutBox({ items: [e("a", S), g("grp", group(true, 2))] }, 1);
    expect(items(layout)).toEqual(["a:1.1+1", "grp:2.1+1"]);
    expect(layout.groups.grp!.cols).toBe(1);
    expect(spot(layout.groups.grp!.summary)).toBe("1.1+1/1");
  });

  it("groups nest: a group's own groups get its entries area", () => {
    const deep: BoxInput = { items: [e("y", S), e("z", S)] };
    const outer: BoxInput = { summary: true, items: [e("x", S), g("inner", deep)] };
    const layout = layoutBox({ items: [g("outer", outer)] }, 3);
    expect(layout.groups.outer!.entryCols).toBe(2);
    expect(layout.groups.outer!.groups.inner!.cols).toBe(2);
    expect(items(layout.groups.outer!.groups.inner!)).toEqual(["y:1.1+1", "z:1.2+1"]);
  });

  it("an image takes a row of its own before a group when there is no room for it beside anything", () => {
    const layout = layoutBox({ summary: true, image: true, items: [e("a", S), g("grp", group(false, 2))] }, 3);
    expect(spot(layout.image)).toBe("1.2+1/1");
    expect(items(layout)).toEqual(["a:1.3+1", "grp:2.2+2"]);
  });
});

describe("layoutBoxAll", () => {
  it("gives the box for 1, 2 and 3 columns", () => {
    const all = layoutBoxAll({ summary: true, items: [e("a", S), e("b", S), e("c", S)] });
    expect([all[1].cols, all[2].cols, all[3].cols]).toEqual([1, 2, 3]);
    expect([all[1].entryCols, all[2].entryCols, all[3].entryCols]).toEqual([1, 1, 2]);
    expect(items(all[1])).toEqual(["a:2.1+1", "b:3.1+1", "c:4.1+1"]);
    expect(items(all[2])).toEqual(["a:1.2+1", "b:2.2+1", "c:3.2+1"]);
  });

  it("the order lists the summary first, then the entries by position", () => {
    const layout = layoutBox({ summary: true, items: [e("a", S), e("b", S), e("c", S)] }, 3);
    expect(layout.summary!.order).toBe(0);
    expect(layout.items.map((p) => p.order)).toEqual([1, 2, 3]);
  });
});
