"""Parser for the daily pages of the portal.

It returns plain dicts ("raw items") with these keys:
  text, html (inline HTML for the description), title, date (datetime.date),
  date_source, category, topics (the nested topic lines above the entry, outermost first:
  {label, title (first link), links: [{title, text}] (every link of the line)}),
  main_title (the outermost topic's first article, or None: the article the entry is grouped
  under), articles (list of article titles), sources (list of {name, url}), page (wiki page
  it came from).
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
        wikilinks = [(title, clean_space(a.text())) for a in links if not _is_external(a)
                     for title in [_wiki_title(a)]
                     if title and title.split(":")[0] not in cfg.ignore_namespaces]
        wiki = [title for title, _ in wikilinks]
        text = clean_space(li.text(_skip_lists_and_sources))
        if sublists:
            topic = {"label": clean_space(li.text(_skip_lists)), "titles": wiki,
                     "links": [{"title": title, "text": label} for title, label in wikilinks]}
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
        "topics": [{"label": t["label"], "title": t["titles"][0] if t["titles"] else None, "links": t["links"]}
                   for t in topics],
        # The outermost topic with an article is what the entry is grouped under: entries
        # nested several levels deep are all part of that top-level story.
        "main_title": next((t["titles"][0] for t in topics if t["titles"]), None),
        "articles": topic_titles + wiki,
        "sources": sources,
        "page": page_title,
    }


# --- "Topics in the news" (the highlighted items of the portal's main page) -------------------

TOPICS_CATEGORY = "Topics in the news"

# "(pictured)", "(rendering shown)": remarks about the box's picture, meaningless without it.
_PICTURE_NOTE = re.compile(r"\s*\([^()<]*\b(?:pictured|shown)\b[^()<]*\)", re.I)
_PICTURE_NOTE_HTML = re.compile(r"\s*<i>\s*\([^()<]*\b(?:pictured|shown)\b[^()<]*\)\s*</i>", re.I)


def parse_topics_html(markup, cfg, page_title):
    """The items of the "Topics in the news" box of the portal's main page (not of a day).

    They are not tied to a day: they highlight stories, and have no date of their own (the moment
    they are first seen stands for it). Same keys as parse_daily_html's items, plus "kind": "topic".
    The article of an item is the first one linked in bold. The box's footer ("Ongoing", "Recent
    deaths") is not an item.
    """
    root = parse_html(markup)
    block = root.find("div", "p-current-events-headlines")
    lists = block.child_elements("ul") if block else []
    items = []
    for li in lists[0].child_elements("li") if lists else []:
        def wiki_titles(nodes):
            return [t for a in nodes if not _is_external(a) for t in [_wiki_title(a)]
                    if t and t.split(":")[0] not in cfg.ignore_namespaces]
        html = _PICTURE_NOTE_HTML.sub("", inline_html(li, cfg.host))
        text = _PICTURE_NOTE.sub("", clean_space(li.text()))
        if not text:
            continue
        bold = wiki_titles(a for b in li.find_all("b") for a in b.find_all("a"))
        titles = wiki_titles(li.find_all("a"))
        items.append({
            "text": text,
            "html": clean_space(_PICTURE_NOTE.sub("", html)),
            "title": first_sentence(text),
            "date": None,
            "date_source": "first_seen",
            "category": TOPICS_CATEGORY,
            "topics": [],
            "main_title": (bold or titles or [None])[0],
            "articles": titles,
            "sources": [],
            "page": page_title,
            "kind": "topic",
        })
    return items
