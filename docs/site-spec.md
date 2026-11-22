# Wikipedia News: spec for the static-site rewrite

This is the brief for rebuilding the website as a **static site generated at build time**, which works **without JavaScript**.
The generator (Python, in `wikipedia_rss/`) is **not** being rewritten: it keeps scraping the Wikipedia portal and writes
`data/news.json`, `data/sources.json`, `feeds/en.xml` and `state/en.json`. The new site reads those JSON files at build time.

## 0. Principles

- Build from scratch, as if nothing existed. The old site (`index.html`, `story.html`, `assets/site.js`, `assets/site.css`) is a
  **reference for behaviour and measurements only**. Do not port its code structure or its CSS. It was iterated on a lot; the point of the
  rewrite is a clean foundation with no accumulated debt.
- **Keep** (these are requirements): the column layout, the font sizes and column widths, and *all the logic of how things arrange*
  (sections 3-5). The numbers are in section 8 below. **Do not open or read `assets/site.css`, `assets/site.js` or the old HTML**:
  everything you need is in this document, and looking at the old styles only makes the new design a copy of it.
- **Free to redesign** (do not copy, choose sensible, restrained defaults): colors, font families, how subtitles/labels look, borders,
  hover states, decorative details. The direction is a **classy, newspaper-like** design (editorial typography, strong masthead, confident hierarchy, refined rules and whitespace),
  but with your own identity: do not reproduce the old site's palette, fonts, label style or rule treatments. We will iterate on details later.
- **CSS Modules** (`*.module.css`) per component. Only a very small global stylesheet (reset, a few custom properties, base typography).
- **No client-side JavaScript**, with one allowed exception: a tiny inline script (under 1 KB) that converts the "Last updated" UTC
  timestamp to the visitor's local time (progressive enhancement; the static text is UTC and fully readable without it).
- Typed (TypeScript), small pure functions for all logic, with tests (vitest). Rendering code stays thin.
- **Fonts**: the serif is the system Georgia stack (nothing to download); the sans is **Libre Franklin** (a revival of Franklin Gothic, the
  classic newspaper sans; SIL Open Font License 1.1), **self-hosted**: one variable-weight latin woff2 (about 29 KB, normal style only, no
  italics) from the exact-pinned npm package `@fontsource-variable/libre-franklin`. No third-party request at runtime. See section 9.

## 1. Decisions (settled; do not re-litigate)

- Tooling: **Astro** (static output), TypeScript, **vitest**, plain CSS Modules. No UI framework, no Tailwind.
- The Astro project lives in **`web/`** at the repo root. Python code and `data/` stay where they are.
- Inputs are read at build time from `../data/news.json` and `../data/sources.json` (relative to `web/`), and the feed `../feeds/en.xml`
  is copied to the site as `/feeds/en.xml`.
- URLs: home `/`, article pages `/articles/<story id>/`, feed `/feeds/en.xml`. Old URLs (`story.html?id=...`) do **not** need support.
- Hosting: GitHub Pages project site (`https://aeonfr.github.io/wikinews-rss/`, so a **base path** `/wikinews-rss`), deployed from a
  GitHub Actions workflow. The site URL is given at build time by the env var `SITE_URL` (full URL including the path; default
  `http://localhost:4321` with base `/`). Every internal link and asset reference must respect the base path.
- Asset caching: handled by Astro's hashed filenames. No manual stamping, no `version.json`.
- Language: English UI only.
- Do not `git commit` or `git push`. The coordinator does that.

## 2. Data (inputs)

`wikipedia_rss/site.py` writes `data/news.json`; read it for the exact shape (and `data/news.json` itself for real examples).

```
{ updated: ISO UTC string, retention_days, portal: {title, url}, stories: Story[] }   // stories newest first

Story = {
  id, group,                       // group = id shared by the stories nested under one top-level article of a day
  title, pub_date (ISO UTC), categories: string[],
  article: ArticleRef | null,      // the top-level article of the group (null: an entry straight from the portal)
  more_articles: ArticleRef[],     // other articles on the topic lines of the story's headlines; for a story with no `article`
                                   // (a portal-only entry), the articles its text highlights (see below)
  headlines: Headline[],           // the entries (one or several)
  image?: {url, source, link},     // only on stories of "featured" groups (several entries) and portal-only entries
  kind?: "topic", retired?: true   // "Topics in the news" items; retired ones keep their page but are not listed
}
ArticleRef = { title, url, extract?,
               location?: string,   // the "Location" row of the article's infobox (plain text, at most ~200 characters)
               map?: { url, url2x?, width, height } }   // the infobox's Kartographer map: a static image of https://maps.wikimedia.org/ (hotlinked)
             // `location` and `map` are each present only if the article's infobox has it (the generator reads them lazily, a few articles per run,
             // so a new article has neither for a while); they are also on the `more_articles`, because the page describes the nearest article.
Headline = { id, html (inline HTML: only <a href> and <i>/<b>), category, sources: {name,url}[],
             topics: {label, url, links?: {label,url}[]}[],   // the nested topic lines above the entry, outermost first
             page: {title, url, history_url} }
```

**Highlighted links.** An entry with no article of its own (`article: null`) may still be about one: the editors set the article an entry is about in
italics or bold (in the data an `<a>` directly inside `<i>` or `<b>`, e.g. `<i><a href="https://en.wikipedia.org/wiki/Voyager_1">Voyager 1</a></i>`).
For such a story the generator puts these links into `more_articles` (in order of appearance, without repeats, only those that exist, with their `extract`,
and the `location`/`map` once known like for any article; stories that have an `article`, and the topics, are unchanged: nothing is added to them).
Not counted: links to other namespaces (`File:`, `Category:`, `Portal:`, `Wikipedia:`, `Help:`, `Special:`, `Template:`, ...), links to a section only, red links, and
links whose text is the name of an outlet cited by the entry (italic outlet names such as *The Guardian* are not the subject).
`article` stays `null` and the story's `group`, `id` and feed item do not change: the implicit article is only what the article page describes (section 6).

`data/sources.json`: `{ sources: { [sourceUrl]: { title, description?, image?, site? } } }` (link previews of cited sources; may lack many).

A **story is one "article of a day"**: the entries of one day about the same *nearest* article (the innermost topic line that links an
article). The nesting of articles (topic > sub-topic > sub-sub-topic) comes from each headline's `topics` path; stories with the same
`group` belong to the same top-level article of that day.

## 3. Home page (`/`), top to bottom

1. Masthead (site name, a tagline, a link to the RSS feed), an intro paragraph, a small unofficial-project/licence disclaimer, and a
   "Last updated" line with the `updated` timestamp (UTC text + the optional tiny enhancement script).
2. **Topics in the news** section (above all days, not inside any day): stories with `kind === "topic"` and not `retired`, as portal-style
   entries (see 3c), under a section heading that is clearly stronger than the article labels under it.
3. **Day sections**, newest first, for the last **30 days** (by UTC day of `pub_date`, counted back from `updated`). Topics are never in a day.
   Each day has a sticky date heading (`position: sticky; top: 0`, opaque background) that stays until the next day pushes it away.
   Inside a day, in this order:
   - **a. Portal entries**: stories with no `article` that are their own unit. A larger text size than the others; with an image,
     the image is the first column and the text takes the rest of the row (full row: image 1 column, text the others).
   - **b. Grouped boxes**: units (stories sharing a `group`) with several entries, as grouped boxes without a background tint (see 4); the vertical rule of the "About the article" summary plus the title and dividers group them.
   - **c. Single-article tiles**: units with one story that has one entry and an article. A small label with the article's title
     (or the category for no-article entries), then the entry text as a link to its article page.
   Within portal entries and within grouped boxes, those that have an image come first.
   Unit rule: `stories.length === 1 && (headlines.length === 1 || !article)` is a single tile / portal entry; anything else is a box.

## 4. Grouped boxes (the complex part; port this logic faithfully)

A box merges the stories of a unit. Its title is the top-level article's title. Build a tree from every headline's `topics` path:

- The root is the unit's top-level article: the first topic of a headline that has a link. Below it keep at most **2 levels**
  (`MAX_LEVELS = 2`); deeper topic lines count as the last level.
- A sub-topic holding **a single entry in total is not a group**: its entry joins the parent group and keeps that sub-topic's label as
  its "context" (shown as a small label above the entry). A sub-topic whose only content is another sub-topic is shown as one (the inner
  title only is used wherever a single title is needed).
- If the root has **exactly one sub-topic and no entries of its own**, the box *is* that sub-topic: its title and article replace the
  root's (repeat while that holds); the broad article is not shown.
- Each entry's text links to its **own article page** (its story). Group titles and the box title are plain text, except: the box title
  links to the article page only when the unit has a single story whose nearest article is the box's article.
- Entries are listed shortest text first within a group; sub-groups come after the loose entries. A thin divider line goes above a group
  only if something precedes it in the box (never as the first thing, which would divide the title from its content).
- "About the article" (summary) rules: the box's own article summary is the box's **first column** unless the box has sub-groups; a group
  **directly in the box** with at least **2 entries** shows its own article's summary as the first column of its grid; groups nested in groups never
  do; single-entry articles never do. The home page shows the summary **shortened to 300 characters** (cut at a word, add "…"); the article
  page shows it whole. The summary has no title of its own on the home page (the article title is right above).
- Images in a box (`story.image` of the unit): the image is one more item of the grid, **one column wide, first in its row**. If a text longer than
  **170 characters** would sit next to it, the image instead takes the whole width of the entries area (2 columns) on its own row and the texts go
  below. An image **never takes all 3 columns of the box** (and never the full width of a 2-column box): if it would, it is left out.
  Stacked (1 column), the image comes right under the title, **above** the summary.

## 5. Tile layout algorithm (compute at BUILD time, for 1, 2 and 3 columns)

Breakpoints: **< 40rem → 1 column**, **≥ 40rem → 2 columns**, **≥ 62rem → 3 columns**. The browser must pick the right precomputed layout with
CSS only (media queries reading per-breakpoint CSS custom properties that the build emitted on each tile: row, column start, span,
visual order, visibility). Keep DOM order sensible for reading and use `order`/explicit placement for the visual order.

For a list of tiles (single tiles, portal entries, topics, the entries inside a box, the entries inside a group), given `cols`:

- Tile size by text length (characters): **short ≤ 149, long ≥ 225, otherwise "flex"** (inside boxes and groups the entries use higher
  thresholds: **short ≤ 280, long ≥ 500**). Needs: short/flex 1 column, long 2 (max `cols`), grouped boxes and sub-groups the full row.
- Packing: each tile goes to the **first row with room** (so short tiles fill the gaps wide ones leave). Then, per row: a flex tile widens by 1
  to avoid a gap; then any leftover goes to the row's tile with the **longest text** (so **no row ever has an empty column**; an image tile is
  the last to grow). Within a row, **the image first, then wider tiles first** (stable).
- With 3 columns: if the **last row is a single tile and the row before has exactly three one-column tiles**, the last tile of that row moves down
  to join it (two rows of two, each with a wide and a narrow tile) instead of stretching the lone tile across all columns.
- 1 column: everything stacked, no spans.
- Portal entries/topics with an image take the full row (image = 1 column, text = the rest).
- Inside a box: with a summary column the entries area is `cols - 1` columns (2 on desktop), otherwise `cols`; the summary spans all the rows of the entries.
  Groups inside a box get their own grid with the same rules (and their own summary column when they have one).

Write this as pure, well-tested functions (port the cases in the old `layoutTiles`, `layoutFeature`, `layoutGroups` in `assets/site.js`).

## 6. Article page (`/articles/<id>/`)

Desktop (≥ 62rem): **three columns**: the first two hold the main content, the third holds only "About the article". Narrower: one column in this order:
title, entries, where-from line, about, sources, related.

Main content, in order:
- Kicker: the date, then either a breadcrumb of the bigger articles this one is nested under (outermost first; plain text, a link only if
  another story of the same group is about that article) or, if none, the category chips. Page title (`h1`): the nearest article's label,
  else the article's title, else the category.
- The entries: each text with its inline links; entries citing the same outlets are shown together with one "Sources: …" line (an outlet cited with
  several pages is shown once with numbered links, e.g. "Al Jazeera (1, 2)").
- A line saying where they come from ("From <portal page> (history)"), once per portal page. For topics: "Added on <local date> to the Current events portal (history)."
- **From the sources**: a card per cited source that has a preview (`sources.json`): image, site, title, description. Deduplicate cards by (site, title, image).
  Source cards are **container-query** based: image on top when the container is narrow (< 30rem), beside the text when wide.
- **Related articles** (heading exactly that, no date; the section is left out when there is nothing to show). The idea: by following the previous and
  next news of an article one can reach every story about it. A story belongs to article A when its **nearest article** is A (topics never count; an entry with neither an article nor a topic line has as nearest article the **first** link its editors highlighted);
  the page's own story is never listed. Dates are UTC days (`pub_date`). For each article the list is built like this, and the same rule serves the page's
  own article and every related article:
  - The **window** is the 7 days before to the 7 days after the page's day, both ends and the day itself included (the constant is
    `RELATED_WINDOW_DAYS`; the page never mentions it). Stories of the window are listed.
  - **Fallbacks, independent of each other**: if no story of an *earlier* day is in the window but an older one exists, the single most recent older story
    is listed too; if no story of a *later* day is in the window but a later one exists, the single nearest later story is listed too. Stories of the
    page's own day do not stop a fallback; a side that already has stories in the window gets no fallback.
  - Order: newest first (by `pub_date`, ties in news order), later and earlier days mixed in one list.
  - Each item is a row: a small date next to the entries of that story (the `--label` subheader style in a `<time datetime>`, "Nov 20", with the year, "Nov 20, 2025",
    when it is not the page's year). **The date is the link** to the story's page (internal link with the arrow: "Nov 20 →"); the entries have no link of their own. Each entry is styled
    as on the page itself (sans, a little smaller, its inline links go to Wikipedia) and entries citing the same outlets share one "Sources: …" line. No "7 days" or "6 months" text anywhere in the section.
  - First, with no sub-heading (it is the page's own article), the news about the page's **own article**: a story's nearest article, a topic's article (a topic page lists the stories about it, never other topics); nothing for an entry without any article.
  - Then the **related articles**, each a block with a hairline above: its title (a link to Wikipedia, bold serif), its extract (descriptive text, sans, at most
    4 lines; may be missing), and its news as above. Which ones: first the articles this story is nested under (its `topics` path), **deepest first**;
    then the nearest articles of the stories of the **same group and same day** (the siblings), in the order of the siblings, without repeating the page's article
    or an article already listed. An ancestor with no news at all is still listed (title and extract only). The extract comes from the story's own articles, else
    from any story that knows the article (the newest version that has a text).
  - The lookups use per-article lists sorted by date (`byNearestNewestFirst`) and binary search, so the cost per page does not grow with the number of stories.

Third column / "About the article": label, the article's full summary (no cutting), and a link "Read on Wikipedia"
(a portal-only entry with no article and no highlighted link has no About column and no visible title, since its "title" would only be the portal's category; keep a visually hidden `h1` for the outline; its day is linked in the "From ..." line).
**A portal-only entry whose text highlights a Wikipedia link** (`article: null` but `more_articles` not empty, see section 2) takes the first of those as its article:
the About column describes it (its name as a link right under the label, since the page has no title of its own, then summary, map/location and "Read on Wikipedia" as above).
The page title stays hidden (model field `titleIsCategory`: the story has neither an `article` nor a nearest topic), and the implicit article **is** the story's nearest article for the "Related articles" lists (`nearestKey`): the story is in `byNearest` under the **first** highlighted link
(the portal parser counts both `<i><a>…</a></i>` and `<a><i>…</i></a>`), so the pages of that article (and its topic) list it as news. The home page and the grouping are unchanged.
Between the summary and that link, when the article being described has them: its **map** (`<img>` hotlinked from `maps.wikimedia.org`, `srcset` with the
2x image, `width`/`height`, `loading="lazy"`, `alt="Map of <location or title>"`, fitted to the column width, linking to the Wikipedia article, no hover effect,
default referrer policy) and a small "Location" label followed by the location text. Either may be missing; with neither the column is unchanged.

Topics (`kind: "topic"`) and `retired` topics have article pages like any story; retired ones are simply not listed on the home page.

## 7. Other requirements

- Semantic, accessible HTML (landmarks, heading order, `lang`, `alt=""` on decorative images, `<time datetime>`, link text that makes sense).
- Images: `loading="lazy"`, `referrerpolicy="no-referrer"`, keep their own aspect ratio (never crop), no fixed frames.
- Dark mode via `prefers-color-scheme` is nice to have, not required.
- The build must stay fast (a few thousand pages) and the output small. Report build time and total output size.
- Mobile (< 40rem): the day heading's rules and images run to the screen edges (full-bleed) while text keeps the page gutter (boxes have no tint, so they keep the gutter);
  never two lines close together: the first row under a day heading has no top line of its own.
- The footer text: unofficial project, not affiliated with the Wikimedia Foundation; text from Wikipedia contributors under CC BY-SA 4.0; and
  "News older than 6 months is removed from this site." (computed from `retention_days`).

## 8. Measurements to keep (the only styling facts that are requirements)

- Page: max width **62rem**, side gutter **1.25rem**, centred. Breakpoints: **40rem** and **62rem** (1 / 2 / 3 columns).
- Column gap **2.5rem**; row gap between tiles about **1.75rem** (inside boxes/groups about 0.75-1rem).
- Font sizes (rem, 1rem = 16px): entry text of a single tile or box entry **1.25rem** (line-height 1.5); portal entries and topics **1.375rem** (line-height 1.4) (these are the sizes of plain text; the entries that are internal links are set a little larger, see section 9);
  "About the article" summary inside a box **1rem** (line-height 1.55); on the article page the summary is larger, **1.125rem** (line-height 1.6);
  tagline **0.9375rem**; small labels/kickers **0.75rem** uppercase tracking is just an example, labels may look different but stay small (about 0.75-0.875rem);
  breadcrumb **0.875rem**; source card description **0.875rem**; masthead brand about **1.75rem** when compact (free to choose larger on the home page).
- Article page: below 62rem the content column is max **44rem** wide and centred; from 62rem it is a **three-column grid** (2 main + 1 about) with the same 2.5rem gap.
- Source cards: container query at **30rem**.
Everything not listed here (colours, fonts, borders, shadows, hover, heading styles, spacing outside these) is your design.

## 9. Links and typography (the link system)

**Colour is reserved for one affordance and one decoration.** The only coloured elements are: the small arrow after internal article links
(`--accent`, oxblood), the heavy rule above "Topics in the news" (`--accent`) and the keyboard focus ring (`--accent`). Everything else (links,
labels, kickers, dates, breadcrumb text, group titles, category chips, source names, section headings) is a neutral: ink, `--soft` or `--muted`.
No italics anywhere and no capitals; links never change on hover (no colour, underline or background change).
The system lives in `web/src/styles/global.css` (tokens, the link rules, the arrow) plus a few font rules in the component modules;
components must not restyle link colours or underlines themselves.

**Fonts.** Serif (`--serif`): `Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif`, system fonts, used for everything clickable
and for headings. Sans (`--sans`): `"Libre Franklin", "Libre Franklin Fallback", "Franklin Gothic Medium", "Franklin Gothic", "Helvetica Neue", Arial, system-ui, sans-serif`.
Libre Franklin is self-hosted (SIL OFL 1.1; the licence ships in `web/node_modules/@fontsource-variable/libre-franklin/LICENSE`, and the
package is pinned exactly in `web/package.json`). `global.css` has one `@font-face` for the **latin** subset only (`font-weight: 100 900`, `font-display: swap`,
`unicode-range`, normal style); the woff2 is imported straight from the package, so Astro hashes it and emits it under `_astro/` with the base path.
`Base.astro` preloads it on every page (`<link rel="preload" as="font" type="font/woff2" crossorigin>`). Characters outside latin (Latin Extended,
Cyrillic, ...) fall to the next family of the stack. While the font loads, `"Libre Franklin Fallback"` (Arial, or Liberation Sans/Arimo, with
`size-adjust: 102.9%`, `ascent-override: 93.9%`, `descent-override: 23.9%`, `line-gap-override: 0%`, computed from the font's metrics) keeps the
layout shift small. Weights: sans reading text (entry text, summaries, descriptions) uses `--sans-weight` (430, variable axis); subheaders (`--label`)
600; small print 400; bold 700 where a component asks for it; nothing lighter than 400.

Internal and Wikipedia links differ by **arrow and no underline** versus **underline and no arrow**:

| Kind | Where | Look |
| --- | --- | --- |
| **Internal link** (href is an absolute path of this site) | entry texts of tiles/boxes/portal entries/topics, box titles that link, the dates of "Related articles", breadcrumb links, nameplate | serif, ink (`--fg`), **no underline**; entry texts are a little larger than plain text (home entries 1.3125rem / lh 1.45, portal entries and topics 1.4375rem / lh 1.4; the dates of "Related articles" use the subheader style). Clickable article titles (class `go`) end with a small accent **→** |
| **Wikipedia link** (host `*.wikipedia.org`, `*.wikimedia.org`, `*.wikidata.org`) | article titles of "Related articles", "Read on Wikipedia", "(history)" and portal links, inline links in the entries' HTML, the map | the colour of the surrounding text (`color: inherit`) with a **thin dotted underline** at rest (full strength, 1px, offset 0.2em), no arrow; font inherited from the surrounding text |
| **Descriptive text** (not a link as a whole) | "About the article" (home and article page), the extracts under the titles of "Related articles", "Location" text, source-card descriptions | sans (`--sans`, weight `--sans-weight`), `--soft`; sizes 1rem (home summary), 1.125rem (article page summary), 1rem (extracts), 0.875rem (cards); links inside follow the other rules |
| **Subheader** (one style everywhere) | the article label above a tile or the category, the context label of a box entry, the date of the article page and the date next to each news item of "Related articles", breadcrumb items that are not links, category chips, the site name on a source card, "Location" | `--label`: sans, 0.8125rem, weight 600, `--soft`; neutral, not italic, not uppercase. Group titles and section headings are bold serif in ink |

External links to news outlets (the "Sources:" lines and the source cards) are a modest further treatment (the dotted underline stays specific to Wikipedia links): the colour of the surrounding
text (`--soft` in the sources line, ink in the card title) with the **default fainter thin underline** (45% of the text colour); the sources
line is small muted sans. (Text inside an entry that Wikipedia marks with `<i>`, such as the title of a work, stays as the editors wrote it.)

The arrow (`.go::after`, generated content with a no-break space so it never wraps alone, and `content: "..." / ""` so screen readers do not
read it where supported; no hover change) goes on: the entry text of tiles, portal entries, topics and box entries (home), a box title that
links, and the dates of "Related articles". Not on breadcrumb links (the `›` separators already mark them),
not on Wikipedia links, not on source cards or the "Sources:" outlets.

Implementation, all in `global.css`:

- `a` (base): inherits the colour, thin solid underline at 45% (the "external / other" default).
- `a:where([href^="/"]:not([href^="//"]))`: internal links, ink, no underline. Zero specificity (`:where`), so a component may still choose
  its own colour (the nameplate, the muted feed link).
- `:root a:is([href^=http], [href^="//"]):is([href*="//wikipedia.org/" i], [href*=".wikipedia.org/" i], ...wikimedia.org, ...wikidata.org):not([href*="/http" i], [href*="=http" i])`:
  Wikipedia links. Anchored on the host (`//host/` or `.host/`), so internal paths that contain "wikipedia" (the base `/wikinews-rss/`, an
  article id) never match; URLs that embed another URL (web archive, `?u=http...`) are left out. Its specificity (about 0,5,1) beats any
  component rule whatever the order of the bundled CSS, and it also covers links inside `set:html` text. Known limit: a non-Wikipedia URL whose
  path contains `/en.wikipedia.org/` would be matched.
- `.go::after`: the arrow.

Contrast (WCAG on the page background; all pass AA 4.5:1 for text, and 3:1 for the arrow):

| Pair | Ratio |
| --- | --- |
| `--accent` `#8a1c1c` on `--bg` `#fbf9f4` (light), arrows | 8.8:1 |
| `--accent` `#e08a7a` on `--bg` `#15140f` (dark), arrows | 7.1:1 |
| `--soft` (subheaders, descriptions) on `--bg` (light / dark) | 11.3:1 / 11.3:1 |
| `--fg` (links) on `--bg` (light / dark) | 16.4:1 / 15.1:1 |
