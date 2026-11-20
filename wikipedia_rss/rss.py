"""RSS 2.0 writer."""
import html
import xml.etree.ElementTree as ET
from email.utils import format_datetime

from .config import LICENSE_NAME, LICENSE_URL
from .site import story_url
from .sources import featured_image
from .state import parse_iso

ATOM = "http://www.w3.org/2005/Atom"
MEDIA = "http://search.yahoo.com/mrss/"
ET.register_namespace("atom", ATOM)
ET.register_namespace("media", MEDIA)


def _link(url, label):
    return '<a href="%s">%s</a>' % (html.escape(url), html.escape(label, quote=False))


def _sources(item, s):
    return "<p>%s: %s</p>" % (s["sources"], ", ".join(
        _link(src["url"], src["name"] or src["url"]) for src in item["sources"]))


def _topic_links(t, cfg):
    """A topic line: a link per article it mentions (older state: its label and first article)."""
    if t.get("links"):
        return ", ".join(_link(cfg.url(link["title"]), link["text"] or link["title"]) for link in t["links"])
    return _link(cfg.url(t["title"]), t["label"])


def _topics(item, cfg):
    topics = [t for t in item.get("topics", []) if t.get("title")]
    return "<p>%s: %s</p>" % (cfg.strings["topics"], " › ".join(
        _topic_links(t, cfg) for t in topics)) if topics else None


def _attribution(page, cfg):
    return "<p><small>%s</small></p>" % cfg.strings["attribution"].format(
        page=_link(cfg.url(page), page),
        history=_link(cfg.history_url(page), cfg.strings["history"]),
        license=_link(LICENSE_URL, LICENSE_NAME))


def _image(image):
    """The image of a story's source, with where it comes from."""
    return '<p><a href="%s"><img src="%s" alt=""></a><br><small>%s</small></p>' % (
        html.escape(image["link"]), html.escape(image["url"]),
        html.escape("Image: %s" % image["source"] if image["source"] else "Image", quote=False))


def item_description(item, cfg, image=None):
    """One headline: text, sources, topics, attribution.

    A group lists each headline with its sources (in title order), then the topics once,
    and an attribution line per portal page used.
    """
    s = cfg.strings
    members = item.get("members") or [item]
    lead = [_image(image)] if image else []
    if len(members) == 1:
        it = members[0]
        parts = lead + ["<p>%s</p>" % it["html"]]
        if it.get("sources"):
            parts.append(_sources(it, s))
        parts.append(_topics(it, cfg))
        parts.append(_attribution(it["page"], cfg))
        return "\n".join(p for p in parts if p)
    parts = list(lead)
    for it in members:
        parts.append("<p>%s</p>" % it["html"])
        if it.get("sources"):
            parts.append(_sources(it, s))
    # The topics of each headline, once each: they differ when the group's headlines are
    # nested under different sub-topics of the same article.
    parts += list(dict.fromkeys(t for t in (_topics(it, cfg) for it in members) if t))
    parts += [_attribution(page, cfg) for page in dict.fromkeys(it["page"] for it in members)]
    return "\n".join(p for p in parts if p)


def _categories(item):
    cats = []
    for it in item.get("members") or [item]:
        cats.append(it.get("category"))
        if it.get("topics"):
            cats.append(it["topics"][-1]["label"])
    return [c for i, c in enumerate(cats) if c and c not in cats[:i]]


def build_rss(cfg, items, last_build, site_url=None, previews=None):
    """last_build: time of the last real change (not the run time), so that an
    unchanged feed is byte-for-byte identical between runs.

    With site_url (the website's root URL) each item links to its story page there, which
    lists every headline of the item in full; without it, to the Wikipedia article.
    previews (the source cache, see sources.load_cache) adds the image of the first source that
    has one to the grouped items and to those straight from the portal (not to the others).
    """
    portal_url = site_url or cfg.url(cfg.portal)
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
        cfg.history_url(cfg.portal)))
    sub(ch, "language", cfg.code)
    sub(ch, "copyright", cfg.strings["copyright"])
    sub(ch, "lastBuildDate", format_datetime(last_build, usegmt=True))
    sub(ch, "generator", "wikipedia-noticias-rss")
    sub(ch, "docs", "https://www.rssboard.org/rss-specification")
    sub(ch, "ttl", "60")
    if site_url:
        sub(ch, "{%s}link" % ATOM, href="%s/feeds/%s.xml" % (site_url.rstrip("/"), cfg.code),
            rel="self", type="application/rss+xml")

    for it in items:
        el = sub(ch, "item")
        sub(el, "title", it["title"])
        sub(el, "link", story_url(site_url, it["guid"]) if site_url else it["link"])
        image = featured_image(it.get("members") or [it], previews)
        sub(el, "description", item_description(it, cfg, image))
        sub(el, "guid", it["guid"], isPermaLink="false")
        sub(el, "pubDate", format_datetime(parse_iso(it["pub_date"]), usegmt=True))
        for cat in _categories(it):
            sub(el, "category", cat)
        if image:
            sub(el, "{%s}content" % MEDIA, url=image["url"], medium="image")
    ET.indent(rss)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(rss, encoding="unicode") + "\n"
