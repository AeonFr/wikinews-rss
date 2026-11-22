"""Pipeline: fetch -> parse -> enrich -> dedupe/state -> RSS feed + website data."""
import datetime
import logging
import os
import time

from . import infobox, parsers, rss, site, sources, state as st
from .client import ApiError
from .config import RETENTION_DAYS
from .limits import ARTICLE_FETCH_BUDGET, MAX_ARTICLE_FETCHES

log = logging.getLogger(__name__)


def collect(cfg, client, today, days):
    items, errors = [], 0
    for n in range(days):
        date = today - datetime.timedelta(days=n)
        title = parsers.daily_page_title(cfg, date)
        try:
            data = client.api(action="parse", page=title, prop="text", disablelimitreport="1")
        except ApiError as e:
            # Today's page may not exist yet early in the UTC day.
            log.info("%s: skipping %s (%s)", cfg.code, title, e.code)
            errors += 1
            continue
        items += parsers.parse_daily_html(data["parse"]["text"], cfg, date, title)
    if errors == days:
        raise RuntimeError("no daily page could be read")
    return items


def collect_topics(cfg, client):
    """The "Topics in the news" of the portal's main page, and whether the box was read.

    (items, read): `read` is False if the page cannot be read or has no such box (its layout may
    have changed): then it says nothing about which topics are still in it. An empty box is read.
    """
    try:
        data = client.api(action="parse", page=cfg.portal, prop="text", disablelimitreport="1")
    except ApiError as e:
        log.info("%s: skipping %s (%s)", cfg.code, cfg.portal, e.code)
        return [], False
    html = data["parse"]["text"]
    return parsers.parse_topics_html(html, cfg, cfg.portal), "p-current-events-headlines" in html


def lookup_pages(client, titles, extracts=False):
    """title -> {pageid, qid, url, title, extract} for existing pages (redirects followed)."""
    titles = list(dict.fromkeys(t for t in titles if t))
    result = {}
    # TextExtracts returns intro extracts for at most 20 pages per request.
    size = 20 if extracts else 50
    for i in range(0, len(titles), size):
        chunk = titles[i:i + size]
        params = dict(action="query", titles="|".join(chunk), redirects="1",
                      prop="pageprops|info", inprop="url", ppprop="wikibase_item")
        if extracts:
            params.update(prop="pageprops|info|extracts", exintro="1", explaintext="1",
                          exsentences="2", exlimit="max")
        q = client.api(**params).get("query", {})
        pages = {p["title"]: p for p in q.get("pages", []) if "missing" not in p and "invalid" not in p}
        renames = {r["from"]: r["to"] for r in q.get("normalized", [])}
        renames.update({r["from"]: r["to"] for r in q.get("redirects", [])})
        for t in chunk:
            target = t
            for _ in range(3):  # normalized -> redirect
                target = renames.get(target, target)
            p = pages.get(target)
            if p:
                result[t] = {
                    "pageid": p["pageid"],
                    "qid": p.get("pageprops", {}).get("wikibase_item"),
                    "url": p.get("canonicalurl") or p.get("fullurl"),
                    "title": p["title"],
                    # The first two sentences, whole: the pages shorten them where they need to.
                    "extract": parsers.clean_space(p.get("extract") or ""),
                }
    return result


def topic_titles(it):
    """Titles of every article linked on the topic lines above an entry, outermost first."""
    return [link["title"] for t in it.get("topics", []) for link in t.get("links", [])]


def highlighted_titles(cfg, it):
    """Titles of the articles an entry highlights (italic or bold links): what an entry with no
    article of its own may be about. Not for "Topics in the news", which have their own."""
    if it.get("kind") == "topic":
        return []
    return parsers.highlighted_titles(it.get("html"), cfg, it.get("sources"))


def highlighted_articles(cfg, titles, pages):
    """[{title, url, extract}] of the existing articles among `titles` (`pages`: lookup_pages), no repeats."""
    out = []
    for title in titles:
        page = pages.get(title)
        if page and all(page["url"] != a["url"] for a in out):
            out.append({"title": page["title"], "url": page["url"],
                        "extract": page["extract"] if cfg.use_extracts else ""})
    return out


def cut_short(extract):
    """An extract stored by an older version, which cut it at 300 characters with an ellipsis."""
    return (extract or "").endswith("…")


def backfill_extracts(cfg, client, state, pages):
    """Give the stored headlines the extract of their article when they have none, or a cut one.

    Only the last `days` daily pages are scraped, so a headline older than that keeps what it
    had when it left the scrape: nothing, if it was stored before extracts were fetched, or an
    extract cut at 300 characters (see cut_short), as older versions stored them. The same for
    the extracts of the other articles of its topic lines. Looked up once: an article without an
    extract is stored as "" and not asked for again.
    """
    if not cfg.use_extracts:
        return
    missing, others = {}, {}
    for it in state.get("items", {}).values():
        title = it.get("article_title") or it.get("main_title")  # older headlines only have main_title
        if it.get("pageid") and title and ("article_extract" not in it or cut_short(it["article_extract"])):
            missing.setdefault(title, []).append(it)
        for article in it.get("topic_articles", []):
            if cut_short(article.get("extract")):
                others.setdefault(article["title"], []).append(article)
    need = [t for t in list(missing) + list(others) if t not in pages]
    found = lookup_pages(client, list(dict.fromkeys(need)), extracts=True) if need else {}
    for title, items in missing.items():
        page = pages.get(title) or found.get(title)
        for it in items:
            it["article_extract"] = page["extract"] if page else ""
            if page and not it.get("article_title"):
                it["article_title"] = page["title"]
    for title, articles in others.items():
        page = pages.get(title) or found.get(title)
        if page:
            for article in articles:
                article["extract"] = page["extract"]


def backfill_highlighted(cfg, client, state, pages):
    """Give the stored headlines without an article their highlighted articles (see finalize) if they lack them.

    Only the last `days` daily pages are scraped, so an older headline keeps what it had when it left
    the scrape; one stored before this existed is looked up here, once (a headline whose highlighted
    links turned out not to be articles keeps an empty list and is not asked for again).
    """
    missing = [(it, highlighted_titles(cfg, it)) for it in state.get("items", {}).values()
               if not it.get("pageid") and "highlighted_articles" not in it]
    missing = [(it, titles) for it, titles in missing if titles]
    need = list(dict.fromkeys(t for _, titles in missing for t in titles if t not in pages))
    found = dict(pages, **(lookup_pages(client, need, extracts=cfg.use_extracts) if need else {}))
    for it, titles in missing:
        it["highlighted_articles"] = highlighted_articles(cfg, titles, found)


def finalize(cfg, raw_items, pages):
    """Assign guid, link and enrichment; drop duplicates within one scrape.

    Each item gets "group_key" (its main article: pageid, or title if the page does not
    exist) used to group headlines about the same article (and day), plus "page_date" and
    "pos" (position within its portal page) that order the headlines of a group.
    "Topics in the news" (kind "topic") have no day: their guid has "topic" where the date is, they
    are never grouped (no "group_key"), and the moment they were first seen is their date.
    Items whose main article exists also get "article_title" and, if configured,
    "article_extract" (shown in the card of the story page), and "topic_articles": the
    other articles linked on the topic lines above the entry (at any level) that exist.
    An entry whose main article does not exist also gets "highlighted_articles" if its text
    highlights links (see parsers.highlighted_titles): {title, url, extract} of those that exist,
    which stand in for the article it lacks (the key is absent when it highlights nothing).
    """
    items, seen, pos = [], set(), {}
    for order, it in enumerate(raw_items):
        page = pages.get(it["main_title"]) if it["main_title"] else None
        date = it["date"].isoformat() if it.get("date") else None
        topic = it.get("kind") == "topic"
        guid = "wikipedia:%s:%s:%s" % (cfg.code, date or "topic", parsers.text_hash(it["text"]))
        if guid in seen:
            continue
        seen.add(guid)
        it = dict(it, guid=guid, date=date, order=order, pos=pos.setdefault(it["page"], 0), page_date=date)
        pos[it["page"]] += 1
        it["link"] = page["url"] if page else (cfg.url(it["main_title"]) if it["main_title"] else cfg.url(it["page"]))
        if page:
            it["pageid"], it["qid"] = page["pageid"], page["qid"]
            if not topic:
                it["group_key"] = "pageid:%s" % page["pageid"]
            it["article_title"] = page["title"]
            if cfg.use_extracts:
                it["article_extract"] = page["extract"]  # "" if the article has none: looked up
        topic_articles = []
        for title in topic_titles(it):
            other = pages.get(title)
            if other and (not page or other["pageid"] != page["pageid"]) \
                    and other["url"] not in [a["url"] for a in topic_articles]:
                topic_articles.append({"title": other["title"], "url": other["url"],
                                       "extract": other["extract"] if cfg.use_extracts else ""})
        if topic_articles:
            it["topic_articles"] = topic_articles
        if not page:
            titles = highlighted_titles(cfg, it)
            if titles:
                it["highlighted_articles"] = highlighted_articles(cfg, titles, pages)
        if not page and it["main_title"] and not topic:
            it["group_key"] = "title:%s" % it["main_title"]
        items.append(it)
    return items


def run(cfg, client, now, days=7, max_items=50, state_dir="state", out_dir="feeds", data_dir="data",
        site_url=None, dry_run=False, retention_days=RETENTION_DAYS, max_group=st.MAX_GROUP, fetch_source=None,
        article_maps=True, max_article_fetches=MAX_ARTICLE_FETCHES, article_delay=0,
        article_budget=ARTICLE_FETCH_BUDGET, article_clock=time.monotonic):
    """Scrape, update the state and write the RSS feed (out_dir) and the website data (data_dir).

    `fetch_source(url) -> (preview, reason)` (see sources.Fetcher) turns on the link previews
    of the cited sources; without it nothing is fetched (previews already cached are kept).
    `article_maps` turns on reading the map and location from the infobox of the stories' articles
    (at most `max_article_fetches` requests per run, `article_delay` seconds apart, within `article_budget`
    seconds of `article_clock()`, without retries; see infobox.update_cache); without it
    nothing is fetched (what is cached is kept).
    """
    today = now.date()
    raw_items = collect(cfg, client, today, days)
    if not raw_items:
        raise RuntimeError("no items parsed; the page layout may have changed")
    topics, topics_read = collect_topics(cfg, client)
    raw_items += topics
    titles = [t for it in raw_items for t in [it["main_title"]] + topic_titles(it) + highlighted_titles(cfg, it)]
    pages = lookup_pages(client, titles, extracts=cfg.use_extracts)
    state_path = os.path.join(state_dir, "%s.json" % cfg.code)
    state = st.load_state(state_path)
    items = finalize(cfg, raw_items, pages)

    new = st.merge(state, items, now, retention_days, max_group, also_read=[cfg.portal] if topics_read else [])
    backfill_extracts(cfg, client, state, pages)
    backfill_highlighted(cfg, client, state, pages)
    last_build = st.parse_iso(state["updated"])
    # The website keeps the topics the portal no longer highlights (their pages stay reachable);
    # the feed does not list them.
    stories = st.rss_latest(state, None, with_retired=True)
    feed_items = [s for s in stories if not s.get("retired")][:max_items]
    source_urls = [s["url"] for it in stories for m in (it.get("members") or [it]) for s in m.get("sources", [])]
    sources_path = os.path.join(state_dir, "sources.json")
    sources_cache = sources.load_cache(sources_path)
    if fetch_source and not dry_run:
        try:
            stats = sources.update_cache(sources_cache, source_urls, now, fetch_source)
            log.info("%s: source previews: %d fetched, %d found, %d failed",
                     cfg.code, stats["fetched"], stats["found"], stats["failed"])
        except Exception as e:  # previews are optional: never fail the run because of them
            log.warning("%s: source previews skipped: %s", cfg.code, e)
    articles_path = os.path.join(state_dir, "articles.json")
    articles_cache = infobox.load_cache(articles_path)
    articles_before = infobox.dump_cache(articles_cache)
    # Built after the previews so a story gets its image as soon as one is found.
    xml = rss.build_rss(cfg, feed_items, last_build, site_url, sources_cache)
    data = site.dump_data(site.build_data(cfg, stories, state["updated"], retention_days, sources_cache,
                                          articles_cache))
    # The essential outputs are written before the optional map phase, so nothing that goes wrong
    # there (an error, a hang, the job being killed) can lose them.
    if not dry_run:
        st.write_atomic(os.path.join(out_dir, "%s.xml" % cfg.code), xml)
        previews = sources.dump_data(sources_cache, source_urls)
        st.write_atomic(os.path.join(data_dir, "news.json"), data)
        st.write_atomic(os.path.join(data_dir, "sources.json"), previews)
        st.write_atomic(sources_path, sources.dump_cache(sources_cache))
        st.save_state(state_path, state)
    if article_maps and not dry_run:
        try:
            stats = infobox.update_cache(articles_cache, site.story_articles(stories), client, now,
                                         max_fetch=max_article_fetches, delay=article_delay,
                                         budget=article_budget, clock=article_clock)
            log.info("%s: article maps: %d fetched, %d with a map or location, %d failed, %d pending",
                     cfg.code, stats["fetched"], stats["found"], stats["failed"], stats["pending"])
        except Exception as e:  # optional: never fail the run because of it
            log.warning("%s: article maps skipped: %s", cfg.code, e)
    if not dry_run:
        if infobox.dump_cache(articles_cache) != articles_before:  # something was fetched (or dropped)
            data = site.dump_data(site.build_data(cfg, stories, state["updated"], retention_days, sources_cache,
                                                  articles_cache))
            st.write_atomic(os.path.join(data_dir, "news.json"), data)
        st.write_atomic(articles_path, infobox.dump_cache(articles_cache))
    return {"scraped": len(items), "new": len(new), "in_feed": len(feed_items),
            "requests": client.requests, "items": feed_items, "xml": xml, "data": data}
