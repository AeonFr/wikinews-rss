"""The website: URLs of its pages and the data file (data/news.json) they read.

Every feed item is a "story": one headline, or several headlines about the same article
and day that were grouped. The story page (story.html?id=...) shows all of them in full,
which the feed item's title (and the readers that never refresh it) may not.
"""
import json


def story_id(guid):
    """Short id for URLs: "wikipedia:en:2026-10-18:1c69c8c8eee6" -> "2026-10-18-1c69c8c8eee6"."""
    return guid.split(":", 2)[-1].replace(":", "-")


def story_url(site_url, guid):
    return "%s/story.html?id=%s" % (site_url.rstrip("/"), story_id(guid))


def _headline(it, cfg):
    return {
        "html": it["html"],
        "sources": [{"name": s["name"], "url": s["url"]} for s in it.get("sources", [])],
        "category": it.get("category"),
        "topics": [{"label": t["label"], "url": cfg.url(t["title"]) if t.get("title") else None}
                   for t in it.get("topics", [])],
        "page": {"title": it["page"], "url": cfg.url(it["page"]), "history_url": cfg.history_url(it["page"])},
    }


def _article(members):
    """The Wikipedia article the story is about (None if its headlines have no existing one)."""
    main = next((m for m in members if m.get("pageid")), None)
    if not main:
        return None
    article = {"title": main.get("article_title") or main["main_title"], "url": main["link"]}
    extract = next((m["article_extract"] for m in members if m.get("article_extract")), None)
    if extract:
        article["extract"] = extract
    return article


def build_story(it, cfg):
    """One feed item (a headline or a group, see state.feed_items) as a story record."""
    members = it.get("members") or [it]
    categories = list(dict.fromkeys(m["category"] for m in members if m.get("category")))
    return {
        "id": story_id(it["guid"]),
        "title": it["title"],
        "pub_date": it["pub_date"],
        "categories": categories,
        "article": _article(members),
        "headlines": [_headline(m, cfg) for m in members],
    }


def build_data(cfg, items, updated, retention_days):
    """Contents of data/news.json; `items` newest first, `updated` the state's last real change."""
    return {
        "updated": updated,
        "retention_days": retention_days,
        "portal": {"title": cfg.portal, "url": cfg.url(cfg.portal)},
        "stories": [build_story(it, cfg) for it in items],
    }


def dump_data(data):
    return json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
