import type { Story } from "./types";

/** "2026-11-21T18:49:53Z" -> "2026-11-21": the UTC day. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The UTC day `n` days after `day` (before, when `n` is negative): ("2026-11-21", -7) -> "2026-11-14". */
export function addDays(day: string, n: number): string {
  const date = new Date(`${dayOf(day)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** A UTC calendar day ("2026-11-21", or an ISO datetime) as text: "Saturday, November 21, 2026". */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${dayOf(day)}T00:00:00Z`),
  );
}

/**
 * A short date for a list of news: "Nov 20", and with the year ("Nov 20, 2025") when it is not the year of `current`
 * (a UTC day or datetime, usually the page's own day).
 */
export function formatShortDay(day: string, current: string): string {
  const withYear = dayOf(day).slice(0, 4) !== dayOf(current).slice(0, 4);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${dayOf(day)}T00:00:00Z`));
}

/** A moment in UTC, as the static text of the page: "Nov 21, 2026, 6:49 PM UTC". */
export function formatMomentUtc(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** How long news is kept, as text: "6 months" (183 days), or "N days" for short periods. */
export function retentionPeriod(days: number): string {
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30.4)} months`;
}

/**
 * The stories of the last `days` UTC days counted back from `updated` (that day included),
 * grouped by UTC day, newest day first. Topics are never part of a day. Story order is kept.
 */
export function groupByDay(stories: Story[], updated: string, days = 30): { day: string; stories: Story[] }[] {
  const cutoff = new Date(`${dayOf(updated)}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const byDay = new Map<string, Story[]>();
  for (const story of stories) {
    if (story.kind === "topic") continue;
    const day = dayOf(story.pub_date);
    if (day <= cutoffDay) continue;
    const list = byDay.get(day);
    if (list) list.push(story);
    else byDay.set(day, [story]);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, list]) => ({ day, stories: list }));
}
