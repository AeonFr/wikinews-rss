"""Link previews for the sources cited by the news: title, description and image.

The news sites are not crawlable in any common way, so nothing here is specific to a
site: the page's own Open Graph / Twitter card tags (what sites publish for link
previews) are read, with `<title>` and `<meta name="description">` as fallbacks. A
source whose page can't be fetched or has no title simply has no preview.

Results are kept in two files:
- `state/sources.json`: everything known per URL, including failures and when they
  were tried, so a source is fetched once and a failing one a limited number of times.
- `data/sources.json`: what the website reads, only the previews found for URLs that
  are still in `data/news.json`.
"""
import concurrent.futures
import datetime
import html
import html.parser
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib

log = logging.getLogger(__name__)

MAX_BYTES = 300_000        # only the <head> is needed
TIMEOUT = 10               # seconds per request
MAX_ATTEMPTS = 3           # a failing source is tried this many times in total...
RETRY_AFTER = datetime.timedelta(days=1)   # ...at least this far apart
HOST_DELAY = 1.0           # seconds between two requests to the same site
MAX_FETCH = 150            # fetches per run; the rest waits for the next one
DEADLINE = 600             # seconds; a run stops starting new fetches after this
WORKERS = 8

# Titles that sites serve to bots instead of the real page.
BLOCK_TITLES = ("just a moment", "attention required", "access denied", "are you a robot",
                "robot or human", "captcha", "403 forbidden", "404 not found", "page not found",
                "enable javascript", "verify you are human", "security check")


def _clean(text, limit):
    # Some sites escape their meta content twice ("&amp;rsquo;"), which shows up as text.
    text = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


class _Done(Exception):
    pass


class _MetaParser(html.parser.HTMLParser):
    """Collects <meta> tags and the <title>; stops at the end of <head>."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            a = dict(attrs)
            key = (a.get("property") or a.get("name") or "").lower()
            content = a.get("content")
            if key and content is not None:
                self.meta.setdefault(key, content)
        elif tag == "title" and not self.title:
            self._in_title = True
        elif tag == "body":
            raise _Done

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            raise _Done

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def parse_preview(text, base_url):
    """{"title", "description", "image", "site"} found in an HTML page, or None without a title."""
    parser = _MetaParser()
    try:
        parser.feed(text)
        parser.close()
    except _Done:
        pass
    except Exception:  # broken markup: use what was read so far
        pass
    m = parser.meta
    title = _clean(m.get("og:title") or m.get("twitter:title") or parser.title, 300)
    if not title or any(b in title.lower() for b in BLOCK_TITLES):
        return None
    preview = {"title": title}
    description = _clean(m.get("og:description") or m.get("twitter:description") or m.get("description"), 400)
    if description:
        preview["description"] = description
    image = (m.get("og:image") or m.get("og:image:url") or m.get("twitter:image") or "").strip()
    if image:
        image = urllib.parse.urljoin(base_url, image)
        if urllib.parse.urlparse(image).scheme in ("http", "https"):
            preview["image"] = image
    site = _clean(m.get("og:site_name"), 100)
    if site:
        preview["site"] = site
    return preview


def decode_html(body, content_type=""):
    """Page bytes -> text, using the charset of the header, then of a <meta>, else UTF-8."""
    match = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    if not match:
        match = re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", body[:4096], re.I)
        charset = match.group(1).decode("ascii", "ignore") if match else "utf-8"
    else:
        charset = match.group(1)
    try:
        return body.decode(charset, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


class Fetcher:
    """Fetches the preview of a URL, honouring the site's robots.txt.

    Called as `fetcher(url)`, returns `(preview, reason)`: the preview dict, or None and
    a short reason. Thread-safe.
    """

    def __init__(self, user_agent, timeout=TIMEOUT, urlopen=urllib.request.urlopen):
        self.user_agent = user_agent
        self.timeout = timeout
        self.urlopen = urlopen
        self._robots = {}
        self._lock = threading.Lock()

    def _get(self, url, accept):
        req = urllib.request.Request(url, headers={
            "User-Agent": self.user_agent,
            "Accept": accept,
            "Accept-Language": "en",
            "Accept-Encoding": "identity",
        })
        with self.urlopen(req, timeout=self.timeout) as resp:
            body = resp.read(MAX_BYTES)
            headers = resp.headers
        if headers.get("Content-Encoding") == "gzip":  # asked for identity, but some send gzip anyway
            body = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(body)
        return body, headers.get("Content-Type") or ""

    def _allowed(self, url):
        parts = urllib.parse.urlparse(url)
        origin = "%s://%s" % (parts.scheme, parts.netloc)
        with self._lock:
            parser = self._robots.get(origin)
        if parser is None:
            parser = urllib.robotparser.RobotFileParser()
            try:
                body, ctype = self._get(origin + "/robots.txt", "text/plain")
                parser.parse(decode_html(body, ctype).splitlines())
            except Exception:  # no robots.txt, or unreachable: nothing forbids it
                parser.parse([])
            with self._lock:
                self._robots[origin] = parser
        return parser.can_fetch(self.user_agent, url)

    def __call__(self, url):
        if urllib.parse.urlparse(url).scheme not in ("http", "https"):
            return None, "not an http(s) url"
        if not self._allowed(url):
            return None, "disallowed by robots.txt"
        try:
            body, ctype = self._get(url, "text/html,application/xhtml+xml")
        except urllib.error.HTTPError as e:
            return None, "HTTP %d" % e.code
        except Exception as e:  # network errors, timeouts, bad redirects, ...
            return None, type(e).__name__
        if ctype and "html" not in ctype.lower():
            return None, "not html"
        preview = parse_preview(decode_html(body, ctype), url)
        return (preview, "") if preview else (None, "no title")


# --- Cache -------------------------------------------------------------------------

def load_cache(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("sources", {})
    except FileNotFoundError:
        return {}


def dump_cache(cache):
    return json.dumps({"sources": cache}, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def dump_data(cache, urls):
    """data/sources.json: the previews found for `urls`."""
    found = {u: cache[u]["preview"] for u in sorted(set(urls)) if u in cache and "preview" in cache[u]}
    return json.dumps({"sources": found}, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def story_image(members, cache):
    """The first image found among the sources of a story's headlines (in their order), or None.

    members: the story's headlines; cache: URL -> cache entry, as in load_cache. Returns
    {"url", "source" (the outlet's name), "link" (the source page the image comes from)}.
    """
    for m in members:
        for src in m.get("sources", []):
            preview = (cache or {}).get(src["url"], {}).get("preview") or {}
            if preview.get("image"):
                return {"url": preview["image"], "source": src.get("name") or preview.get("site") or "",
                        "link": src["url"]}
    return None


def featured_image(members, cache):
    """story_image, but only for the stories that are featured: those with several headlines
    (grouped) and those straight from the portal (no Wikipedia article). A story with a
    single headline and an article gets none.
    """
    if len(members) == 1 and any(m.get("pageid") for m in members):
        return None
    return story_image(members, cache)


def _iso(now):
    return now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _due(entry, now):
    if entry is None:
        return True
    if "preview" in entry or entry.get("fails", 0) >= MAX_ATTEMPTS:
        return False
    checked = datetime.datetime.strptime(entry["checked"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    return now - checked >= RETRY_AFTER


def update_cache(cache, urls, now, fetch, max_fetch=MAX_FETCH, workers=WORKERS, deadline=DEADLINE,
                 host_delay=HOST_DELAY, sleep=time.sleep):
    """Fetch the previews that are due, newest `urls` first; update `cache` in place.

    Entries for URLs not in `urls` (news that was deleted) are dropped. Requests go to
    different sites in parallel, but to one site one at a time, `host_delay` apart.
    Returns {"fetched", "found", "failed"}.
    """
    urls = list(dict.fromkeys(urls))
    for gone in set(cache) - set(urls):
        del cache[gone]
    todo = [u for u in urls if _due(cache.get(u), now)][:max_fetch]
    by_host = {}
    for u in todo:
        by_host.setdefault(urllib.parse.urlparse(u).netloc, []).append(u)
    stop_at = time.monotonic() + deadline

    def work(host_urls):
        results = []
        for i, u in enumerate(host_urls):
            if time.monotonic() > stop_at:
                break
            if i:
                sleep(host_delay)
            results.append((u,) + tuple(fetch(u)))
        return results

    stats = {"fetched": 0, "found": 0, "failed": 0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        batches = list(pool.map(work, by_host.values()))
    for batch in batches:
        for u, preview, reason in batch:
            stats["fetched"] += 1
            if preview:
                cache[u] = {"preview": preview, "checked": _iso(now)}
                stats["found"] += 1
            else:
                cache[u] = {"fails": cache.get(u, {}).get("fails", 0) + 1, "checked": _iso(now), "error": reason}
                stats["failed"] += 1
                log.debug("no preview for %s (%s)", u, reason)
    return stats
