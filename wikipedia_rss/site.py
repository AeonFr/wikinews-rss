"""The website: URLs of its pages and the data file (data/news.json) they read.

Every feed item is a "story": one headline, or several headlines about the same article
and day that were grouped. The story page (story.html?id=...) shows all of them in full,
which the feed item's title (and the readers that never refresh it) may not.
"""
import hashlib
import json

from . import sources


def story_id(guid):
    """Short id for URLs: "wikipedia:en:2026-10-18:1c69c8c8eee6" -> "2026-10-18-1c69c8c8eee6"."""
    return guid.split(":", 2)[-1].replace(":", "-")


def story_url(site_url, guid):
    return "%s/story.html?id=%s" % (site_url.rstrip("/"), story_id(guid))


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


def _more_articles(members, article):
    """The other articles on the topic lines of a story's headlines (no repeats, nor the main one)."""
    seen = {article["url"]} if article else set()
    out = []
    # In the portal's own order, unlike the headlines (oldest first).
    for m in sorted(members, key=lambda m: m.get("order", 0)):
        for a in m.get("topic_articles", []):
            if a["url"] not in seen:
                seen.add(a["url"])
                out.append({k: v for k, v in a.items() if v})
    return out


def build_story(it, cfg, image=None):
    """One story: the entries about the same nearest article on a day (see state.rss_items).

    It is what the website's article page shows (and what a feed item is). "group" is the id
    of the top-level article of the day it is nested under: the stories with the same group
    make up one box on the front page. `image`, if any, is {url, source, link}.
    """
    members = it.get("members") or [it]
    categories = list(dict.fromkeys(m["category"] for m in members if m.get("category")))
    article = _article(members)
    story = {
        "id": story_id(it["guid"]),
        "group": story_id(it.get("story_guid") or it["guid"]),
        "title": it["title"],
        "pub_date": it["pub_date"],
        "categories": categories,
        "article": article,
        "more_articles": _more_articles(members, article),
        "headlines": [_headline(m, cfg) for m in members],
    }
    if image:
        story["image"] = image
    return story


def build_data(cfg, items, updated, retention_days, previews=None):
    """Contents of data/news.json; `items` (state.rss_items) newest first, `updated` the state's
    last real change.

    previews: the source cache (sources.load_cache). A group of the front page (the stories with
    the same top-level article) that has several entries, or one straight from the portal, gets
    the image of the first of its sources that has one, on each of its stories.
    """
    members = {}
    for it in items:
        members.setdefault(it.get("story_guid") or it["guid"], []).extend(it.get("members") or [it])
    images = {key: sources.featured_image(ms, previews) for key, ms in members.items()}
    return {
        "updated": updated,
        "retention_days": retention_days,
        "portal": {"title": cfg.portal, "url": cfg.url(cfg.portal)},
        "stories": [build_story(it, cfg, images[it.get("story_guid") or it["guid"]]) for it in items],
    }


def data_version(news, previews):
    """data/version.json: a hash of the text of data/news.json and of data/sources.json.

    The pages fetch this small file fresh every time and then ask for the data files with
    `?v=<hash>`, so that a browser can keep them cached for as long as they do not change and
    gets the new ones as soon as they do.
    """
    def short(text):
        return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    return json.dumps({"news": short(news), "sources": short(previews)}, indent=1, sort_keys=True) + "\n"


def dump_data(data):
    return json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
