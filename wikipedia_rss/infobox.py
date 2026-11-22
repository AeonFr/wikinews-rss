"""The map and the location of a story's article, read from the infobox of its lead section.

Only two things are taken from the infobox of an article (the first one in the lead):
- its Kartographer map (`<a data-mw-kartographer="mapframe"><img src="https://maps.wikimedia.org/...">`),
  which is only linked (the website hotlinks the static image), never downloaded here;
- the text of its "Location" row.
Maps given as ordinary images, or with {{location map}}, are ignored.

What was found is kept in `state/articles.json`, per article URL, with the moment it was checked, so
an article costs one request, is looked at again rarely, and the failures are not remembered (they
are retried in a later run).
"""
import datetime
import html.parser
import json
import logging
import re
import time
import urllib.error
import urllib.parse

from . import config, limits
from .client import ApiError, MaxLag

log = logging.getLogger(__name__)

MAP_HOST = "maps.wikimedia.org"
MAX_LOCATION = 200      # characters of the Location row that are kept
MAX_SIZE = 2000         # a map image bigger than this (in pixels) is not believed
FAILURES_TO_STOP = 3    # a run gives up after this many fetch errors in a row (the site is down)

_SEP = "\x00"           # marks where a list item or a line break was
_LOCATION_LABELS = ("location", "locations")


def map_url(value):
    """An absolute https URL of an image of maps.wikimedia.org, or None for anything else."""
    value = (value or "").strip()
    if value.startswith("//"):
        value = "https:" + value
    parts = urllib.parse.urlparse(value)
    if parts.scheme != "https" or parts.hostname != MAP_HOST or parts.username or parts.port:
        return None
    return value


def _size(*values):
    for v in values:
        if v and str(v).strip().isdigit() and 0 < int(v) <= MAX_SIZE:
            return int(v)
    return None


def _srcset_2x(srcset):
    """The URL of the "2x" candidate of a srcset attribute, if there is a valid one."""
    for candidate in (srcset or "").split(", "):
        parts = candidate.split()
        if len(parts) == 2 and parts[1] == "2x":
            return map_url(parts[0])
    return None


def _clip(text, limit=MAX_LOCATION):
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


class _InfoboxParser(html.parser.HTMLParser):
    """Looks for the map and the Location row inside the first infobox."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.map = None
        self.location = None
        self._table = 0        # depth of tables inside the infobox (0: not in it)
        self._done = False     # the first infobox has been read
        self._in_map = None    # attributes of the mapframe link being read
        self._label = None     # text of the <th> being read
        self._row_is_location = False
        self._cell = 0         # depth of <td> being collected as the location (0: none)
        self._text = []
        self._skip = None      # (tag, depth) of an element whose text is not content

    @staticmethod
    def _hidden(tag, attrs):
        style = (dict(attrs).get("style") or "").replace(" ", "").lower()
        return tag in ("style", "script", "sup") or "display:none" in style

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self._done:
            return
        if not self._table:
            if tag == "table" and "infobox" in (a.get("class") or "").split():
                self._table = 1
            return
        if tag == "table":
            self._table += 1
        elif tag == "a":
            self._in_map = a if a.get("data-mw-kartographer") == "mapframe" else None
        elif tag == "img" and self._in_map and self.map is None:
            self.map = self._read_map(a, self._in_map)
        elif tag == "tr":
            self._row_is_location = False
        elif tag == "th":
            self._label = []
        elif tag == "td" and self._row_is_location and self.location is None and not self._cell:
            self._cell, self._text = 1, []
        elif tag == "td" and self._cell:
            self._cell += 1
        if self._cell:
            if self._skip:
                if tag == self._skip[0]:
                    self._skip = (tag, self._skip[1] + 1)
            elif self._hidden(tag, attrs):
                self._skip = (tag, 1)
            elif tag in ("li", "br", "p"):
                self._text.append(_SEP)

    def handle_endtag(self, tag):
        if self._done or not self._table:
            return
        if self._skip and tag == self._skip[0]:
            depth = self._skip[1] - 1
            self._skip = (tag, depth) if depth else None
        if tag == "table":
            self._table -= 1
            if not self._table:
                self._done = True
        elif tag == "a":
            self._in_map = None
        elif tag == "th" and self._label is not None:
            label = re.sub(r"\s+", " ", "".join(self._label)).strip().lower()
            self._row_is_location = label in _LOCATION_LABELS
            self._label = None
        elif tag == "td" and self._cell:
            self._cell -= 1
            if not self._cell:
                self.location = self._finish_location()

    def handle_data(self, data):
        if self._label is not None:
            self._label.append(data)
        elif self._cell and not self._skip:
            self._text.append(data)

    def _finish_location(self):
        pieces = [re.sub(r"\s+", " ", p).strip() for p in "".join(self._text).split(_SEP)]
        text = "; ".join(p for p in pieces if p)
        text = re.sub(r"\s+([,;.])", r"\1", text)
        return _clip(text) or None

    @staticmethod
    def _read_map(a, link):
        url = map_url(a.get("src"))
        width = _size(a.get("width"), link.get("data-width"))
        height = _size(a.get("height"), link.get("data-height"))
        if not (url and width and height):
            return None
        found = {"url": url, "width": width, "height": height}
        url2x = _srcset_2x(a.get("srcset"))
        if url2x:
            found["url2x"] = url2x
        return found


def parse_infobox(text):
    """{"map": {url, url2x?, width, height}?, "location": str?} of the first infobox of an HTML page."""
    parser = _InfoboxParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception:  # broken markup: use what was read so far
        pass
    found = {}
    if parser.location:
        found["location"] = parser.location
    if parser.map:
        found["map"] = parser.map
    return found


def is_throttled(error):
    """True for the answers that mean "stop asking": HTTP 429/503 or maxlag."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (429, 503)
    return isinstance(error, MaxLag) or (isinstance(error, ApiError) and error.code == "maxlag")


def fetch_infobox(client, title):
    """What parse_infobox finds in the lead section of an article; {} if it has nothing or does not exist.

    Raises on errors that say nothing about the article (network, API), so they are not stored.
    """
    try:
        # retries=0: one attempt, never the long waits of the normal retry policy (this is optional data)
        data = client.api(retries=0, action="parse", page=title, prop="text", section="0",
                          redirects="1", disablelimitreport="1")
    except ApiError as e:
        if e.code == "missingtitle":
            return {}
        raise
    return parse_infobox(data["parse"]["text"])


# --- Cache -------------------------------------------------------------------------

def load_cache(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("articles", {})
    except FileNotFoundError:
        return {}


def dump_cache(cache):
    return json.dumps({"articles": cache}, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def _iso(now):
    return now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _due(entry, now):
    if entry is None:
        return True
    days = config.ARTICLE_RECHECK_DAYS_MAP if "map" in entry else config.ARTICLE_RECHECK_DAYS_NO_MAP
    checked = datetime.datetime.strptime(entry["checked"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    return now - checked >= datetime.timedelta(days=days)


def update_cache(cache, articles, client, now, max_fetch=limits.MAX_ARTICLE_FETCHES, delay=0, sleep=time.sleep,
                 budget=limits.ARTICLE_FETCH_BUDGET, clock=time.monotonic):
    """Fetch the infobox of the articles that are due, update `cache` (url -> record) in place.

    articles: [{"title", "url"}], the ones in use, newest first. Records of other articles are
    dropped. The ones never checked go first, then the ones checked longest ago; at most
    `max_fetch` per run, so a backlog fills over several runs. A failed fetch leaves the record
    as it was (or none). The phase stops early, keeping what it has: at once when Wikipedia throttles
    (429/503/maxlag), after FAILURES_TO_STOP errors in a row, or when `budget` seconds of `clock()`
    have passed. Returns {"fetched", "found", "failed", "pending", "stopped"}; "stopped" is None,
    "throttled", "errors" or "budget".
    """
    by_url = {}
    for a in articles:
        by_url.setdefault(a["url"], a["title"])
    for gone in set(cache) - set(by_url):
        del cache[gone]
    due = [u for u in by_url if _due(cache.get(u), now)]
    due.sort(key=lambda u: cache[u]["checked"] if u in cache else "")  # stable: never checked first
    stats = {"fetched": 0, "found": 0, "failed": 0, "pending": 0, "stopped": None}
    started = clock()
    streak = 0
    for url in due[:max_fetch]:
        if streak >= FAILURES_TO_STOP:
            log.warning("article maps: stopping after %d failures in a row", streak)
            stats["stopped"] = "errors"
            break
        if stats["fetched"] + stats["failed"] and delay:
            sleep(delay)
        if clock() - started >= budget:
            log.info("article maps: time budget of %ds used up after %d articles, the rest waits for the next run",
                     budget, stats["fetched"])
            stats["stopped"] = "budget"
            break
        try:
            found = fetch_infobox(client, by_url[url])
        except Exception as e:  # optional data: never fail the run because of it
            if is_throttled(e):
                log.warning("article maps: Wikipedia is throttling (%s); stopping after %d articles, "
                            "the rest waits for the next run", e, stats["fetched"])
                stats["stopped"] = "throttled"
                break
            log.warning("article map of %s not fetched: %s", by_url[url], e)
            stats["failed"] += 1
            streak += 1
            continue
        streak = 0
        stats["fetched"] += 1
        stats["found"] += bool(found)
        cache[url] = dict(found, checked=_iso(now))
    stats["pending"] = len(due) - stats["fetched"]
    return stats


def story_info(cache, url):
    """{"location"?, "map"?} stored for an article URL (empty if none)."""
    entry = (cache or {}).get(url) or {}
    return {k: entry[k] for k in ("location", "map") if k in entry}
