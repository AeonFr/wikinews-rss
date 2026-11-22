import datetime
import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock

from wikipedia_rss import feed, infobox, limits
from wikipedia_rss.client import ApiError, MaxLag, WikiClient
from wikipedia_rss.config import WIKI

from helpers import FakeClient, fixture
from test_feed import NOW, en_client

MAP = "https://maps.wikimedia.org/img/osm-intl,4,a,a,270x200.png?lang=en&domain=en.wikipedia.org"


def lead(rows="", map_img=None, location=None, infobox_class="infobox vevent"):
    """A lead section with an infobox: `rows` first, then a map (an <img> tag) and a Location cell."""
    body = rows
    if map_img:
        body += ('<tr><td colspan="2"><a class="mw-kartographer-map" data-mw-kartographer="mapframe" '
                 'data-width="270" data-height="200">%s</a></td></tr>' % map_img)
    if location is not None:
        body += '<tr><th scope="row" class="infobox-label">Location</th><td class="infobox-data">%s</td></tr>' % location
    return '<div><table class="%s"><tbody>%s</tbody></table><p>Text.</p></div>' % (infobox_class, body)


def img(src=MAP.replace("&", "&amp;"), extra=' width="270" height="200"'):
    return '<img src="%s"%s alt="Map" />' % (src, extra)


class ParseTest(unittest.TestCase):
    def test_map_and_location_of_a_real_infobox(self):
        found = infobox.parse_infobox(fixture("en_lead_infobox_map.html"))
        self.assertEqual(found["location"], "Strait of Hormuz, Persian Gulf, and Gulf of Oman")
        m = found["map"]
        self.assertEqual((m["width"], m["height"]), (270, 200))
        # Entities are decoded; the ordinary image of the infobox (a PNG on Commons) is not a map.
        self.assertTrue(m["url"].startswith("https://maps.wikimedia.org/img/osm-intl,4,a,a,270x200.png?lang=en&domain=en.wikipedia.org&title="))
        self.assertIn("&parser=legacy", m["url"])
        self.assertNotIn("&amp;", m["url"])
        self.assertTrue(m["url2x"].startswith("https://maps.wikimedia.org/img/osm-intl,4,a,a,270x200@2x.png?"))
        self.assertEqual(set(found), {"map", "location"})
        self.assertEqual(set(m), {"url", "url2x", "width", "height"})

    def test_only_a_location_or_only_a_map_or_neither(self):
        self.assertEqual(infobox.parse_infobox(lead(location="Gaza Strip")), {"location": "Gaza Strip"})
        only_map = infobox.parse_infobox(lead(map_img=img()))
        self.assertEqual(only_map, {"map": {"url": MAP, "width": 270, "height": 200}})
        self.assertEqual(infobox.parse_infobox(lead(rows="<tr><td>x</td></tr>")), {})
        self.assertEqual(infobox.parse_infobox("<p>No infobox at all.</p>"), {})
        self.assertEqual(infobox.parse_infobox(""), {})

    def test_location_text_is_flattened(self):
        cell = ('<style>.x{color:red}</style><div class="plainlist"><ul><li><a href="/wiki/Gaza">Gaza</a> Strip</li>'
                '<li>Southern <b>Israel</b><sup class="reference">[1]</sup></li></ul></div>'
                '<span style="display: none;">hidden</span>')
        self.assertEqual(infobox.parse_infobox(lead(location=cell))["location"], "Gaza Strip; Southern Israel")
        self.assertEqual(infobox.parse_infobox(lead(location="Kyiv<br />Lviv ,&#160;Odesa"))["location"], "Kyiv; Lviv, Odesa")
        self.assertEqual(infobox.parse_infobox(lead(location="  \n  "))  , {})

    def test_long_location_is_capped(self):
        found = infobox.parse_infobox(lead(location=" ".join(["Wordy"] * 100)))["location"]
        self.assertLessEqual(len(found), infobox.MAX_LOCATION + 1)
        self.assertTrue(found.endswith("Wordy…"))

    def test_only_the_location_row_counts(self):
        rows = '<tr><th class="infobox-label">Date</th><td>1 May</td></tr>'
        rows += '<tr><th class="infobox-label">Location of origin</th><td>Not this</td></tr>'
        self.assertEqual(infobox.parse_infobox(lead(rows=rows)), {})
        self.assertEqual(infobox.parse_infobox(lead(rows=rows, location="Here")), {"location": "Here"})

    def test_map_url_is_validated(self):
        ok = infobox.parse_infobox(lead(map_img=img("//maps.wikimedia.org/img/a.png")))
        self.assertEqual(ok["map"]["url"], "https://maps.wikimedia.org/img/a.png")   # made absolute
        for bad in ("http://maps.wikimedia.org/a.png", "https://upload.wikimedia.org/a.png",
                    "https://maps.wikimedia.org.evil.example/a.png", "https://maps.wikimedia.org@evil.example/a.png",
                    "https://evil.example/maps.wikimedia.org/a.png", "javascript:alert(1)", ""):
            self.assertEqual(infobox.parse_infobox(lead(map_img=img(bad))), {}, bad)

    def test_map_needs_valid_sizes_and_a_mapframe_link(self):
        self.assertEqual(infobox.parse_infobox(lead(map_img=img(extra=""))),
                         {"map": {"url": MAP, "width": 270, "height": 200}})  # data-width / data-height of the link
        no_sizes = ('<tr><td><a data-mw-kartographer="mapframe"><img src="%s" width="x" height="0"></a></td></tr>'
                    % MAP.replace("&", "&amp;"))
        self.assertEqual(infobox.parse_infobox(lead(rows=no_sizes)), {})
        plain = '<tr><td><a href="/wiki/File:X.png">%s</a></td></tr>' % img()
        self.assertEqual(infobox.parse_infobox(lead(rows=plain)), {})

    def test_the_2x_image_must_be_valid_too(self):
        extra = ' width="270" height="200" srcset="https://evil.example/a@2x.png 2x"'
        self.assertEqual(infobox.parse_infobox(lead(map_img=img(extra=extra)))["map"],
                         {"url": MAP, "width": 270, "height": 200})

    def test_only_the_first_infobox_is_read(self):
        first = lead(location="First")
        second = lead(location="Second", map_img=img())
        self.assertEqual(infobox.parse_infobox(first + second), {"location": "First"})
        # a map or Location outside any infobox is ignored
        self.assertEqual(infobox.parse_infobox('<a data-mw-kartographer="mapframe">%s</a>' % img()), {})
        self.assertEqual(infobox.parse_infobox(lead(location="X", infobox_class="wikitable")), {})

    def test_nested_tables_do_not_end_the_infobox(self):
        nested = '<tr><td><table><tr><td>x</td></tr></table></td></tr>'
        self.assertEqual(infobox.parse_infobox(lead(rows=nested, location="After")), {"location": "After"})


def article(title):
    return {"title": title, "url": "https://example.org/wiki/" + title.replace(" ", "_")}


def with_map(location="Somewhere"):
    return lead(map_img=img(), location=location)


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class ShortPathTest(unittest.TestCase):
    """The real client with urlopen mocked: the map requests never use the long retry policy."""

    def setUp(self):
        self.sleeps, self.calls = [], []
        self.client = WikiClient("en.wikipedia.org", "ua", sleep=self.sleeps.append)

    def urlopen_failing_with(self, error):
        def urlopen(req, timeout):
            self.calls.append(req.full_url)
            raise error
        return mock.patch("urllib.request.urlopen", urlopen)

    def test_a_429_costs_one_request_and_no_sleep(self):
        error = urllib.error.HTTPError("u", 429, "Too Many Requests", {"Retry-After": "50"}, None)
        with self.urlopen_failing_with(error):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                infobox.fetch_infobox(self.client, "Gaza war")
        self.assertTrue(infobox.is_throttled(cm.exception))
        self.assertEqual((len(self.calls), self.sleeps, self.client.requests), (1, [], 1))
        self.assertIn("section=0", self.calls[0])

    def test_a_maxlag_answer_costs_one_request_and_no_sleep(self):
        class Response:
            headers = {"Retry-After": "5"}
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"error": {"code": "maxlag", "info": "lagged"}}'
        calls = []
        def urlopen(req, timeout):
            calls.append(req)
            return Response()
        with mock.patch("urllib.request.urlopen", urlopen):
            with self.assertRaises(MaxLag) as cm:
                infobox.fetch_infobox(self.client, "Gaza war")
        self.assertTrue(infobox.is_throttled(cm.exception))
        self.assertEqual((len(calls), self.sleeps), (1, []))

    def test_other_calls_keep_the_retry_policy(self):
        error = urllib.error.HTTPError("u", 429, "Too Many Requests", {"Retry-After": "50"}, None)
        with self.urlopen_failing_with(error):
            with self.assertRaises(urllib.error.HTTPError):
                self.client.api(action="query", titles="X")
        self.assertEqual(len(self.calls), 5)               # 1 + 4 retries
        self.assertEqual(self.sleeps, [50.0, 50.0, 50.0, 50.0])

    def test_the_override_is_per_call(self):
        error = urllib.error.HTTPError("u", 503, "Unavailable", {}, None)
        with self.urlopen_failing_with(error):
            with self.assertRaises(urllib.error.HTTPError):
                self.client.api(retries=0, action="parse", page="X")
            self.assertEqual((len(self.calls), self.sleeps), (1, []))
            with self.assertRaises(urllib.error.HTTPError):
                self.client.api(action="parse", page="X")
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(self.client.retries, 4)


class UpdateCacheTest(unittest.TestCase):
    def setUp(self):
        self.sleeps = []

    def update(self, cache, articles, client, now=NOW, **kw):
        return infobox.update_cache(cache, articles, client, now, sleep=self.sleeps.append, **kw)

    def test_fetches_the_lead_section_once_and_stores_what_it_finds(self):
        client = FakeClient(article_pages={"A": with_map("Place A"), "B": "<p>Nothing</p>"})
        cache = {}
        stats = self.update(cache, [article("A"), article("B")], client)
        self.assertEqual(stats, {"fetched": 2, "found": 1, "failed": 0, "pending": 0, "stopped": None})
        self.assertEqual(cache["https://example.org/wiki/A"]["location"], "Place A")
        self.assertEqual(cache["https://example.org/wiki/A"]["map"]["url"], MAP)
        self.assertEqual(cache["https://example.org/wiki/B"], {"checked": "2026-10-24T09:00:00Z"})
        self.assertEqual(client.leads, ["A", "B"])
        self.update(cache, [article("A"), article("B")], client, now=NOW + datetime.timedelta(days=1))
        self.assertEqual(client.leads, ["A", "B"])  # not asked again

    def test_a_missing_article_is_stored_as_having_nothing(self):
        cache = {}
        self.update(cache, [article("Gone")], FakeClient())
        self.assertEqual(list(cache.values()), [{"checked": "2026-10-24T09:00:00Z"}])

    def test_rechecked_after_14_days_without_a_map_and_60_with_one(self):
        client = FakeClient(article_pages={"A": with_map(), "B": "<p>x</p>"})
        cache = {}
        arts = [article("A"), article("B")]
        self.update(cache, arts, client)
        client.leads.clear()
        self.update(cache, arts, client, now=NOW + datetime.timedelta(days=13, hours=23))
        self.assertEqual(client.leads, [])
        self.update(cache, arts, client, now=NOW + datetime.timedelta(days=14))
        self.assertEqual(client.leads, ["B"])
        client.leads.clear()
        self.update(cache, arts, client, now=NOW + datetime.timedelta(days=59))
        self.assertEqual(client.leads, ["B"])  # B again (14 days after its last check), not A
        client.leads.clear()
        self.update(cache, arts, client, now=NOW + datetime.timedelta(days=60))
        self.assertEqual(client.leads, ["A"])

    def test_recheck_picks_up_a_map_added_later(self):
        client = FakeClient(article_pages={"A": "<p>x</p>"})
        cache = {}
        self.update(cache, [article("A")], client)
        client.article_pages["A"] = with_map("Now with a map")
        self.update(cache, [article("A")], client, now=NOW + datetime.timedelta(days=20))
        entry = cache["https://example.org/wiki/A"]
        self.assertEqual((entry["location"], entry["checked"]), ("Now with a map", "2026-11-13T09:00:00Z"))

    def test_the_cap_limits_each_run_and_the_backlog_fills_over_runs(self):
        names = ["A%d" % i for i in range(7)]
        client = FakeClient(article_pages={n: "<p>x</p>" for n in names})
        cache = {}
        arts = [article(n) for n in names]
        stats = self.update(cache, arts, client, max_fetch=3)
        self.assertEqual((stats["fetched"], stats["pending"]), (3, 4))
        self.assertEqual(client.leads, ["A0", "A1", "A2"])  # newest first
        stats = self.update(cache, arts, client, max_fetch=3)
        self.assertEqual((stats["fetched"], stats["pending"]), (3, 1))
        self.assertEqual(client.leads[3:], ["A3", "A4", "A5"])
        self.update(cache, arts, client, max_fetch=3)
        self.assertEqual(client.leads[6:], ["A6"])
        stats = self.update(cache, arts, client, max_fetch=3)
        self.assertEqual((stats["fetched"], stats["pending"]), (0, 0))

    def test_never_checked_go_before_rechecks(self):
        client = FakeClient(article_pages={"Old": "<p>x</p>", "New": "<p>x</p>"})
        cache = {}
        self.update(cache, [article("Old")], client)
        later = NOW + datetime.timedelta(days=20)
        self.update(cache, [article("Old"), article("New")], client, now=later, max_fetch=1)
        self.assertEqual(client.leads, ["Old", "New"])

    def test_a_failure_is_not_stored_and_does_not_stop_the_others(self):
        client = FakeClient(article_pages={"A": with_map(), "B": "<p>x</p>"}, failing=["A"])
        cache = {}
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            stats = self.update(cache, [article("A"), article("B")], client)
        self.assertEqual((stats["fetched"], stats["failed"]), (1, 1))
        self.assertEqual(list(cache), ["https://example.org/wiki/B"])
        client.failing.clear()   # retried in the next run
        self.update(cache, [article("A"), article("B")], client, now=NOW + datetime.timedelta(hours=12))
        self.assertIn("map", cache["https://example.org/wiki/A"])

    def test_a_failed_recheck_keeps_the_old_record(self):
        client = FakeClient(article_pages={"A": with_map("Old place")})
        cache = {}
        self.update(cache, [article("A")], client)
        before = json.dumps(cache)
        client.failing.add("A")
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            self.update(cache, [article("A")], client, now=NOW + datetime.timedelta(days=70))
        self.assertEqual(json.dumps(cache), before)

    def test_gives_up_after_failures_in_a_row(self):
        names = ["A%d" % i for i in range(10)]
        client = FakeClient(failing=names)
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            stats = self.update({}, [article(n) for n in names], client)
        self.assertEqual(infobox.FAILURES_TO_STOP, 3)
        self.assertEqual(stats["failed"], 3)
        self.assertEqual(stats["stopped"], "errors")
        self.assertEqual(len(client.leads), 3)
        self.assertEqual(stats["pending"], 10)

    def test_a_success_resets_the_failures_in_a_row(self):
        names = ["A%d" % i for i in range(8)]
        client = FakeClient(article_pages={n: "<p>x</p>" for n in names}, failing=["A0", "A1", "A3", "A4"])
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            stats = self.update({}, [article(n) for n in names], client)
        self.assertEqual((stats["fetched"], stats["failed"], stats["stopped"]), (4, 4, None))

    def test_the_default_limits_are_small(self):
        self.assertEqual((limits.MAX_ARTICLE_FETCHES, limits.ARTICLE_FETCH_DELAY, limits.ARTICLE_FETCH_BUDGET),
                         (25, 1.0, 90))

    def test_a_throttling_answer_stops_the_phase_at_once_and_keeps_what_was_fetched(self):
        throttles = [urllib.error.HTTPError("u", 429, "Too Many Requests", {"Retry-After": "50"}, None),
                     urllib.error.HTTPError("u", 503, "Unavailable", {}, None),
                     MaxLag("maxlag"), ApiError("maxlag", "lagged")]
        for error in throttles:
            with self.subTest(error=repr(error)):
                names = ["A", "B", "C", "D"]
                client = FakeClient(article_pages={n: with_map() for n in names}, raising={"C": error})
                cache = {"https://example.org/wiki/Old": {"checked": "2026-10-23T09:00:00Z"}}
                self.sleeps.clear()
                with self.assertLogs("wikipedia_rss.infobox", "WARNING") as logs:
                    stats = self.update(cache, [article(n) for n in names + ["Old"]], client, delay=1)
                self.assertEqual(client.leads, ["A", "B", "C"])   # D is never asked
                self.assertEqual(stats["stopped"], "throttled")
                self.assertEqual((stats["fetched"], stats["failed"], stats["pending"]), (2, 0, 2))
                self.assertEqual(sorted(cache), ["https://example.org/wiki/A", "https://example.org/wiki/B",
                                                 "https://example.org/wiki/Old"])  # C is not cached as "no map"
                self.assertIn("map", cache["https://example.org/wiki/A"])
                self.assertEqual(len(logs.records), 1)
                self.assertIn("throttling", logs.output[0])
                self.assertIn("after 2 articles", logs.output[0])
                self.assertEqual(self.sleeps, [1, 1])             # no wait after the throttling answer

    def test_a_throttled_first_request_leaves_the_cache_untouched(self):
        error = urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
        client = FakeClient(article_pages={"A": with_map()}, raising={"A": error})
        cache = {}
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            stats = self.update(cache, [article("A")], client)
        self.assertEqual((cache, stats["fetched"], stats["stopped"]), ({}, 0, "throttled"))

    def test_other_http_errors_are_ordinary_failures(self):
        error = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        client = FakeClient(article_pages={"B": "<p>x</p>"}, raising={"A": error})
        with self.assertLogs("wikipedia_rss.infobox", "WARNING"):
            stats = self.update({}, [article("A"), article("B")], client)
        self.assertEqual((stats["fetched"], stats["failed"], stats["stopped"]), (1, 1, None))

    def test_the_time_budget_stops_the_phase_quietly(self):
        clock = FakeClock()
        names = ["A%d" % i for i in range(10)]
        client = FakeClient(article_pages={n: "<p>x</p>" for n in names}, on_request=lambda: clock.advance(10))
        cache = {}
        with self.assertLogs("wikipedia_rss.infobox", "INFO") as logs:
            stats = self.update(cache, [article(n) for n in names], client, budget=25, clock=clock)
        self.assertEqual(client.leads, ["A0", "A1", "A2"])  # 0 s, 10 s, 20 s start in time; 30 s does not
        self.assertEqual((stats["fetched"], stats["stopped"], stats["pending"]), (3, "budget", 7))
        self.assertEqual(len(cache), 3)
        self.assertEqual([r.levelname for r in logs.records], ["INFO"])
        self.assertIn("budget", logs.output[0])

    def test_the_budget_counts_the_waits_between_requests(self):
        clock = FakeClock()
        names = ["A%d" % i for i in range(10)]
        client = FakeClient(article_pages={n: "<p>x</p>" for n in names})
        stats = infobox.update_cache({}, [article(n) for n in names], client, NOW, delay=1, budget=3.5,
                                     sleep=clock.advance, clock=clock)
        self.assertEqual(len(client.leads), 4)   # starts at 0, 1, 2, 3 s; 4 s is over
        self.assertEqual(stats["stopped"], "budget")

    def test_no_budget_problem_when_everything_fits(self):
        client = FakeClient(article_pages={"A": "<p>x</p>"})
        stats = self.update({}, [article("A")], client, budget=90, clock=FakeClock())
        self.assertEqual((stats["fetched"], stats["stopped"]), (1, None))

    def test_one_request_per_article_without_retries(self):
        names = ["A", "B", "C"]
        client = FakeClient(article_pages={"A": "<p>x</p>", "B": "<p>x</p>"})  # C does not exist
        self.update({}, [article(n) for n in names], client)
        self.assertEqual(client.requests, 3)
        self.assertEqual(client.lead_retries, [0, 0, 0])

    def test_records_of_articles_no_longer_used_are_dropped(self):
        client = FakeClient(article_pages={"A": "<p>x</p>", "B": "<p>x</p>"})
        cache = {}
        self.update(cache, [article("A"), article("B")], client)
        self.update(cache, [article("B")], client)
        self.assertEqual(list(cache), ["https://example.org/wiki/B"])

    def test_waits_between_requests(self):
        client = FakeClient(article_pages={"A": "<p>x</p>", "B": "<p>x</p>", "C": "<p>x</p>"})
        self.update({}, [article("A"), article("B"), article("C")], client, delay=0.5)
        self.assertEqual(self.sleeps, [0.5, 0.5])

    def test_cache_file_roundtrip_is_stable(self):
        cache = {"https://x/A": {"checked": "2026-10-24T09:00:00Z", "location": "Ä"}}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            self.assertEqual(infobox.load_cache(path), {})
            with open(path, "w", encoding="utf-8") as f:
                f.write(infobox.dump_cache(cache))
            self.assertEqual(infobox.load_cache(path), cache)
            self.assertEqual(infobox.dump_cache(infobox.load_cache(path)), infobox.dump_cache(cache))


class RunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"),
                         data_dir=os.path.join(self.tmp.name, "data"))

    def tearDown(self):
        self.tmp.cleanup()

    def make_dirs(self, name):
        return {k: os.path.join(self.tmp.name, name, k) for k in ("state_dir", "out_dir", "data_dir")}

    def client(self, **kw):
        return FakeClient(day_pages={"Portal:Current events/2026 October 23": fixture("en_day.html")}, **kw)

    def stories(self):
        with open(os.path.join(self.dirs["data_dir"], "news.json"), encoding="utf-8") as f:
            return json.load(f)["stories"]

    def read(self, sub, name):
        with open(os.path.join(self.dirs[sub], name), "rb") as f:
            return f.read()

    def test_news_json_has_the_map_and_location_of_the_article(self):
        feed.run(WIKI, self.client(article_pages={"Gaza war": fixture("en_lead_infobox_map.html")}), NOW, **self.dirs)
        with_info = [s for s in self.stories() if s["article"] and "map" in s["article"]]
        self.assertTrue(with_info)
        for s in with_info:
            self.assertEqual(s["article"]["title"], "Gaza war")
            self.assertEqual(s["article"]["location"], "Strait of Hormuz, Persian Gulf, and Gulf of Oman")
            self.assertEqual(set(s["article"]["map"]), {"url", "url2x", "width", "height"})
        # the others have neither
        for s in self.stories():
            if s not in with_info and s["article"]:
                self.assertEqual(set(s["article"]) - {"title", "url", "extract"}, set())
        cached = json.loads(self.read("state_dir", "articles.json"))["articles"]
        self.assertEqual(cached["https://example.org/wiki/Gaza_war"]["checked"], "2026-10-24T09:00:00Z")

    def test_the_articles_of_the_topic_lines_get_them_too(self):
        # The page shows the summary of the nearest article, which may be one of `more_articles`.
        client = self.client()
        feed.run(WIKI, client, NOW, article_maps=False, **self.dirs)
        refs = [a for s in self.stories() for a in ([s["article"]] if s["article"] else []) + s["more_articles"]]
        more = {a["title"] for s in self.stories() for a in s["more_articles"]} - {
            s["article"]["title"] for s in self.stories() if s["article"]}
        self.assertTrue(more)
        title = sorted(more)[0]
        client = self.client(article_pages={title: with_map("Nearby")})
        feed.run(WIKI, client, NOW, **self.dirs)
        self.assertEqual(sorted(client.leads), sorted({a["title"] for a in refs}))
        found = [a for s in self.stories() for a in s["more_articles"] if a["title"] == title]
        self.assertTrue(found)
        for a in found:
            self.assertEqual((a["location"], a["map"]["url"]), ("Nearby", MAP))

    def test_the_feed_does_not_change(self):
        feed.run(WIKI, self.client(article_pages={"Gaza war": fixture("en_lead_infobox_map.html")}), NOW,
                 site_url="https://x.org", **self.dirs)
        with_maps = self.read("out_dir", "en.xml")
        feed.run(WIKI, self.client(), NOW, site_url="https://x.org", article_maps=False, **self.dirs)
        self.assertEqual(self.read("out_dir", "en.xml"), with_maps)

    def test_rerun_is_idempotent_and_does_not_ask_again(self):
        client = self.client(article_pages={"Gaza war": fixture("en_lead_infobox_map.html")})
        feed.run(WIKI, client, NOW, **self.dirs)
        first = {n: self.read(s, n) for s, n in (("state_dir", "articles.json"), ("data_dir", "news.json"),
                                                 ("state_dir", "en.json"))}
        asked = len(client.leads)
        self.assertGreater(asked, 1)
        feed.run(WIKI, client, NOW + datetime.timedelta(hours=12), **self.dirs)
        self.assertEqual(len(client.leads), asked)
        for (sub, name), data in zip((("state_dir", "articles.json"), ("data_dir", "news.json"),
                                      ("state_dir", "en.json")), first.values()):
            self.assertEqual(self.read(sub, name), data)

    def test_the_cap_per_run(self):
        client = self.client()
        feed.run(WIKI, client, NOW, max_article_fetches=2, **self.dirs)
        self.assertEqual(len(client.leads), 2)
        feed.run(WIKI, client, NOW + datetime.timedelta(hours=12), max_article_fetches=2, **self.dirs)
        self.assertEqual(len(client.leads), 4)
        self.assertEqual(len(set(client.leads)), 4)

    def test_failing_fetches_do_not_fail_the_run_nor_get_cached(self):
        names = {a["title"] for a in infobox_titles(self)}
        client = self.client(failing=names)
        with self.assertLogs("wikipedia_rss", "WARNING"):
            res = feed.run(WIKI, client, NOW, **self.dirs)
        self.assertGreater(res["scraped"], 0)
        self.assertEqual(json.loads(self.read("state_dir", "articles.json")), {"articles": {}})

    def snapshot(self):
        names = (("out_dir", "en.xml"), ("data_dir", "news.json"), ("data_dir", "sources.json"),
                 ("state_dir", "en.json"), ("state_dir", "articles.json"))
        return {n: self.read(sub, n) for sub, n in names}

    def test_a_throttled_run_keeps_everything_and_reruns_are_byte_identical(self):
        throttle = urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
        gaza = {"Gaza war": throttle}
        # nothing fetched, whether maps were off or throttled: same bytes
        off = RunTest.make_dirs(self, "off")
        feed.run(WIKI, self.client(), NOW, article_maps=False, site_url="https://x.org", **off)
        client = self.client(article_pages={"Gaza war": fixture("en_lead_infobox_map.html")}, raising=gaza)
        with self.assertLogs("wikipedia_rss", "WARNING") as logs:
            res = feed.run(WIKI, client, NOW, site_url="https://x.org", **self.dirs)
        self.assertEqual(len([o for o in logs.output if "throttling" in o]), 1)
        self.assertGreater(res["scraped"], 0)
        first = self.snapshot()
        for sub, name in (("out_dir", "en.xml"), ("data_dir", "news.json"), ("state_dir", "en.json"),
                          ("state_dir", "articles.json")):
            with open(os.path.join(off[sub], name), "rb") as f:
                self.assertEqual(f.read(), first[name], name)
        feed.run(WIKI, self.client(raising=gaza), NOW, site_url="https://x.org", **self.dirs)
        self.assertEqual(self.snapshot(), first)

    def test_the_budget_goes_through_run(self):
        clock = FakeClock()
        client = self.client(on_request=lambda: clock.advance(100))  # every request takes 100 s
        feed.run(WIKI, client, NOW, article_budget=90, article_clock=clock, **self.dirs)
        self.assertEqual(len(client.leads), 1)
        self.assertEqual(len(json.loads(self.read("state_dir", "articles.json"))["articles"]), 1)

    def test_the_essential_outputs_are_written_before_the_map_phase(self):
        # Even something nobody catches (the job being killed) during the maps loses nothing essential.
        client = self.client(raising={t["title"]: KeyboardInterrupt() for t in infobox_titles(self)})
        with self.assertRaises(KeyboardInterrupt):
            feed.run(WIKI, client, NOW, site_url="https://x.org", **self.dirs)
        reference = RunTest.make_dirs(self, "ref")
        feed.run(WIKI, self.client(), NOW, article_maps=False, site_url="https://x.org", **reference)
        for sub, name in (("out_dir", "en.xml"), ("data_dir", "news.json"), ("data_dir", "sources.json"),
                          ("state_dir", "en.json")):
            with open(os.path.join(reference[sub], name), "rb") as f:
                self.assertEqual(self.read(sub, name), f.read(), name)

    def test_news_json_is_rebuilt_with_what_the_maps_found(self):
        feed.run(WIKI, self.client(article_pages={"Gaza war": fixture("en_lead_infobox_map.html")}), NOW, **self.dirs)
        self.assertTrue([s for s in self.stories() if s["article"] and "map" in s["article"]])

    def test_without_article_maps_nothing_is_fetched(self):
        client = self.client()
        feed.run(WIKI, client, NOW, article_maps=False, **self.dirs)
        self.assertEqual(client.leads, [])
        feed.run(WIKI, client, NOW, dry_run=True, **self.dirs)
        self.assertEqual(client.leads, [])


def infobox_titles(test):
    """The articles (own and more_articles) of the stories of the day fixture."""
    client = test.client()
    feed.run(WIKI, client, NOW, article_maps=False, state_dir=os.path.join(test.tmp.name, "s0"),
             out_dir=os.path.join(test.tmp.name, "f0"), data_dir=os.path.join(test.tmp.name, "d0"))
    with open(os.path.join(test.tmp.name, "d0", "news.json"), encoding="utf-8") as f:
        return [a for s in json.load(f)["stories"] for a in ([s["article"]] if s["article"] else []) + s["more_articles"]]


if __name__ == "__main__":
    unittest.main()
