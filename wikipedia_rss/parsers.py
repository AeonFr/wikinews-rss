"""Parser for the daily pages of the portal.

It returns plain dicts ("raw items") with these keys:
  text, html (inline HTML for the description), title, date (datetime.date),
  date_source, category, topics (list of {title, label}), main_title (article or None),
  articles (list of article titles), sources (list of {name, url}), page (wiki page it came from).
"""
import datetime
import hashlib
import html as htmllib
import re
from html.parser import HTMLParser

from urllib.parse import unquote

# --- tiny DOM over html.parser -------------------------------------------------

VOID_TAGS = {"br", "img", "hr", "meta", "link", "input", "wbr", "source", "col", "area"}


class Node:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.parent = parent

    @property
    def classes(self):
        return set((self.attrs.get("class") or "").split())

    def iter(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.iter()

    def find_all(self, tag=None, cls=None):
        return [n for n in self.iter()
                if (tag is None or n.tag == tag) and (cls is None or cls in n.classes)]

    def find(self, tag=None, cls=None):
        found = self.find_all(tag, cls)
        return found[0] if found else None

    def child_elements(self, tag=None):
        return [c for c in self.children if isinstance(c, Node) and (tag is None or c.tag == tag)]

    def text(self, skip=lambda n: False):
        out = []
        for c in self.children:
            if isinstance(c, str):
                out.append(c)
            elif c.tag not in ("style", "script") and not skip(c):
                out.append(c.text(skip))
        return "".join(out)


class _TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID_TAGS:
            self.cur = node

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:  # ignore stray end tags
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse_html(markup):
    b = _TreeBuilder()
    b.feed(markup)
    b.close()
    return b.root


# --- text helpers ---------------------------------------------------------------

def clean_space(s):
    return re.sub(r"\s+", " ", s.replace("\u200b", "")).strip()


def text_hash(text):
    norm = " ".join(re.findall(r"\w+", text.lower()))
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


_ABBREV = re.compile(r"(?:\b[A-Z]\.)+$|\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|No|Gen|Lt|Col|Sen|Rep|Gov|Inc|Corp|Sra)\.$")


def first_sentence(text, limit=200):
    """Headline from a news sentence: first sentence, cut at `limit` chars."""
    for m in re.finditer(r"[.!?][\"”']?\s+(?=[A-Z0-9\"“¿¡])", text):
        if not _ABBREV.search(text[:m.start() + 1]):
            text = text[:m.start() + 1]
            break
    return truncate(text, limit)


def truncate(text, limit):
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


# --- dates ----------------------------------------------------------------------

def daily_page_title(cfg, date):
    return cfg.daily_title.format(year=date.year, month=cfg.month_names[date.month - 1], day=date.day)


# --- daily pages (Portal:Current events/YYYY Month D, rendered HTML) -------------

def _is_external(a):
    return "external" in a.classes


def _wiki_title(a):
    href = a.attrs.get("href", "")
    if not href.startswith("/wiki/"):
        return None
    return a.attrs.get("title") or unquote(href[6:].split("#")[0]).replace("_", " ")


def inline_html(node, host, skip=lambda n: False):
    """Serialise a node keeping only links and basic emphasis, with absolute URLs."""
    out = []
    for c in node.children:
        if isinstance(c, str):
            out.append(htmllib.escape(c, quote=False))
        elif c.tag in ("style", "script") or skip(c):
            continue
        elif c.tag == "a" and c.attrs.get("href"):
            href = c.attrs["href"]
            if href.startswith("//"):
                href = "https:" + href
            elif href.startswith("/"):
                href = "https://" + host + href
            out.append('<a href="%s">%s</a>' % (htmllib.escape(href), inline_html(c, host, skip)))
        elif c.tag in ("i", "b", "em", "strong"):
            out.append("<%s>%s</%s>" % (c.tag, inline_html(c, host, skip), c.tag))
        else:
            out.append(inline_html(c, host, skip))
    return "".join(out)


def _skip_lists(n):
    return n.tag in ("ul", "ol")


def _skip_lists_and_sources(n):
    return n.tag in ("ul", "ol") or (n.tag == "a" and _is_external(n))


def _own_links(li):
    """Links in an li excluding nested lists."""
    links = []
    stack = [c for c in li.children if isinstance(c, Node)]
    while stack:
        n = stack.pop(0)
        if n.tag in ("ul", "ol"):
            continue
        if n.tag == "a":
            links.append(n)
        else:
            stack[0:0] = [c for c in n.children if isinstance(c, Node)]
    return links


def parse_daily_html(markup, cfg, page_date, page_title):
    """Leaf news items from a rendered day page."""
    root = parse_html(markup)
    items = []
    for block in root.find_all("div", "current-events-main") or [root]:
        date = page_date
        bday = block.find("span", "bday")
        if bday:
            try:
                date = datetime.date.fromisoformat(bday.text().strip())
            except ValueError:
                pass
        content = block.find("div", "current-events-content") or block
        category = None
        for el in content.child_elements():
            if el.tag == "p" and el.find("b"):
                category = clean_space(el.text())
            elif el.tag == "ul" and not _skipped(category, cfg.skip_sections):
                _walk_list(el, [], category, date, cfg, page_title, items)
    return items


def _skipped(section, skip_sections):
    s = (section or "").lower()
    return any(s.startswith(x.lower()) for x in skip_sections)


def _walk_list(ul, topics, category, date, cfg, page_title, items):
    for li in ul.child_elements("li"):
        links = _own_links(li)
        sublists = li.child_elements("ul")
        sources = [{"name": clean_space(a.text()).strip("()"), "url": a.attrs.get("href", "")}
                   for a in links if _is_external(a)]
        wiki = [t for t in (_wiki_title(a) for a in links if not _is_external(a)) if t]
        wiki = [t for t in wiki if t.split(":")[0] not in cfg.ignore_namespaces]
        text = clean_space(li.text(_skip_lists_and_sources))
        if sublists:
            topic = {"label": clean_space(li.text(_skip_lists)), "titles": wiki}
            if sources:  # a topic line that is itself a news item
                items.append(_daily_item(li, text, wiki, sources, topics, category, date, cfg, page_title))
            for sub in sublists:
                _walk_list(sub, topics + [topic], category, date, cfg, page_title, items)
        elif text and (sources or len(text) >= 40):
            items.append(_daily_item(li, text, wiki, sources, topics, category, date, cfg, page_title))


def _daily_item(li, text, wiki, sources, topics, category, date, cfg, page_title):
    topic_titles = [t for topic in topics for t in topic["titles"]]
    return {
        "text": text,
        "html": clean_space(inline_html(li, cfg.host, _skip_lists_and_sources)),
        "title": first_sentence(text),
        "date": date,
        "date_source": "page_date",
        "category": category,
        "topics": [{"label": t["label"], "title": t["titles"][0] if t["titles"] else None} for t in topics],
        # The innermost topic is the story this item belongs to.
        "main_title": topics[-1]["titles"][0] if topics and topics[-1]["titles"] else None,
        "articles": topic_titles + wiki,
        "sources": sources,
        "page": page_title,
    }
