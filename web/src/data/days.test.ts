import { describe, expect, it } from "vitest";
import { addDays, dayOf, formatDay, formatShortDay, formatMomentUtc, groupByDay, retentionPeriod } from "./days";
import type { Story } from "./types";

const story = (id: string, pub_date: string, extra: Partial<Story> = {}): Story => ({
  id,
  group: id,
  title: id,
  pub_date,
  categories: [],
  article: null,
  more_articles: [],
  headlines: [],
  ...extra,
});

describe("formatting", () => {
  it("takes the UTC day", () => {
    expect(dayOf("2026-11-21T23:59:59Z")).toBe("2026-11-21");
    expect(formatDay("2026-11-21T23:59:59Z")).toBe("Saturday, November 21, 2026");
  });
  it("shows the moment in UTC", () => {
    expect(formatMomentUtc("2026-11-21T18:49:53Z")).toBe("Nov 21, 2026, 6:49 PM UTC");
  });
  it("words the retention period", () => {
    expect(retentionPeriod(183)).toBe("6 months");
    expect(retentionPeriod(30)).toBe("30 days");
  });
});

describe("addDays", () => {
  it("moves a UTC day across month and year ends and leap days", () => {
    expect(addDays("2026-11-21", -7)).toBe("2026-11-14");
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(addDays("2026-01-03", -7)).toBe("2025-12-27");
    expect(addDays("2028-02-25", 5)).toBe("2028-03-01");
    expect(addDays("2026-11-21T23:59:59Z", 1)).toBe("2026-11-22");
    expect(addDays("2026-11-21", 0)).toBe("2026-11-21");
  });
});

describe("formatShortDay", () => {
  it("shows month and day, and the year only when it differs from the current one", () => {
    expect(formatShortDay("2026-11-20", "2026-11-21")).toBe("Nov 20");
    expect(formatShortDay("2026-11-20T23:59:59Z", "2026-01-01T00:00:00Z")).toBe("Nov 20");
    expect(formatShortDay("2025-12-30", "2026-01-02")).toBe("Dec 30, 2025");
    expect(formatShortDay("2027-01-01", "2026-12-31")).toBe("Jan 1, 2027");
  });
});

describe("groupByDay", () => {
  const updated = "2026-11-21T18:00:00Z";
  it("groups by UTC day, newest first, keeping story order", () => {
    const days = groupByDay(
      [story("a", "2026-11-21T10:00:00Z"), story("b", "2026-11-20T10:00:00Z"), story("c", "2026-11-21T00:00:00Z")],
      updated,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-11-21", "2026-11-20"]);
    expect(days[0]!.stories.map((s) => s.id)).toEqual(["a", "c"]);
  });
  it("keeps 30 days, today included, and leaves topics out", () => {
    const days = groupByDay(
      [
        story("in", "2026-10-23T00:00:00Z"),
        story("out", "2026-10-22T23:59:59Z"),
        story("topic", "2026-11-21T10:00:00Z", { kind: "topic" }),
      ],
      updated,
    );
    expect(days.flatMap((d) => d.stories.map((s) => s.id))).toEqual(["in"]);
  });
});
