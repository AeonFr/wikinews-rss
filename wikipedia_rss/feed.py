"""Pipeline for one language: fetch -> parse -> enrich -> dedupe/state -> RSS."""
import datetime
import logging
import os

from . import parsers, rss, state as st
from .client import ApiError

log = logging.getLogger(__name__)


def collect(cfg, client, today, days):
    if cfg.mode == "daily_pages":
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
    if cfg.mode == "single_list":
        return parsers.parse_single_list(client.raw(cfg.list_page), cfg, today)
    raise ValueError("unknown mode %r" % cfg.mode)


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


def article_created(client, title):
    data = client.api(action="query", titles=title, prop="revisions", rvdir="newer",
                      rvlimit="1", rvprop="timestamp")
    revs = data["query"]["pages"][0].get("revisions") or [{}]
    ts = revs[0].get("timestamp")
    return st.parse_iso(ts) if ts else None


def finalize(cfg, raw_items, pages, known=None):
    """Assign guid, link and enrichment; drop duplicates within one scrape.

    Each item gets "group_key" (its main article: pageid, or title if the page does not
    exist) used to group headlines about the same article, plus "page_date" and "pos"
    (position within its portal page) that order the headlines of a group.
    In single_list mode a second bullet about the same article keeps its own headline
    guid (article guid + text hash) so it can be grouped instead of dropped; the plain
    article guid stays with the bullet that already had it in `known` (the state).
    """
    known = known or {}
    resolved = []
    for it in raw_items:
        page = pages.get(it["main_title"]) if it["main_title"] else None
        date = it["date"].isoformat() if it["date"] else None
        if cfg.mode == "daily_pages":
            guid = "wikipedia:%s:%s:%s" % (cfg.code, date, parsers.text_hash(it["text"]))
        elif page:
            guid = "wikipedia:%s:%s" % (cfg.code, page["pageid"])
        elif it["main_title"]:
            guid = "wikipedia:%s:title:%s" % (cfg.code, it["main_title"])
        else:
            guid = "wikipedia:%s:text:%s" % (cfg.code, parsers.text_hash(it["text"]))
        resolved.append((it, page, date, guid))

    owner = {}  # article guid -> index of the raw item that keeps it
    if cfg.mode != "daily_pages":
        for i, (it, page, date, guid) in enumerate(resolved):
            old = known.get(guid)
            if guid not in owner or (old and old.get("text") == it["text"]
                                     and resolved[owner[guid]][0]["text"] != old.get("text")):
                owner[guid] = i

    items, seen, pos = [], set(), {}
    for order, (it, page, date, guid) in enumerate(resolved):
        if cfg.mode != "daily_pages" and owner[guid] != order and it["main_title"]:
            guid = "%s:%s" % (guid, parsers.text_hash(it["text"]))
        if guid in seen:
            continue
        seen.add(guid)
        it = dict(it, guid=guid, date=date, order=order, pos=pos.setdefault(it["page"], 0),
                  page_date=date if cfg.mode == "daily_pages" else None)
        pos[it["page"]] += 1
        it["link"] = page["url"] if page else (cfg.url(it["main_title"]) if it["main_title"] else cfg.url(it["page"]))
        if page:
            it["pageid"], it["qid"] = page["pageid"], page["qid"]
            it["group_key"] = "pageid:%s" % page["pageid"]
            if cfg.use_extracts:
                it["extract"] = page["extract"]
        elif it["main_title"]:
            it["group_key"] = "title:%s" % it["main_title"]
        items.append(it)
    return items


def run_language(cfg, client, now, days=7, max_items=50, state_dir="state", out_dir="feeds",
                 base_url=None, dry_run=False, article_dates=False, retention_days=90, max_group=3):
    today = now.date()
    raw_items = collect(cfg, client, today, days)
    if not raw_items:
        raise RuntimeError("no items parsed; the page layout may have changed")
    pages = lookup_pages(client, [it["main_title"] for it in raw_items], extracts=cfg.use_extracts)
    state_path = os.path.join(state_dir, "%s.json" % cfg.code)
    state = st.load_state(state_path)
    items = finalize(cfg, raw_items, pages, state.get("items"))

    if article_dates:
        # Optional: a recently created article dates an otherwise undated item.
        cutoff = now - datetime.timedelta(days=days)
        for it in items:
            if it["guid"] in state["items"] or it["date_source"] != "first_seen" or not it.get("pageid"):
                continue
            created = article_created(client, it["main_title"])
            if created and created >= cutoff:
                it["date"], it["date_source"] = created.date().isoformat(), "article_created"

    new = st.merge(state, items, now, retention_days, max_group)
    feed_items = st.latest(state, max_items)
    xml = rss.build_rss(cfg, feed_items, st.parse_iso(state["updated"]), base_url)
    if not dry_run:
        st.write_atomic(os.path.join(out_dir, "%s.xml" % cfg.code), xml)
        st.save_state(state_path, state)
    return {"lang": cfg.code, "scraped": len(items), "new": len(new), "in_feed": len(feed_items),
            "requests": client.requests, "items": feed_items, "xml": xml}
