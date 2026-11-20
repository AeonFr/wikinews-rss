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

    def test_website_stories_are_the_nearest_articles_tied_by_a_group(self):
        feed.run(WIKI, day_client(), NOW, days=1, **self.dirs)
        stories = self.stories()
        self.assertEqual(len(stories), 3)  # Chile, China–Russia…, and the first-level entry
        chile = [s for s in stories if "Philippines and Chile" in s["headlines"][0]["html"]][0]
        summit = [s for s in stories if "trilateral" in s["headlines"][0]["html"]][0]
        collapse = [s for s in stories if s["article"] is None][0]
        # The two under APEC are one group (a box on the front page); the entry alone is another.
        self.assertEqual(chile["group"], summit["group"])
        self.assertNotEqual(chile["group"], collapse["group"])
        for story in (chile, summit):
            self.assertEqual(len(story["headlines"]), 1)
            self.assertEqual(story["article"]["title"], "APEC China 2026")  # the top-level article
        # Each page has the cards of its own topic lines, every article of a line included.
        self.assertEqual([a["title"] for a in chile["more_articles"]], ["Chile–Philippines relations"])
        self.assertEqual([a["title"] for a in summit["more_articles"]],
                         ["China–Russia relations", "China–United States relations", "Russia–United States relations"])
        self.assertEqual([[t["label"] for t in h["topics"]] for h in summit["headlines"]],
                         [["APEC China 2026",
                           "China–Russia relations, China–United States relations, Russia–United States relations"]])
        # A first-level entry has its category and no article.
        self.assertEqual(collapse["more_articles"], [])
        self.assertEqual(collapse["categories"], ["Disasters and accidents"])

    def test_the_feed_splits_a_story_by_the_nearest_article(self):
        feed.run(WIKI, day_client(), NOW, days=1, site_url="https://x.org", **self.dirs)
        # The feed has an item per nearest article, and the website a page for each.
        self.assertEqual(len(self.stories()), 3)
        items = {i.findtext("title"): i for i in self.feed_items()}
        chile = "Chile–Philippines relations: The Philippines and Chile sign a free trade agreement in Shenzhen."
        lines = "China–Russia relations, China–United States relations, Russia–United States relations"
        self.assertEqual(set(items), {
            chile, lines + ": Xi, Putin and Trump hold their first trilateral meeting in Shenzhen.",
            "A building collapses somewhere in the world, which is a first-level entry."})  # no article: no prefix
        # Each item links to its story page on the site: the article page of that entry or group.
        ids = {s["headlines"][0]["id"]: s["id"] for s in self.stories()}
        links = sorted(i.findtext("link") for i in items.values())
        self.assertEqual(links, sorted("https://x.org/story.html?id=" + sid for sid in ids.values()))
        self.assertTrue(all("&" not in link for link in links))
        # Every article of the topic line is linked in the description.
        desc = [i for t, i in items.items() if t.startswith("China")][0].findtext("description")
        for title in ("China–Russia relations", "China–United States relations", "Russia–United States relations"):
            self.assertIn(title + "</a>", desc)

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
        self.assertEqual(len(self.feed_items()), 3)
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


def crowded_page(n):
    """One top-level article with n entries nested under three different sub-topics."""
    subs = ["Alpha", "Beta", "Gamma"]
    items = "".join(
        '<li>%s<ul><li>Entry number %d about something that happened. %s</li></ul></li>' % (
            link("Sub topic " + subs[i % 3]), i, source("Src", i)) for i in range(n))
    return ('<div class="current-events-main vevent"><span class="bday">2026-11-19</span>'
            '<div class="current-events-content"><p><b>Armed conflicts and attacks</b></p>'
            '<ul><li>%s<ul>%s</ul></li></ul></div></div>' % (link("Big crisis"), items))


class LargeGroupTest(unittest.TestCase):
    def run_feed(self, n):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        dirs = dict(state_dir=self.tmp.name + "/s", out_dir=self.tmp.name + "/f", data_dir=self.tmp.name + "/d")
        feed.run(WIKI, FakeClient(day_pages={PAGE: crowded_page(n)}), NOW, days=1, **dirs)
        with open(dirs["data_dir"] + "/news.json", encoding="utf-8") as f:
            stories = json.load(f)["stories"]
        return stories, ET.parse(dirs["out_dir"] + "/en.xml").getroot().findall("channel/item")

    def test_all_the_entries_of_one_article_and_day_stay_together(self):
        # 7 entries under one article used to be split 6 + 1 by the group cap.
        stories, items = self.run_feed(7)
        # One group (the box on the front page), made of a story per sub-topic...
        self.assertEqual(len({s["group"] for s in stories}), 1)
        self.assertEqual(sorted(len(s["headlines"]) for s in stories), [2, 2, 3])
        # ...each headline keeping its topic path, from which the front page builds the nesting.
        self.assertEqual([[t["label"] for t in h["topics"]] for s in stories for h in s["headlines"]][0],
                         ["Big crisis", "Sub topic Alpha"])
        # The feed has an item per nearest article: three sub-topics, with 3, 2 and 2 entries.
        titles = sorted(i.findtext("title") for i in items)
        self.assertEqual(len(titles), 3)
        self.assertEqual([t.split(": ")[0] for t in titles], ["Sub topic Alpha", "Sub topic Beta", "Sub topic Gamma"])
        alpha = [i for i in items if i.findtext("title").startswith("Sub topic Alpha")][0]
        self.assertEqual(alpha.findtext("title").count(" / "), 2)  # three sentences, one prefix
        self.assertEqual(alpha.findtext("title").count("Sub topic Alpha"), 1)

    def test_the_title_of_a_large_group_is_bounded(self):
        members = [{"title": "Entry %d." % i} for i in range(7)]
        self.assertEqual(st.group_title(members), "Entry 0. / Entry 1. / Entry 2. / … (+4 more)")
        self.assertEqual(st.rss_title(members[:2], {"label": "Some topic"}), "Some topic: Entry 0. / Entry 1.")
        self.assertEqual(st.rss_title(members[:1], None), "Entry 0.")
