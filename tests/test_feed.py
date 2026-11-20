import datetime
import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

from wikipedia_rss import cli, feed
from wikipedia_rss.config import WIKI

from helpers import FakeClient, fixture

NOW = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)
SITE = "https://x.org/news"


def en_client(html=None):
    return FakeClient(day_pages={"Portal:Current events/2026 October 23": html or fixture("en_day.html")})


class RunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"),
                         data_dir=os.path.join(self.tmp.name, "data"))

    def tearDown(self):
        self.tmp.cleanup()

    def read_feed(self):
        return ET.parse(os.path.join(self.dirs["out_dir"], "en.xml")).getroot()

    def read_data(self):
        with open(os.path.join(self.dirs["data_dir"], "news.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_en_feed(self):
        res = feed.run(WIKI, en_client(), NOW, site_url=SITE, **self.dirs)
        self.assertEqual((res["scraped"], res["new"]), (11, 10))
        root = self.read_feed()
        items = root.findall("channel/item")
        self.assertEqual(len(items), 11)  # one per nearest article
        first = items[0]
        guid = first.findtext("guid")
        self.assertTrue(guid.startswith("wikipedia:en:2026-10-23:"))
        self.assertEqual(first.find("guid").get("isPermaLink"), "false")
        self.assertEqual(first.findtext("pubDate"), "Fri, 23 Oct 2026 00:00:00 GMT")
        self.assertIn("CC BY-SA 4.0", first.findtext("description"))
        self.assertEqual(root.findtext("channel/link"), SITE)
        self.assertEqual(root.find("channel/{http://www.w3.org/2005/Atom}link").get("href"), SITE + "/feeds/en.xml")
        # The item links to its story page, which is in the website data.
        self.assertEqual(first.findtext("link"), SITE + "/story.html?id=" + guid.split(":", 2)[2].replace(":", "-"))
        ids = [s["id"] for s in self.read_data()["stories"]]
        self.assertIn(first.findtext("link").split("id=")[1], ids)

    def test_without_site_url_items_link_to_the_article(self):
        feed.run(WIKI, en_client(), NOW, **self.dirs)
        first = self.read_feed().find("channel/item")
        self.assertEqual(first.findtext("link"), "https://example.org/wiki/Gaza_war")
        self.assertIsNone(self.read_feed().find("channel/{http://www.w3.org/2005/Atom}link"))

    def test_website_data(self):
        feed.run(WIKI, en_client(), NOW, **self.dirs)
        data = self.read_data()
        self.assertEqual(data["retention_days"], 183)
        self.assertEqual(data["portal"]["url"], "https://en.wikipedia.org/wiki/Portal:Current_events")
        self.assertEqual(len(data["stories"]), 11)  # one per nearest article, like the feed items
        story = data["stories"][0]
        # The story is about the outermost topic's article; the nested topic's article is a
        # further card, and every topic line keeps all its links.
        self.assertEqual(story["article"]["title"], "Gaza war")
        self.assertEqual(story["article"]["url"], "https://example.org/wiki/Gaza_war")
        self.assertEqual(story["article"]["extract"], "Extract of Gaza war.")
        self.assertEqual([a["title"] for a in story["more_articles"]], ["2026 West Bank lockdown"])
        [headline] = story["headlines"]
        self.assertIn("West Bank", headline["html"])
        self.assertEqual([[l["label"] for l in t["links"]] for t in headline["topics"]],
                         [["Gaza war"], ["2026 West Bank lockdown"]])
        self.assertEqual(headline["sources"][0]["name"], "Al Jazeera")
        self.assertEqual(headline["page"]["url"], "https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_23")
        # Items without a main article have no article card.
        self.assertEqual([s["article"] for s in data["stories"] if "Nairobi" in s["title"]], [None])

    def test_data_has_every_story_but_the_feed_is_limited(self):
        feed.run(WIKI, en_client(), NOW, max_items=3, **self.dirs)
        self.assertEqual(len(self.read_feed().findall("channel/item")), 3)
        self.assertEqual(len(self.read_data()["stories"]), 11)

    def snapshot(self):
        files = {}
        for sub in ("state_dir", "out_dir", "data_dir"):
            for name in sorted(os.listdir(self.dirs[sub])):
                with open(os.path.join(self.dirs[sub], name), "rb") as f:
                    files[(sub, name)] = f.read()
        return files

    def run_en(self, now, client=None):
        feed.run(WIKI, client or en_client(), now, site_url=SITE, **self.dirs)

    def test_rerun_without_changes_is_byte_identical(self):
        self.run_en(NOW)
        first = self.snapshot()
        # feed, news.json and state, plus the (empty) source previews data and cache
        self.assertEqual(len(first), 5)
        for hours in (1, 12, 24):
            self.run_en(NOW + datetime.timedelta(hours=hours))
            self.assertEqual(self.snapshot(), first)
        self.assertIn(b"<lastBuildDate>Sat, 24 Oct 2026 09:00:00 GMT</lastBuildDate>", first[("out_dir", "en.xml")])
        self.assertNotIn(b"last_seen", first[("state_dir", "en.json")])

    def test_modified_item_changes_output(self):
        self.run_en(NOW)
        first = self.snapshot()
        # Edited text keeps the guid but changes the feed item and the story.
        edited = fixture("en_day.html").replace("prepare for a complete", "prepare for a full", 1)
        self.run_en(NOW + datetime.timedelta(days=1), en_client(edited))
        second = self.snapshot()
        for key in (("out_dir", "en.xml"), ("data_dir", "news.json"), ("state_dir", "en.json")):
            self.assertNotEqual(second[key], first[key])
        self.assertIn(b"prepare for a full", second[("data_dir", "news.json")])
        self.assertIn(b"<lastBuildDate>Sun, 25 Oct 2026 09:00:00 GMT</lastBuildDate>", second[("out_dir", "en.xml")])

    def test_news_older_than_the_limit_is_deleted_everywhere(self):
        self.run_en(NOW)
        # With a 30-day limit, 23 Oct is 31 days old on 24 Nov; the page is still served by the (fake) portal.
        later = NOW + datetime.timedelta(days=31)
        res = feed.run(WIKI, en_client(), later, days=40, site_url=SITE, retention_days=30, **self.dirs)
        self.assertEqual(res["new"], 0)
        self.assertEqual(self.read_feed().findall("channel/item"), [])
        self.assertEqual(self.read_data()["stories"], [])
        with open(os.path.join(self.dirs["state_dir"], "en.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["items"], {})

    def test_dry_run_writes_nothing(self):
        feed.run(WIKI, en_client(), NOW, dry_run=True, **self.dirs)
        self.assertFalse(os.path.exists(self.dirs["out_dir"]))
        self.assertFalse(os.path.exists(self.dirs["data_dir"]))


class CliTest(unittest.TestCase):
    def test_writes_feed_and_data(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(cli, "WikiClient", lambda *a, **k: en_client()):
            args = ["--out", tmp + "/f", "--data", tmp + "/d", "--state", tmp + "/s", "--days", "2",
                    "--site-url", SITE, "--no-source-previews"]
            self.assertEqual(cli.main(args, now=NOW), 0)
            self.assertTrue(os.path.exists(os.path.join(tmp, "f", "en.xml")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "d", "news.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "s", "en.json")))

    def test_failure_exits_with_1(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(cli, "WikiClient", lambda *a, **k: FakeClient()):
            with self.assertLogs("wikipedia_rss", "ERROR"):
                code = cli.main(["--out", tmp, "--data", tmp, "--state", tmp, "--days", "2"], now=NOW)
            self.assertEqual(code, 1)
            self.assertEqual(os.listdir(tmp), [])


if __name__ == "__main__":
    unittest.main()
