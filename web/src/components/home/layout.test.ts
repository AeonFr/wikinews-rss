import { describe, expect, it } from "vitest";
import type { BoxContent, BoxEntry, BoxGroup, HomeEntry } from "../../model";
import { boxInput, boxLayoutStyles, dayHeadingId, entryItems, entryListStyles, imageTitle, withoutLinks } from "./layout";

const entry = (storyId: string, length: number, image = false): HomeEntry => ({
  storyId,
  href: `/articles/${storyId}/`,
  label: null,
  items: [],
  length,
  image: image ? { url: "https://img/x.jpg", source: "AP", href: "/x" } : null,
});

const boxEntry = (length: number): BoxEntry => ({ html: "", text: "", length, storyId: "s", href: "/s", cited: [], context: null });
const summary = { title: "A", url: "https://w/A", extract: "text" };
const content = (extra: Partial<BoxContent>): BoxContent => ({ image: null, entries: [], groups: [], summary: null, length: 0, ...extra });
const group = (extra: Partial<BoxGroup>): BoxGroup => ({
  ...content({}),
  chain: ["G"],
  title: "G",
  showDivider: false,
  ...extra,
});

describe("entryItems", () => {
  it("makes an entry with an image a full-row tile and uses the text length", () => {
    expect(entryItems([entry("a", 40), entry("b", 90, true)])).toEqual([
      { id: "a", kind: "text", textLength: 40 },
      { id: "b", kind: "fullRow", textLength: 90 },
    ]);
  });
});

describe("entryListStyles", () => {
  it("gives every entry the placement variables for 1, 2 and 3 columns", () => {
    const { grid, cells } = entryListStyles([entry("a", 40), entry("b", 400)]);
    expect(grid).toBe("");
    for (const id of ["a", "b"]) {
      for (const n of [1, 2, 3]) expect(cells[id]).toMatch(new RegExp(`--r${n}:.*--c${n}:`));
    }
  });

  it("stacks everything in one column and never leaves a gap in a row", () => {
    const { cells } = entryListStyles([entry("a", 40), entry("b", 40), entry("c", 40)]);
    expect(cells.a).toContain("--r1:1;--c1:1");
    expect(cells.c).toContain("--r1:3;--c1:1");
    // three short tiles fill one row of three
    expect(cells.a).toContain("--r3:1;--c3:1");
    expect(cells.c).toContain("--r3:1;--c3:3");
  });
});

describe("boxInput", () => {
  it("lists the loose entries first, then the groups, with ids by position", () => {
    const input = boxInput(
      content({
        summary,
        entries: [boxEntry(10), boxEntry(20)],
        groups: [group({ summary, entries: [boxEntry(5), boxEntry(6)] })],
      }),
      true,
    );
    expect(input).toEqual({
      summary: true,
      image: true,
      items: [
        { id: "e0", textLength: 10 },
        { id: "e1", textLength: 20 },
        { id: "g0", group: { summary: true, image: false, items: [{ id: "e0", textLength: 5 }, { id: "e1", textLength: 6 }] } },
      ],
    });
  });
});

describe("boxLayoutStyles", () => {
  const box = content({ summary, entries: [boxEntry(50), boxEntry(60), boxEntry(70)] });

  it("puts the summary in the first column spanning the entries' rows, and the entries after it", () => {
    const styles = boxLayoutStyles(box, false);
    expect(styles.summary).toContain("--c2:1");
    expect(styles.summary).toMatch(/--r2:1\/span \d/);
    expect(styles.items.e0).toContain("--c2:2");
    expect(Object.keys(styles.items)).toEqual(["e0", "e1", "e2"]);
    expect(styles.image).toBeNull();
  });

  it("has no summary style without a summary, and an image style with an image", () => {
    const styles = boxLayoutStyles(content({ entries: [boxEntry(50), boxEntry(60)] }), true);
    expect(styles.summary).toBeNull();
    expect(styles.image).toContain("--r1:");
  });

  it("styles the entries of a group under its own key", () => {
    const styles = boxLayoutStyles(
      content({ entries: [boxEntry(10)], groups: [group({ summary, entries: [boxEntry(5), boxEntry(6)] })] }),
      false,
    );
    expect(Object.keys(styles.groups)).toEqual(["g0"]);
    expect(Object.keys(styles.groups.g0.items)).toEqual(["e0", "e1"]);
    expect(styles.groups.g0.summary).not.toBeNull();
  });
});

describe("withoutLinks", () => {
  it("drops links and keeps their text and the emphasis", () => {
    expect(withoutLinks('<i>Film</i> won <a href="https://x/y" rel="noopener">the <b>prize</b></a>.')).toBe(
      "<i>Film</i> won the <b>prize</b>.",
    );
    expect(withoutLinks("plain")).toBe("plain");
  });
});

describe("small helpers", () => {
  it("names the heading of a day and titles an image", () => {
    expect(dayHeadingId("2026-11-21")).toBe("day-2026-11-21");
    expect(imageTitle("AP")).toBe("Image: AP");
    expect(imageTitle("")).toBeUndefined();
  });
});
