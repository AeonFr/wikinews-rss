/** Small text helpers for headline HTML and summaries. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** The text of an inline-HTML fragment: tags dropped, entities decoded, white space collapsed and trimmed. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_TAGS = new Set(["a", "i", "b", "em", "strong"]);
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)|</g;

function safeHref(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  const href = (match?.[1] ?? match?.[2] ?? "").trim();
  return /^https?:\/\//i.test(href) ? href.replace(/"/g, "&quot;") : null;
}

/**
 * Inline HTML reduced to what the site shows: `<a>` (http/https links only), `<i>`, `<b>`, `<em>` and
 * `<strong>`. Any other tag is dropped (its text stays); a link without a valid href loses its tag.
 * Tags are always balanced in the result.
 */
export function inlineHtml(html: string): string {
  let out = "";
  // Open allowed tags; `emitted` is false for a link that was dropped.
  const open: { tag: string; emitted: boolean }[] = [];
  for (const [whole, closing, rawTag, attributes, text] of html.matchAll(TOKEN)) {
    if (text !== undefined) out += text;
    else if (whole === "<") out += "&lt;";
    else if (rawTag === undefined) continue; // a comment
    else {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) continue;
      if (!closing) {
        const href = tag === "a" ? safeHref(attributes ?? "") : null;
        const emitted = tag !== "a" || href !== null;
        open.push({ tag, emitted });
        if (emitted) out += tag === "a" ? `<a href="${href}" rel="noopener">` : `<${tag}>`;
      } else {
        const at = open.map((entry) => entry.tag).lastIndexOf(tag);
        if (at < 0) continue;
        for (const entry of open.splice(at).reverse()) if (entry.emitted) out += `</${entry.tag}>`;
      }
    }
  }
  for (const entry of open.reverse()) if (entry.emitted) out += `</${entry.tag}>`;
  return out;
}

/**
 * `text` cut to at most `limit` characters at a word boundary, with "…" added; unchanged if it fits.
 * A trailing comma, semicolon or colon before the cut is dropped.
 */
export function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  // Cut inside a word: drop the partial word (unless the head is one single word).
  const partial = /\s/.test(text[limit] ?? "") ? -1 : head.search(/\s+\S*$/);
  const cut = partial > 0 ? head.slice(0, partial) : head;
  return `${cut.trimEnd().replace(/[,;:]+$/, "")}…`;
}
