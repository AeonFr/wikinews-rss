/** Prefixes a site path ("/articles/x/") with the base path the site is deployed under. */
export function withBase(path: string, base: string = import.meta.env.BASE_URL): string {
  const prefix = base.replace(/\/+$/, "");
  return `${prefix}/${path.replace(/^\/+/, "")}`;
}

/** Path of a story's page; always ends in a slash. */
export function articlePath(id: string, base?: string): string {
  return withBase(`articles/${encodeURIComponent(id)}/`, base);
}

/** Path of the RSS feed. */
export function feedPath(base?: string): string {
  return withBase("feeds/en.xml", base);
}

/** Path of the home page. */
export function homePath(base?: string): string {
  return withBase("", base);
}
