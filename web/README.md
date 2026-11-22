# Wikipedia News: web

Static site built with [Astro](https://astro.build) from the data the Python generator writes
(`../data/news.json`, `../data/sources.json`, `../feeds/en.xml`). No client-side JavaScript except a tiny
inline script that shows the "Last updated" time in the visitor's time zone. See `../docs/site-spec.md`.

## Commands

Run them from this directory (`web/`). Node 22.23.4 or newer.

```sh
npm install        # install dependencies
npm run dev        # dev server at http://localhost:4321
npm run build      # static site into dist/ (copies ../feeds/en.xml to public/feeds/ first)
npm run preview    # serve dist/ locally
npm test           # vitest
npm run check      # astro check (types)
```

## Environment variables

- `SITE_URL`: full public URL including the path, e.g. `SITE_URL=https://aeonfr.github.io/wikinews-rss`
  (site `https://aeonfr.github.io`, base `/wikinews-rss`). Default `http://localhost:4321` (base `/`).
  Every internal link must go through `withBase()` / `articlePath()` in `src/data/urls.ts`.

## Layout

- `src/data/`: types of the JSON files, loader (`load.ts`), URL helpers (`urls.ts`), small pure helpers with tests.
- `src/layouts/`, `src/components/`: Astro components, each with its own `*.module.css`.
- `src/styles/global.css`: reset, custom properties, base typography and the link rules (internal / Wikipedia / other; see `../docs/site-spec.md` section 9).
- Fonts: the serif is a system stack; the sans is Libre Franklin (SIL OFL 1.1), self-hosted. `global.css` declares its `@font-face` (latin subset,
  variable weight, `font-display: swap`) pointing at the woff2 inside the exact-pinned dev package `@fontsource-variable/libre-franklin`
  (`node_modules/.../files/libre-franklin-latin-wght-normal.woff2`, licence in the package's `LICENSE`); `src/layouts/Base.astro` imports the same file
  with `?url` to preload it. Astro hashes it into `dist/_astro/` (about 29 KB). No third-party requests. To update, bump the pinned version (at least two weeks old).
- `src/pages/`: `index.astro` and `articles/[id].astro` (placeholders for now).
- `scripts/copy-feed.mjs`: runs before `build`; `public/feeds/` is a git-ignored copy.
