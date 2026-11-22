import datetime
import io
import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
import urllib.error

from wikipedia_rss import feed, sources
from wikipedia_rss.config import WIKI

from helpers import fixture
from test_feed import NOW, en_client

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Fallback title</title>
<meta property="og:title" content="Somalia expels UAE ambassador &amp; recalls envoy">
<meta property="og:description" content="  The government said\n the move was final. ">
<meta property="og:image" content="/img/lead.jpg">
<meta property="og:site_name" content="Example News">
</head><body><meta property="og:title" content="ignored, after the head"></body></html>"""


class ParseTest(unittest.TestCase):
    def test_open_graph(self):
        p = sources.parse_preview(PAGE, "https://news.example/a/b")
        self.assertEqual(p, {
            "title": "Somalia expels UAE ambassador & recalls envoy",
            "description": "The government said the move was final.",
            "image": "https://news.example/img/lead.jpg",
            "site": "Example News",
        })

    def test_falls_back_to_title_and_meta_description(self):
        p = sources.parse_preview('<head><title> Plain\n title </title><meta name="description" content="Desc"></head>',
                                  "https://x.org/")
        self.assertEqual(p, {"title": "Plain title", "description": "Desc"})

    def test_no_title_or_a_block_page_has_no_preview(self):
        self.assertIsNone(sources.parse_preview("<head><meta property='og:image' content='/a.png'></head>", "https://x.org/"))
        self.assertIsNone(sources.parse_preview("<head><title>Just a moment...</title></head>", "https://x.org/"))

    def test_only_http_images(self):
        p = sources.parse_preview('<head><title>T</title><meta property="og:image" content="javascript:alert(1)"></head>',
                                  "https://x.org/")
        self.assertEqual(p, {"title": "T"})

    def test_decode_uses_the_declared_charset(self):
        body = '<meta charset="iso-8859-1"><title>Café</title>'.encode("iso-8859-1")
        self.assertIn("Café", sources.decode_html(body, ""))
        self.assertIn("Café", sources.decode_html(body, "text/html; charset=ISO-8859-1"))


class FakeResp(io.BytesIO):
    def __init__(self, body, ctype="text/html; charset=utf-8"):
        super().__init__(body)
        self.headers = {"Content-Type": ctype}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FetcherTest(unittest.TestCase):
    def fetcher(self, routes):
        seen = []

        def urlopen(req, timeout):
            seen.append((req.full_url, req.get_header("User-agent")))
            r = routes.get(req.full_url)
            if isinstance(r, Exception):
                raise r
            if r is None:
                raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)
            return r
        return sources.Fetcher("test-agent/1", urlopen=urlopen), seen

    def test_fetches_a_preview_with_the_given_user_agent(self):
        f, seen = self.fetcher({"https://n.org/a": FakeResp(PAGE.encode())})
        preview, reason = f("https://n.org/a")
        self.assertEqual(preview["site"], "Example News")
        self.assertEqual(seen[-1], ("https://n.org/a", "test-agent/1"))

    def test_failures_have_a_reason(self):
        f, _ = self.fetcher({"https://n.org/blocked": urllib.error.HTTPError("u", 403, "no", {}, None),
                             "https://n.org/pdf": FakeResp(b"%PDF", "application/pdf"),
                             "https://n.org/slow": TimeoutError()})
        self.assertEqual(f("https://n.org/blocked"), (None, "HTTP 403"))
        self.assertEqual(f("https://n.org/pdf"), (None, "not html"))
        self.assertEqual(f("https://n.org/slow"), (None, "TimeoutError"))
        self.assertEqual(f("ftp://n.org/x"), (None, "not an http(s) url"))

    def test_robots_txt_is_honoured(self):
        robots = FakeResp(b"User-agent: *\nDisallow: /private/", "text/plain")
        f, seen = self.fetcher({"https://n.org/robots.txt": robots,
                                "https://n.org/ok": FakeResp(PAGE.encode())})
        self.assertEqual(f("https://n.org/private/a"), (None, "disallowed by robots.txt"))
        self.assertIsNotNone(f("https://n.org/ok")[0])
        self.assertNotIn("https://n.org/private/a", [u for u, _ in seen])


class UpdateCacheTest(unittest.TestCase):
    def test_fetches_once_and_retries_failures_a_limited_number_of_times(self):
        calls = []

        def fetch(url):
            calls.append(url)
            return ({"title": "T"}, "") if url.endswith("/ok") else (None, "HTTP 403")
        urls = ["https://a.org/ok", "https://b.org/blocked"]
        cache = {}
        kw = dict(fetch=fetch, sleep=lambda s: None)
        stats = sources.update_cache(cache, urls, NOW, **kw)
        self.assertEqual(stats, {"fetched": 2, "found": 1, "failed": 1})
        self.assertEqual(cache["https://b.org/blocked"]["fails"], 1)
        # Same moment: nothing is due. A day later only the failure is retried.
        self.assertEqual(sources.update_cache(cache, urls, NOW + datetime.timedelta(hours=12), **kw)["fetched"], 0)
        later = NOW
        for _ in range(5):
            later += datetime.timedelta(days=1)
            sources.update_cache(cache, urls, later, **kw)
        self.assertEqual(cache["https://b.org/blocked"]["fails"], sources.MAX_ATTEMPTS)
        self.assertEqual(calls.count("https://a.org/ok"), 1)
        self.assertEqual(calls.count("https://b.org/blocked"), sources.MAX_ATTEMPTS)

    def test_entries_of_deleted_news_are_dropped_and_the_run_is_capped(self):
        cache = {"https://old.org/x": {"preview": {"title": "Old"}, "checked": "2026-01-01T00:00:00Z"}}
        urls = ["https://s.org/%d" % i for i in range(5)]
        stats = sources.update_cache(cache, urls, NOW, lambda u: ({"title": u}, ""), max_fetch=3, sleep=lambda s: None)
        self.assertEqual(stats["fetched"], 3)
        self.assertNotIn("https://old.org/x", cache)
        self.assertEqual(sorted(cache), urls[:3])  # the newest first

    def test_data_file_has_only_found_previews_of_current_urls(self):
        cache = {"https://a.org/1": {"preview": {"title": "A"}, "checked": "x"},
                 "https://a.org/2": {"fails": 1, "checked": "x", "error": "HTTP 403"},
                 "https://a.org/3": {"preview": {"title": "C"}, "checked": "x"}}
        data = json.loads(sources.dump_data(cache, ["https://a.org/1", "https://a.org/2"]))
        self.assertEqual(data, {"sources": {"https://a.org/1": {"title": "A"}}})


class PipelineTest(unittest.TestCase):
    def test_run_writes_previews_and_a_failing_fetcher_never_fails_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = dict(state_dir=tmp + "/s", out_dir=tmp + "/f", data_dir=tmp + "/d")
            feed.run(WIKI, en_client(), NOW, fetch_source=lambda u: ({"title": "Title of " + u[-12:]}, ""), **dirs)
            with open(tmp + "/d/sources.json", encoding="utf-8") as f:
                found = json.load(f)["sources"]
            self.assertTrue(found)
            self.assertTrue(os.path.exists(tmp + "/s/sources.json"))

            def boom(url):
                raise RuntimeError("boom")
            fresh = dict(state_dir=tmp + "/s2", out_dir=tmp + "/f2", data_dir=tmp + "/d2")
            with self.assertLogs("wikipedia_rss", "WARNING"):
                res = feed.run(WIKI, en_client(), NOW, fetch_source=boom, **fresh)
            self.assertEqual(res["scraped"], 11)


if __name__ == "__main__":
    unittest.main()


class ImageTest(unittest.TestCase):
    MEMBERS = [{"sources": [{"name": "A", "url": "https://a.org/1"}, {"name": "B", "url": "https://b.org/2"}]},
               {"sources": [{"name": "C", "url": "https://c.org/3"}]}]

    def test_story_image_is_the_first_one_found_in_order(self):
        cache = {"https://a.org/1": {"preview": {"title": "No image"}, "checked": "x"},
                 "https://b.org/2": {"fails": 1, "checked": "x", "error": "HTTP 403"},
                 "https://c.org/3": {"preview": {"title": "T", "image": "https://c.org/i.jpg"}, "checked": "x"}}
        self.assertEqual(sources.story_image(self.MEMBERS, cache),
                         {"url": "https://c.org/i.jpg", "source": "C", "link": "https://c.org/3"})
        self.assertIsNone(sources.story_image(self.MEMBERS, {}))
        self.assertIsNone(sources.story_image(self.MEMBERS, None))

    def test_only_featured_stories_get_an_image(self):
        cache = {"https://a.org/1": {"preview": {"title": "T", "image": "https://a.org/i.jpg"}, "checked": "x"}}
        src = [{"name": "A", "url": "https://a.org/1"}]
        single = [{"pageid": 1, "sources": src}]              # one headline, with an article
        grouped = [{"pageid": 1, "sources": src}, {"pageid": 1, "sources": []}]
        portal = [{"sources": src}]                           # straight from the portal: no article
        self.assertIsNone(sources.featured_image(single, cache))
        self.assertEqual(sources.featured_image(grouped, cache)["url"], "https://a.org/i.jpg")
        self.assertEqual(sources.featured_image(portal, cache)["url"], "https://a.org/i.jpg")

    def test_image_reaches_the_feed_and_the_website_data_in_the_same_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = dict(state_dir=tmp + "/s", out_dir=tmp + "/f", data_dir=tmp + "/d")
            res = feed.run(WIKI, en_client(), NOW,
                           fetch_source=lambda u: ({"title": "T", "image": "https://img.example/a.jpg?x=1&y=2"}, ""), **dirs)
            with open(tmp + "/d/news.json", encoding="utf-8") as f:
                stories = json.load(f)["stories"]
            # Every story of the website data has the image (an entry with one article too, as a tile).
            self.assertTrue(stories)
            for s in stories:
                self.assertEqual(s["image"]["url"], "https://img.example/a.jpg?x=1&y=2", s["title"])
            self.assertTrue(any(s["article"] and len(s["headlines"]) == 1 for s in stories))
            # In the feed an item has an image when it groups headlines or has no article.
            root = ET.parse(tmp + "/f/en.xml").getroot()
            by_guid = {i.findtext("guid"): i for i in root.findall("channel/item")}
            expected = {it["guid"] for it in res["items"] if len(it.get("members") or [it]) > 1 or not it.get("pageid")}
            self.assertTrue(expected)
            for guid, item in by_guid.items():
                media = item.find("{http://search.yahoo.com/mrss/}content")
                self.assertEqual(media is not None, guid in expected, item.findtext("title"))
                self.assertEqual("<img" in item.findtext("description"), guid in expected)
            item = by_guid[sorted(expected)[0]]
            media = item.find("{http://search.yahoo.com/mrss/}content")
            self.assertEqual((media.get("url"), media.get("medium")), ("https://img.example/a.jpg?x=1&y=2", "image"))
            self.assertIn('<img src="https://img.example/a.jpg?x=1&amp;y=2"', item.findtext("description"))
            self.assertIn("Image: ", item.findtext("description"))

    def test_no_previews_no_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            feed.run(WIKI, en_client(), NOW, state_dir=tmp + "/s", out_dir=tmp + "/f", data_dir=tmp + "/d")
            with open(tmp + "/d/news.json", encoding="utf-8") as f:
                self.assertFalse(any("image" in s for s in json.load(f)["stories"]))
            self.assertNotIn("<img", open(tmp + "/f/en.xml", encoding="utf-8").read())
