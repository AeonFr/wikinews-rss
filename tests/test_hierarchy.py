"""Entries nested under several topic levels are grouped under the outermost topic's article."""
import datetime
import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET

from wikipedia_rss import feed, parsers, state as st
from wikipedia_rss.config import WIKI

from helpers import FakeClient

NOW = datetime.datetime(2026, 11, 19, 18, 0, tzinfo=datetime.timezone.utc)
DAY = datetime.date(2026, 11, 19)
PAGE = "Portal:Current events/2026 November 19"


def link(title, text=None):
    return '<a href="/wiki/%s" title="%s">%s</a>' % (title.replace(" ", "_"), title, text or title)


def source(name, n):
    return '<a rel="nofollow" class="external text" href="https://news.example/%s/%d">(%s)</a>' % (name, n, name)


# The shape of the portal on 19 Nov 2026 (International relations > APEC > two sub-topics).
APEC_PAGE = """<div class="current-events-main vevent"><span class="bday">2026-11-19</span>
<div class="current-events-content"><p><b>International relations</b></p>
<ul><li>%(apec)s
<ul><li>%(chile)s
<ul><li>The Philippines and Chile sign a free trade agreement in Shenzhen. %(inquirer)s</li></ul></li>
<li>%(cr)s, %(cu)s, %(ru)s
<ul><li>Xi, Putin and Trump hold their first trilateral meeting in Shenzhen. %(afp)s %(bbc)s</li></ul></li>
</ul></li></ul>
<p><b>Disasters and accidents</b></p>
<ul><li>A building collapses somewhere in the world, which is a first-level entry. %(ap)s</li></ul>
</div></div>""" % {
    "apec": link("APEC China 2026"), "chile": link("Chile–Philippines relations"),
    "cr": link("China–Russia relations"), "cu": link("China–United States relations"),
    "ru": link("Russia–United States relations"),
    "inquirer": source("Inquirer", 1), "afp": source("AFP", 2), "bbc": source("BBC", 3), "ap": source("AP", 4),
}


class ParserTest(unittest.TestCase):
    def setUp(self):
        self.items = parsers.parse_daily_html(APEC_PAGE, WIKI, DAY, PAGE)

    def test_nested_entries_are_grouped_under_the_outermost_article(self):
        chile, summit, collapse = self.items
        self.assertEqual(chile["main_title"], "APEC China 2026")
        self.assertEqual(summit["main_title"], "APEC China 2026")
        self.assertIsNone(collapse["main_title"])  # first level: no article, only its category
        self.assertEqual(collapse["category"], "Disasters and accidents")
        self.assertEqual(collapse["topics"], [])

    def test_every_link_of_a_topic_line_is_kept(self):
        summit = self.items[1]
        self.assertEqual([t["label"] for t in summit["topics"]],
                         ["APEC China 2026",
                          "China–Russia relations, China–United States relations, Russia–United States relations"])
        self.assertEqual([l["title"] for l in summit["topics"][1]["links"]],
                         ["China–Russia relations", "China–United States relations", "Russia–United States relations"])


def day_client():
    return FakeClient(day_pages={PAGE: APEC_PAGE})


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=self.tmp.name + "/s", out_dir=self.tmp.name + "/f", data_dir=self.tmp.name + "/d")

    def tearDown(self):
        self.tmp.cleanup()

    def stories(self):
        with open(self.dirs["data_dir"] + "/news.json", encoding="utf-8") as f:
            return json.load(f)["stories"]

    def feed_items(self):
        return ET.parse(self.dirs["out_dir"] + "/en.xml").getroot().findall("channel/item")

    def test_one_story_with_a_card_for_every_article(self):
        feed.run(WIKI, day_client(), NOW, days=1, **self.dirs)
        apec, collapse = sorted(self.stories(), key=lambda s: s["article"] is None)
        self.assertEqual(apec["article"]["title"], "APEC China 2026")
        self.assertEqual(len(apec["headlines"]), 2)
        self.assertEqual([a["title"] for a in apec["more_articles"]],
                         ["Chile–Philippines relations", "China–Russia relations",
                          "China–United States relations", "Russia–United States relations"])
        # A first-level entry stays on its own, with its category and no article.
        self.assertIsNone(collapse["article"])
        self.assertEqual(collapse["more_articles"], [])
        self.assertEqual(collapse["categories"], ["Disasters and accidents"])

    def test_the_feed_groups_them_too(self):
        feed.run(WIKI, day_client(), NOW, days=1, **self.dirs)
        self.assertEqual(len(self.feed_items()), 2)
        [item] = [i for i in self.feed_items() if "Xi, Putin" in i.findtext("title")]
        self.assertIn("Philippines and Chile", item.findtext("title"))
        desc = item.findtext("description")
        # Each headline's topic path is listed, with every article of its lines linked.
        self.assertIn("Chile–Philippines relations</a>", desc)
        for title in ("China–Russia relations", "China–United States relations", "Russia–United States relations"):
            self.assertIn(title + "</a>", desc)
        self.assertEqual(desc.count("Topics:"), 2)

    def test_regrouping_once_when_the_grouping_rule_changes(self):
        feed.run(WIKI, day_client(), NOW, days=1, **self.dirs)
        path = self.dirs["state_dir"] + "/en.json"
        state = st.load_state(path)
        self.assertEqual(state["grouping"], st.GROUPING_VERSION)
        [group] = state["groups"].values()
        # State as the previous rule left it: nothing grouped, no marker.
        del state["grouping"]
        state["groups"] = {}
        st.save_state(path, state)
        self.assertEqual(len(self.feed_items()), 2)
        feed.run(WIKI, day_client(), NOW + datetime.timedelta(hours=1), days=1, **self.dirs)
        state = st.load_state(path)
        self.assertEqual(state["grouping"], st.GROUPING_VERSION)
        [regrouped] = state["groups"].values()
        self.assertEqual(sorted(regrouped["members"]), sorted(group["members"]))
        # And not again: a further run leaves the state as it is.
        before = open(path, "rb").read()
        feed.run(WIKI, day_client(), NOW + datetime.timedelta(hours=2), days=1, **self.dirs)
        self.assertEqual(open(path, "rb").read(), before)


if __name__ == "__main__":
    unittest.main()


class BackfillTest(unittest.TestCase):
    def test_old_headlines_get_the_extract_they_were_stored_without(self):
        state = {"items": {
            "old": {"pageid": 1, "main_title": "Gaza war protests"},                         # stored before extracts
            "done": {"pageid": 2, "article_title": "Other", "article_extract": "Kept."},      # already looked up
            "none": {"pageid": 3, "article_title": "No page", "article_extract": ""},         # looked up, empty
            "portal": {"article_title": None},                                                # no article
        }}
        client = FakeClient()
        feed.backfill_extracts(WIKI, client, state, pages={})
        self.assertEqual(state["items"]["old"]["article_extract"], "Extract of Gaza war protests.")
        self.assertEqual(state["items"]["old"]["article_title"], "Gaza war protests")
        self.assertEqual(state["items"]["done"]["article_extract"], "Kept.")
        self.assertEqual(state["items"]["none"]["article_extract"], "")
        self.assertNotIn("article_extract", state["items"]["portal"])
        self.assertEqual(client.requests, 1)
        # Looked up once: nothing more is asked for.
        feed.backfill_extracts(WIKI, client, state, pages={})
        self.assertEqual(client.requests, 1)
