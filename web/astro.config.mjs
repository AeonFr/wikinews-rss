import { defineConfig } from "astro/config";

// SITE_URL is the full public URL including the path, e.g. https://aeonfr.github.io/wikinews-rss
// (-> site "https://aeonfr.github.io", base "/wikinews-rss"). Default: local development.
const siteUrl = new URL(process.env.SITE_URL || "http://localhost:4321");
const base = siteUrl.pathname.replace(/\/+$/, "") || "/";

export default defineConfig({
  site: siteUrl.origin,
  base,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
});
