/** The whole site model, built from the data files once per build. */
import { loadNews, loadSources } from "../data/load";
import type { NewsData, SourcePreviews } from "../data/types";
import { type ArticlePage, articleIds, buildArticlePage } from "./article-page";
import { type Home, buildHome } from "./home";

export interface SiteModel {
  news: NewsData;
  home(): Home;
  /** One page model per story id (null for an unknown id). */
  articlePage(id: string): ArticlePage | null;
  /** The ids of all the stories, for `getStaticPaths`. */
  articleIds(): string[];
}

/** A site model over given data (pure; used by the tests). Page models are built when asked for, not before. */
export function createSiteModel(news: NewsData, sources: SourcePreviews): SiteModel {
  let home: Home | undefined;
  return {
    news,
    home: () => (home ??= buildHome(news)),
    articlePage: (id) => buildArticlePage(news, sources, id),
    articleIds: () => articleIds(news),
  };
}

let site: SiteModel | undefined;

/**
 * The site model of the repo's data files, loaded on first use and shared by every page of the build
 * (so the stories are indexed once, however many pages ask).
 */
export function getSiteModel(): SiteModel {
  return (site ??= createSiteModel(loadNews(), loadSources()));
}
