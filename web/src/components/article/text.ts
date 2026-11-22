/** Small pure helpers of the article page (the components only call them). */
import type { ArticlePage, Outlet } from "../../model";
import { shorten } from "../../model";

export const SITE_NAME = "Wikipedia News";

/** A summary as paragraphs: split at line breaks, empty lines dropped. */
export function paragraphs(text: string | null): string[] {
  return (text ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The accessible name of a numbered link, whose visible text is just "1", "2"... */
export function outletLinkLabel(outlet: Outlet, number: number): string {
  return `${outlet.name}, link ${number}`;
}

/** The page's `<title>` and meta description, taken from its entries (the first one names the page). */
export function pageMeta(page: ArticlePage): { title: string; description: string } {
  const texts = page.entries.flatMap((block) => block.texts.map((item) => item.text)).filter(Boolean);
  const first = texts[0] ?? page.title;
  return {
    title: `${shorten(first, 70)} – ${SITE_NAME}`,
    description: shorten(texts.length ? texts.join(" ") : page.title, 200),
  };
}
