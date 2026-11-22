/**
 * The grouped box of the home page: the tree of the entries of one unit (the stories sharing a
 * `group`), built from each headline's `topics` path.
 */
import type { ArticleRef, HeadlineTopic, Story } from "../data/types";
import { articleKey, articleOfTopic, hasTopicLink, nearestKey, pageLabel, storyArticles } from "./articles";
import { type ModelImage, type Summary, type TextItem, storyHref, storyImage, summaryOf, textItem } from "./entry";

/** Levels of sub-topics kept below the root; deeper topic lines count as the last level. */
export const MAX_LEVELS = 2;
/** A group directly in a box shows its article's summary only with at least this many entries. */
export const ABOUT_MIN_ENTRIES = 2;
/** Characters of an article summary on the home page. */
export const HOME_SUMMARY_CHARS = 300;

export interface BoxEntry extends TextItem {
  storyId: string;
  /** The entry's own article page. */
  href: string;
  /** Label of the sub-topic it was part of when that was not worth a group of its own. */
  context: string | null;
}

/** What a box and a group have in common. Entries are shortest first; `groups` come after them. */
export interface BoxContent {
  entries: BoxEntry[];
  groups: BoxGroup[];
  /** Start of the article the box/group is about; null when it has none or must not show it. */
  summary: Summary | null;
  /** Characters of all the entries in it (groups included). */
  length: number;
}

export interface BoxGroup extends BoxContent {
  /** The topic labels it is titled with, outermost first (a sub-topic that holds only another one is a chain). */
  chain: string[];
  /** `chain` joined with " › ". */
  title: string;
  /** Whether a line goes above it: only for a group directly in the box, with something before it. */
  showDivider: boolean;
}

export interface Box extends BoxContent {
  /** The unit's group id. */
  id: string;
  title: string;
  /** The article page the title links to; null: the title is plain text. */
  titleHref: string | null;
  /** The unit's image, if any (the layout decides whether there is room for it). */
  image: ModelImage | null;
  storyIds: string[];
}

// ---- The tree -------------------------------------------------------------------------------

interface TreeEntry {
  /** Position among the unit's headlines. */
  index: number;
  story: Story;
  item: TextItem;
  /** The sub-topics it sits under (at most MAX_LEVELS), outermost first. */
  path: HeadlineTopic[];
  context: string | null;
}

interface Node {
  /** Its title: one topic, or a chain when a sub-topic holds nothing but another one. */
  topics: HeadlineTopic[];
  entries: TreeEntry[];
  children: Node[];
}

/** The sub-topic lines below the root article of a headline, at most MAX_LEVELS. */
function subTopics(topics: HeadlineTopic[]): HeadlineTopic[] {
  const root = topics.findIndex(hasTopicLink);
  return root < 0 ? [] : topics.slice(root + 1, root + 1 + MAX_LEVELS);
}

/** The raw tree: one node per distinct sub-topic label under its parent, every entry in its deepest node. */
function growTree(entries: TreeEntry[]): Node {
  const root: Node = { topics: [], entries: [], children: [] };
  for (const entry of entries) {
    let node = root;
    for (const topic of entry.path) {
      let child = node.children.find((candidate) => candidate.topics[0].label === topic.label);
      if (!child) {
        child = { topics: [topic], entries: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.entries.push(entry);
  }
  return root;
}

/** The entries in a node and in the nodes below it, in unit order. */
function entriesIn(node: Node): TreeEntry[] {
  return [...node.entries, ...node.children.flatMap(entriesIn)].sort((a, b) => a.index - b.index);
}

/**
 * Applies the grouping rules: a sub-topic with fewer than two entries in total is not a group (its entry
 * joins the parent and keeps the sub-topic's label as context); a sub-topic holding only another
 * sub-topic is merged with it into one title chain. The root itself is never merged here.
 */
function simplify(node: Node, isRoot: boolean): Node {
  const entries = [...node.entries];
  const children: Node[] = [];
  for (const child of node.children) {
    const kept = simplify(child, false);
    const inside = entriesIn(kept);
    if (inside.length >= 2) children.push(kept);
    else for (const entry of inside) entries.push({ ...entry, context: entry.path.at(-1)?.label ?? null });
  }
  if (!isRoot && entries.length === 0 && children.length === 1) {
    return { ...children[0], topics: [...node.topics, ...children[0].topics] };
  }
  return { topics: node.topics, entries, children };
}

// ---- The box --------------------------------------------------------------------------------

function toBoxEntry(entry: TreeEntry): BoxEntry {
  return { ...entry.item, storyId: entry.story.id, href: storyHref(entry.story), context: entry.context };
}

/** Entries shortest text first (ties keep the unit's order). */
function sortedEntries(entries: TreeEntry[]): BoxEntry[] {
  return [...entries].sort((a, b) => a.item.length - b.item.length || a.index - b.index).map(toBoxEntry);
}

const sumLength = (entries: BoxEntry[], groups: BoxGroup[]) =>
  entries.reduce((n, e) => n + e.length, 0) + groups.reduce((n, g) => n + g.length, 0);

/**
 * A node as a group. Only a group directly in the box (`direct`) can show its article's summary, and only
 * with at least ABOUT_MIN_ENTRIES entries; groups nested in groups never do. `showDivider` is set by the box.
 */
function toGroup(node: Node, articles: ArticleRef[], direct: boolean, summaryChars: number): BoxGroup {
  const article = articleOfTopic(node.topics[node.topics.length - 1], articles);
  const entries = sortedEntries(node.entries);
  const groups = node.children.map((child) => toGroup(child, articles, false, summaryChars));
  const chain = node.topics.map((topic) => topic.label);
  const withSummary = direct && article !== null && entriesIn(node).length >= ABOUT_MIN_ENTRIES;
  return {
    chain,
    title: chain.join(" › "),
    entries,
    groups,
    summary: withSummary ? summaryOf(article, summaryChars) : null,
    length: sumLength(entries, groups),
    showDivider: false,
  };
}

/** Every article the unit's stories know, once each. */
function unitArticles(stories: Story[]): ArticleRef[] {
  const seen = new Map<string, ArticleRef>();
  for (const article of stories.flatMap(storyArticles)) {
    const key = articleKey(article.url);
    if (!seen.has(key)) seen.set(key, article);
  }
  return [...seen.values()];
}

/**
 * The box of a unit (the stories of one group, in order). The root is the unit's top-level article; if it
 * has exactly one sub-group and no entries of its own, the box is that sub-group instead.
 */
export function buildBox(stories: Story[], summaryChars = HOME_SUMMARY_CHARS): Box {
  const first = stories[0];
  const entries: TreeEntry[] = stories
    .flatMap((story) => story.headlines.map((headline) => ({ story, headline })))
    .map(({ story, headline }, index) => ({
      index,
      story,
      item: textItem(headline),
      path: subTopics(headline.topics),
      context: null,
    }));
  const articles = unitArticles(stories);

  let tree = simplify(growTree(entries), true);
  let title = first.article?.title ?? pageLabel(first);
  let article: ArticleRef | null = first.article;
  while (tree.children.length === 1 && tree.entries.length === 0) {
    tree = tree.children[0];
    const topic = tree.topics[tree.topics.length - 1];
    title = topic.label;
    article = articleOfTopic(topic, articles);
  }

  const looseEntries = sortedEntries(tree.entries);
  // A box of several stories has no page of its own: its image goes to the page of its source.
  const imageStory = stories.find((story) => storyImage(story, "") !== null);
  const image = imageStory
    ? storyImage(imageStory, (stories.length > 1 && imageStory.image?.link) || storyHref(imageStory))
    : null;
  // A group is divided from whatever comes before it in the box (the image counts), never from the title.
  const preceding = (image ? 1 : 0) + looseEntries.length;
  const groups = tree.children.map((child, i) => ({
    ...toGroup(child, articles, true, summaryChars),
    showDivider: preceding + i > 0,
  }));
  // The article's summary is the box's own first column unless it has groups: those carry their own.
  const summary = groups.length === 0 && article ? summaryOf(article, summaryChars) : null;

  // The title links to a page only when it is the page of that very article.
  const only = stories.length === 1 ? first : null;
  const titleHref = only && article && nearestKey(only) === articleKey(article.url) ? storyHref(only) : null;

  return {
    id: first.group || first.id,
    title,
    titleHref,
    image,
    summary,
    entries: looseEntries,
    groups,
    length: sumLength(looseEntries, groups),
    storyIds: stories.map((story) => story.id),
  };
}
