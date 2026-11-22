import type { Story } from "./types";

/**
 * The label of the article a story is about: the innermost topic line of its first entry that
 * links an article, else the main article's title, else the story's own title.
 */
export function nearestLabel(story: Story): string {
  const topics = story.headlines[0]?.topics ?? [];
  const nearest = [...topics].reverse().find((topic) => topic.url);
  return nearest?.label ?? story.article?.title ?? story.title;
}
