import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NewsData, SourcePreviews, SourcesData } from "./types";

/** The repo's data/ directory. The build runs with web/ as the working directory. */
export const DEFAULT_DATA_DIR = resolve(process.cwd(), "../data");

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

/** data/news.json. Required: a clear error if it is missing. */
export function loadNews(dataDir: string = DEFAULT_DATA_DIR): NewsData {
  const path = resolve(dataDir, "news.json");
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run the Python generator first (it writes data/news.json).`);
  }
  return readJson<NewsData>(path);
}

/** data/sources.json (link previews by source URL). Optional: empty if missing. */
export function loadSources(dataDir: string = DEFAULT_DATA_DIR): SourcePreviews {
  const path = resolve(dataDir, "sources.json");
  if (!existsSync(path)) return {};
  return readJson<SourcesData>(path).sources ?? {};
}
