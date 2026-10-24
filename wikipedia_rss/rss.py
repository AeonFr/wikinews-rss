"""RSS 2.0 writer."""
import html
import xml.etree.ElementTree as ET
from email.utils import format_datetime

from .config import LICENSE_NAME, LICENSE_URL
from .state import parse_iso

ATOM = "http://www.w3.org/2005/Atom"
ET.register_namespace("atom", ATOM)


def _link(url, label):
    return '<a href="%s">%s</a>' % (html.escape(url), html.escape(label, quote=False))


def item_description(item, cfg):
    s = cfg.strings
    parts = ["<p>%s</p>" % item["html"]]
    if item.get("extract"):
        parts.append("<p>%s</p>" % html.escape(item["extract"], quote=False))
    if item.get("sources"):
        parts.append("<p>%s: %s</p>" % (s["sources"], ", ".join(
            _link(src["url"], src["name"] or src["url"]) for src in item["sources"])))
    topics = [t for t in item.get("topics", []) if t.get("title")]
    if topics:
        parts.append("<p>%s: %s</p>" % (s["topics"], " › ".join(
            _link(cfg.url(t["title"]), t["label"]) for t in topics)))
    page = item["page"]
    parts.append("<p><small>%s</small></p>" % s["attribution"].format(
        page=_link(cfg.url(page), page),
        history=_link(cfg.history_url(page), s["history"]),
        license=_link(LICENSE_URL, LICENSE_NAME)))
    return "\n".join(parts)


def _categories(item):
    cats = [item.get("category")]
    if item.get("topics"):
        cats.append(item["topics"][-1]["label"])
    return [c for i, c in enumerate(cats) if c and c not in cats[:i]]


def build_rss(cfg, items, last_build, base_url=None):
    """last_build: time of the last real change (not the run time), so that an
    unchanged feed is byte-for-byte identical between runs."""
    portal_url = cfg.url(cfg.portal)
    rss = ET.Element("rss", {"version": "2.0"})
    ch = ET.SubElement(rss, "channel")

    def sub(parent, tag, text=None, **attrs):
        el = ET.SubElement(parent, tag, attrs)
        if text is not None:
            el.text = text
        return el

    sub(ch, "title", cfg.strings["title"])
    sub(ch, "link", portal_url)
    sub(ch, "description", "%s %s (%s: %s)" % (
        cfg.strings["description"], cfg.strings["copyright"], cfg.strings["history"],
        cfg.history_url(cfg.list_page or cfg.portal)))
    sub(ch, "language", cfg.code)
    sub(ch, "copyright", cfg.strings["copyright"])
    sub(ch, "lastBuildDate", format_datetime(last_build, usegmt=True))
    sub(ch, "generator", "wikipedia-noticias-rss")
    sub(ch, "docs", "https://www.rssboard.org/rss-specification")
    sub(ch, "ttl", "60")
    if base_url:
        sub(ch, "{%s}link" % ATOM, href="%s/%s.xml" % (base_url.rstrip("/"), cfg.code),
            rel="self", type="application/rss+xml")

    for it in items:
        el = sub(ch, "item")
        sub(el, "title", it["title"])
        sub(el, "link", it["link"])
        sub(el, "description", item_description(it, cfg))
        sub(el, "guid", it["guid"], isPermaLink="false")
        sub(el, "pubDate", format_datetime(parse_iso(it["pub_date"]), usegmt=True))
        for cat in _categories(it):
            sub(el, "category", cat)
    ET.indent(rss)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(rss, encoding="unicode") + "\n"
