"""The website: URLs of its pages and the data file (data/news.json) they read.

Every feed item is a "story": one headline, or several headlines about the same article
and day that were grouped. The story page (articles/<id>/) shows all of them in full,
which the feed item's title (and the readers that never refresh it) may not.
"""
import json

from . import infobox as infobox_mod, sources


def story_id(guid):
    """Short id for URLs: "wikipedia:en:2026-10-18:1c69c8c8eee6" -> "2026-10-18-1c69c8c8eee6"."""
    return guid.split(":", 2)[-1].replace(":", "-")


def story_url(site_url, guid):
    return "%s/articles/%s/" % (site_url.rstrip("/"), story_id(guid))


def _topic(t, cfg):
    """A topic line above an entry: its label, its first article and every article it links."""
    topic = {"label": t["label"], "url": cfg.url(t["title"]) if t.get("title") else None}
    links = [{"label": link["text"] or link["title"], "url": cfg.url(link["title"])} for link in t.get("links", [])]
    if links:
        topic["links"] = links
    return topic


def _headline(it, cfg):
    return {
        "id": story_id(it["guid"]),
        "html": it["html"],
        "sources": [{"name": s["name"], "url": s["url"]} for s in it.get("sources", [])],
        "category": it.get("category"),
        "topics": [_topic(t, cfg) for t in it.get("topics", [])],
        "page": {"title": it["page"], "url": cfg.url(it["page"]), "history_url": cfg.history_url(it["page"])},
    }


def _article(members, infobox=None):
    """The Wikipedia article the story is about (None if its headlines have no existing one).

    infobox: the articles' map and location (infobox.load_cache); `location` and `map` are only
    there if known.
    """
    main = next((m for m in members if m.get("pageid")), None)
    if not main:
        return None
    article = {"title": main.get("article_title") or main["main_title"], "url": main["link"]}
    extract = next((m["article_extract"] for m in members if m.get("article_extract")), None)
    if extract:
        article["extract"] = extract
    article.update(infobox_mod.story_info(infobox, article["url"]))
    return article


def story_articles(items):
    """The {title, url} of every article of the stories (`items`: state.rss_items), without repeats.

    In the stories' order (newest first), each story's own article before its topic articles; the
    highlighted articles of the entries without an article of their own (see _highlighted_articles)
    come after all of those, so they never take the place of the others in a limited run.
    """
    out = {}
    implicit = []
    for it in items:
        members = it.get("members") or [it]
        article = _article(members)
        for a in ([article] if article else []) + _topic_articles(members, article):
            out.setdefault(a["url"], {"title": a["title"], "url": a["url"]})
        implicit.append((members, article))
    for members, article in implicit:
        for a in _highlighted_articles(members, article):
            out.setdefault(a["url"], {"title": a["title"], "url": a["url"]})
    return list(out.values())


def _topic_articles(members, article, infobox=None):
    """The other articles on the topic lines of a story's headlines (no repeats, nor the main one)."""
    seen = {article["url"]} if article else set()
    out = []
    # In the portal's own order, unlike the headlines (oldest first).
    for m in sorted(members, key=lambda m: m.get("order", 0)):
        for a in m.get("topic_articles", []):
            if a["url"] not in seen:
                seen.add(a["url"])
                out.append(dict({k: v for k, v in a.items() if v}, **infobox_mod.story_info(infobox, a["url"])))
    return out


def _highlighted_articles(members, article, infobox=None):
    """For a story with no article: the articles its entries highlight in italics or bold (in order).

    They stand in for the article the entry does not have (the page describes the first one). The
    headlines keep them as "highlighted_articles" ({title, url, extract}, only the ones that exist),
    set when they are scraped (feed.finalize) or later (feed.backfill_highlighted).
    """
    if article:
        return []
    out = []
    for m in sorted(members, key=lambda m: m.get("order", 0)):
        for a in m.get("highlighted_articles", []):
            if all(a["url"] != o["url"] for o in out):
                out.append(dict({k: v for k, v in a.items() if v}, **infobox_mod.story_info(infobox, a["url"])))
    return out


def _more_articles(members, article, infobox=None):
    """The other articles of a story: those of its topic lines, then (no article) the highlighted ones."""
    out = _topic_articles(members, article, infobox)
    return out + [a for a in _highlighted_articles(members, article, infobox) if all(a["url"] != o["url"] for o in out)]


def build_story(it, cfg, image=None, infobox=None):
    """One story: the entries about the same nearest article on a day (see state.rss_items).

    It is what the website's article page shows (and what a feed item is). "group" is the id
    of the top-level article of the day it is nested under: the stories with the same group
    make up one box on the front page. `image`, if any, is {url, source, link}; `infobox`
    is the cache of the articles' map and location.
    """
    members = it.get("members") or [it]
    categories = list(dict.fromkeys(m["category"] for m in members if m.get("category")))
    article = _article(members, infobox)
    story = {
        "id": story_id(it["guid"]),
        "group": story_id(it.get("story_guid") or it["guid"]),
        "title": it["title"],
        "pub_date": it["pub_date"],
        "categories": categories,
        "article": article,
        "more_articles": _more_articles(members, article, infobox),
        "headlines": [_headline(m, cfg) for m in members],
    }
    if image:
        story["image"] = image
    if members[0].get("kind") == "topic":   # a "Topic in the news": dated by when it was added
        story["kind"] = "topic"
        if members[0].get("retired"):         # no longer in the box: only its page remains
            story["retired"] = True
    return story


def build_data(cfg, items, updated, retention_days, previews=None, infobox=None):
    """Contents of data/news.json; `items` (state.rss_items) newest first, `updated` the state's
    last real change.

    previews: the source cache (sources.load_cache). Every group of the front page (the stories with
    the same top-level article) gets the image of the first of its sources that has one, on each of its
    stories (the RSS feed only has them on groups of several entries and on entries from the portal). infobox: the cache of
    the articles' map and location (infobox.load_cache).
    """
    members = {}
    for it in items:
        members.setdefault(it.get("story_guid") or it["guid"], []).extend(it.get("members") or [it])
    images = {key: sources.story_image(ms, previews) for key, ms in members.items()}
    return {
        "updated": updated,
        "retention_days": retention_days,
        "portal": {"title": cfg.portal, "url": cfg.url(cfg.portal)},
        "stories": [build_story(it, cfg, images[it.get("story_guid") or it["guid"]], infobox) for it in items],
    }


def dump_data(data):
    return json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
