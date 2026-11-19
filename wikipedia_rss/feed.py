"""Pipeline: fetch -> parse -> enrich -> dedupe/state -> RSS feed + website data."""
import datetime
import logging
import os

from . import parsers, rss, site, sources, state as st
from .client import ApiError
from .config import RETENTION_DAYS

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
                    "extract": parsers.truncate(parsers.clean_space(p.get("extract") or ""), 300),
                }
    return result


def finalize(cfg, raw_items, pages):
    """Assign guid, link and enrichment; drop duplicates within one scrape.

    Each item gets "group_key" (its main article: pageid, or title if the page does not
    exist) used to group headlines about the same article (and day), plus "page_date" and
    "pos" (position within its portal page) that order the headlines of a group.
    Items whose main article exists also get "article_title" and, if configured,
    "article_extract" (shown in the card of the story page).
    """
    items, seen, pos = [], set(), {}
    for order, it in enumerate(raw_items):
        page = pages.get(it["main_title"]) if it["main_title"] else None
        date = it["date"].isoformat()
        guid = "wikipedia:%s:%s:%s" % (cfg.code, date, parsers.text_hash(it["text"]))
        if guid in seen:
            continue
        seen.add(guid)
        it = dict(it, guid=guid, date=date, order=order, pos=pos.setdefault(it["page"], 0), page_date=date)
        pos[it["page"]] += 1
        it["link"] = page["url"] if page else (cfg.url(it["main_title"]) if it["main_title"] else cfg.url(it["page"]))
        if page:
            it["pageid"], it["qid"] = page["pageid"], page["qid"]
            it["group_key"] = "pageid:%s" % page["pageid"]
            it["article_title"] = page["title"]
            if cfg.use_extracts and page["extract"]:
                it["article_extract"] = page["extract"]
        elif it["main_title"]:
            it["group_key"] = "title:%s" % it["main_title"]
        items.append(it)
    return items


def run(cfg, client, now, days=7, max_items=50, state_dir="state", out_dir="feeds", data_dir="data",
        site_url=None, dry_run=False, retention_days=RETENTION_DAYS, max_group=3, fetch_source=None):
    """Scrape, update the state and write the RSS feed (out_dir) and the website data (data_dir).

    `fetch_source(url) -> (preview, reason)` (see sources.Fetcher) turns on the link previews
    of the cited sources; without it nothing is fetched (previews already cached are kept).
    """
    today = now.date()
    raw_items = collect(cfg, client, today, days)
    if not raw_items:
        raise RuntimeError("no items parsed; the page layout may have changed")
    pages = lookup_pages(client, [it["main_title"] for it in raw_items], extracts=cfg.use_extracts)
    state_path = os.path.join(state_dir, "%s.json" % cfg.code)
    state = st.load_state(state_path)
    items = finalize(cfg, raw_items, pages)

    new = st.merge(state, items, now, retention_days, max_group)
    last_build = st.parse_iso(state["updated"])
    feed_items = st.latest(state, max_items)
    xml = rss.build_rss(cfg, feed_items, last_build, site_url)
    stories = st.latest(state, None)
    data = site.dump_data(site.build_data(cfg, stories, state["updated"], retention_days))
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
    if not dry_run:
        st.write_atomic(os.path.join(out_dir, "%s.xml" % cfg.code), xml)
        st.write_atomic(os.path.join(data_dir, "news.json"), data)
        st.write_atomic(os.path.join(data_dir, "sources.json"), sources.dump_data(sources_cache, source_urls))
        st.write_atomic(sources_path, sources.dump_cache(sources_cache))
        st.save_state(state_path, state)
    return {"scraped": len(items), "new": len(new), "in_feed": len(feed_items),
            "requests": client.requests, "items": feed_items, "xml": xml, "data": data}
