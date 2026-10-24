import datetime
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

from wikipedia_rss import cli, feed
from wikipedia_rss.config import LANGUAGES

from helpers import FakeClient, fixture

NOW = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)


def en_client():
    return FakeClient(day_pages={"Portal:Current events/2026 October 23": fixture("en_day.html")})


def es_client():
    return FakeClient(raw_pages={"Plantilla:Portada:Actualidad": fixture("es_tpl_portada.wiki")})


class RunLanguageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"))

    def tearDown(self):
        self.tmp.cleanup()

    def read_feed(self, lang):
        return ET.parse(os.path.join(self.dirs["out_dir"], lang + ".xml")).getroot()

    def test_en_feed(self):
        res = feed.run_language(LANGUAGES["en"], en_client(), NOW, base_url="https://x.org/feeds", **self.dirs)
        self.assertEqual((res["scraped"], res["new"]), (11, 11))
        root = self.read_feed("en")
        items = root.findall("channel/item")
        self.assertEqual(len(items), 11)
        first = items[0]
        self.assertTrue(first.findtext("guid").startswith("wikipedia:en:2026-10-23:"))
        self.assertEqual(first.find("guid").get("isPermaLink"), "false")
        self.assertEqual(first.findtext("pubDate"), "Fri, 23 Oct 2026 00:00:00 GMT")
        self.assertIn("CC BY-SA 4.0", first.findtext("description"))
        self.assertEqual(first.findtext("link"), "https://example.org/wiki/2026_West_Bank_lockdown")
        self.assertIsNotNone(root.find("channel/{http://www.w3.org/2005/Atom}link"))

    def test_es_second_run_is_stable(self):
        cfg = LANGUAGES["es"]
        res = feed.run_language(cfg, es_client(), NOW, **self.dirs)
        self.assertEqual(res["new"], 17)
        first = {i.findtext("guid"): i.findtext("pubDate") for i in self.read_feed("es").iter("item")}
        res = feed.run_language(cfg, es_client(), NOW + datetime.timedelta(hours=2), **self.dirs)
        self.assertEqual(res["new"], 0)
        second = {i.findtext("guid"): i.findtext("pubDate") for i in self.read_feed("es").iter("item")}
        self.assertEqual(first, second)
        self.assertIn("Extract of PHP2Shell.", " ".join(i.findtext("description") for i in self.read_feed("es").iter("item")))

    def test_dry_run_writes_nothing(self):
        feed.run_language(LANGUAGES["es"], es_client(), NOW, dry_run=True, **self.dirs)
        self.assertFalse(os.path.exists(self.dirs["out_dir"]))


class CliTest(unittest.TestCase):
    def test_one_language_failing_does_not_stop_the_other(self):
        def make_client(host, user_agent, cache_dir=None):
            if host.startswith("es."):
                return FakeClient()  # raw page missing -> KeyError
            return en_client()

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(cli, "WikiClient", make_client):
            with self.assertLogs("wikipedia_rss", "ERROR"):
                code = cli.main(["--out", tmp, "--state", tmp, "--days", "2"])
            self.assertEqual(code, 1)
            self.assertTrue(os.path.exists(os.path.join(tmp, "en.xml")))
            self.assertFalse(os.path.exists(os.path.join(tmp, "es.xml")))


if __name__ == "__main__":
    unittest.main()
