"""The "Topics in the news" of the portal's main page: items with no day."""
import datetime
import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET

from wikipedia_rss import feed, parsers, state as st
from wikipedia_rss.config import WIKI

from helpers import FakeClient, fixture

NOW = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)
PORTAL = "Portal:Current events"
DAY = "Portal:Current events/2026 October 23"


def client(portal_html=None):
    pages = {DAY: fixture("en_day.html")}
    pages[PORTAL] = portal_html if portal_html is not None else fixture("en_portal.html")
    return FakeClient(day_pages=pages)


class ParserTest(unittest.TestCase):
    def setUp(self):
        self.items = parsers.parse_topics_html(fixture("en_portal.html"), WIKI, PORTAL)

    def test_the_items_of_the_box_and_nothing_of_its_footer(self):
        self.assertEqual(len(self.items), 4)  # not the "Ongoing" list below them
        self.assertEqual([i["main_title"] for i in self.items],
                         ["Grand Theft Auto VI", "Voyager 1", "113th Grey Cup", "Jensen Huang"])

    def test_they_have_no_date_no_sources_and_say_what_they_are(self):
        for it in self.items:
            self.assertIsNone(it["date"])
            self.assertEqual((it["sources"], it["topics"], it["kind"], it["category"], it["page"]),
                             ([], [], "topic", "Topics in the news", PORTAL))

    def test_remarks_about_the_boxs_picture_are_dropped(self):
        voyager = self.items[1]
        self.assertNotIn("rendering shown", voyager["text"])
        self.assertNotIn("rendering shown", voyager["html"])
        self.assertTrue(voyager["text"].startswith("The space probe Voyager 1 becomes"))
        self.assertIn('<a href="https://en.wikipedia.org/wiki/Voyager_1">Voyager 1</a>', voyager["html"])

    def test_a_page_without_the_box_has_no_items(self):
        self.assertEqual(parsers.parse_topics_html("<div>nothing here</div>", WIKI, PORTAL), [])


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dirs = dict(state_dir=self.tmp.name + "/s", out_dir=self.tmp.name + "/f", data_dir=self.tmp.name + "/d")

    def run_feed(self, now=NOW, portal_html=None):
        return feed.run(WIKI, client(portal_html), now, site_url="https://x.org", **self.dirs)

    def stories(self):
        with open(self.dirs["data_dir"] + "/news.json", encoding="utf-8") as f:
            return json.load(f)["stories"]

    def feed_items(self):
        return ET.parse(self.dirs["out_dir"] + "/en.xml").getroot().findall("channel/item")

    def topics(self):
        return [s for s in self.stories() if s.get("kind") == "topic"]

    def test_topics_are_stories_dated_by_when_they_were_first_seen(self):
        self.run_feed()
        topics = self.topics()
        self.assertEqual(len(topics), 4)
        for s in topics:
            self.assertEqual(s["pub_date"], "2026-10-24T09:00:00Z")
            self.assertEqual(s["categories"], ["Topics in the news"])
            self.assertTrue(s["id"].startswith("topic-"), s["id"])
            self.assertEqual(len(s["headlines"]), 1)
            self.assertEqual(s["headlines"][0]["page"]["title"], PORTAL)
            self.assertEqual(s["headlines"][0]["topics"], [])
            self.assertEqual(s["group"], s["id"])  # a group of its own: nothing is nested under it
        self.assertEqual({s["article"]["title"] for s in topics},
                         {"Grand Theft Auto VI", "Voyager 1", "113th Grey Cup", "Jensen Huang"})
        self.assertTrue(all(s["article"].get("extract") for s in topics))

    def test_a_later_run_keeps_their_date(self):
        self.run_feed()
        first = {s["id"]: s["pub_date"] for s in self.topics()}
        self.run_feed(NOW + datetime.timedelta(days=2))
        self.assertEqual({s["id"]: s["pub_date"] for s in self.topics()}, first)

    def test_they_are_not_grouped_with_the_days_entries_about_the_same_article(self):
        before = len(self.run_feed()["items"])
        # A topic whose article is the one the day's first entry is nested under.
        same = fixture("en_portal.html").replace("Grand_Theft_Auto_VI", "2026_West_Bank_lockdown").replace(
            "Grand Theft Auto VI", "2026 West Bank lockdown")
        self.tmp.cleanup()
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=self.tmp.name + "/s", out_dir=self.tmp.name + "/f", data_dir=self.tmp.name + "/d")
        self.run_feed(portal_html=same)
        daily = [s for s in self.stories() if s.get("kind") != "topic"]
        self.assertEqual(len(daily), 11)  # the daily entries are as without topics
        self.assertEqual(len(self.topics()), 4)
        self.assertEqual(len({s["group"] for s in self.stories()}), len(self.stories()) - 1)  # only the fixture's pair is one group
        self.assertEqual(len(self.feed_items()), before)

    def test_the_feed_dates_them_by_when_they_were_added_and_does_not_prefix_them(self):
        self.run_feed()
        items = {i.findtext("title"): i for i in self.feed_items()}
        gta = [i for t, i in items.items() if t.startswith("The video game Grand Theft Auto VI")][0]
        self.assertEqual(gta.findtext("pubDate"), "Sat, 24 Oct 2026 09:00:00 GMT")
        self.assertTrue(gta.findtext("guid").startswith("wikipedia:en:topic:"))
        self.assertEqual([c.text for c in gta.findall("category")], ["Topics in the news"])
        self.assertIn("Portal:Current_events", gta.findtext("description"))
        self.assertNotIn(": The video game", gta.findtext("title"))  # no "article:" prefix
        self.assertTrue(gta.findtext("link").startswith("https://x.org/story.html?id=topic-"))

    def dropped_box(self):
        """The box without the Grey Cup and the Nvidia items, and with a new one."""
        html = fixture("en_portal.html")
        start = html.index("<li>In <a")
        new = ('<li>A new topic about <b><a href="/wiki/Something_new" title="Something new">something new</a></b>.</li>')
        return html[:start] + new + html[html.index("</ul>", start):]

    def feed_topic_guids(self):
        return {i.findtext("guid") for i in self.feed_items() if i.findtext("guid").startswith("wikipedia:en:topic:")}

    def test_a_topic_the_box_drops_is_retired_not_deleted_and_leaves_the_feed(self):
        self.run_feed()
        first = {s["id"]: s for s in self.topics()}
        self.assertEqual(len(self.feed_topic_guids()), 4)
        self.run_feed(NOW + datetime.timedelta(days=1), portal_html=self.dropped_box())
        topics = {s["id"]: s for s in self.topics()}
        retired = {i for i, s in topics.items() if s.get("retired")}
        current = set(topics) - retired
        # Two stay in the box, one is new; the two that were dropped keep their page (the website
        # has it, retired) but are not in the feed.
        self.assertEqual((len(current), len(retired)), (3, 2))
        self.assertEqual(len(current & set(first)), 2)
        self.assertEqual(len(retired & set(first)), 2)
        self.assertEqual(len(self.feed_topic_guids()), 3)
        self.assertEqual({s["article"]["title"] for i, s in topics.items() if i in retired}, {"113th Grey Cup", "Jensen Huang"})
        for i in retired:  # still dated by when they were added
            self.assertEqual(topics[i]["pub_date"], "2026-10-24T09:00:00Z")

    def test_a_retired_topic_that_comes_back_is_current_again_with_its_date(self):
        self.run_feed()
        self.run_feed(NOW + datetime.timedelta(days=1), portal_html=self.dropped_box())
        self.run_feed(NOW + datetime.timedelta(days=2))
        topics = self.topics()
        self.assertEqual(len(topics), 5)  # the new one is retired now
        self.assertEqual(sum(1 for s in topics if s.get("retired")), 1)
        self.assertEqual(len(self.feed_topic_guids()), 4)
        self.assertEqual(len([s for s in topics if s["pub_date"] == "2026-10-24T09:00:00Z"]), 4)

    def test_an_empty_box_retires_them_all_but_a_page_without_the_box_changes_nothing(self):
        self.run_feed()
        # A page with no box at all (its layout changed, say) says nothing about the topics.
        self.run_feed(NOW + datetime.timedelta(days=1), portal_html="<div>no box here</div>")
        self.assertEqual(sum(1 for s in self.topics() if s.get("retired")), 0)
        # An empty box is a box: nothing is highlighted any more.
        empty = fixture("en_portal.html")
        empty = empty[:empty.index("<ul><li>The video game")] + empty[empty.index("</ul>", empty.index("<ul><li>The video game")) + 5:]
        self.run_feed(NOW + datetime.timedelta(days=2), portal_html=empty)
        self.assertEqual(sum(1 for s in self.topics() if s.get("retired")), 4)
        self.assertEqual(self.feed_topic_guids(), set())

    def test_retired_topics_go_with_the_retention_like_everything_else(self):
        def topic(guid):
            return {"guid": guid, "date": None, "date_source": "first_seen", "title": guid, "sources": [],
                    "page": PORTAL, "kind": "topic"}
        state = {"items": {}}
        st.merge(state, [topic("a"), topic("b")], NOW)
        st.merge(state, [topic("a")], NOW + datetime.timedelta(days=1))
        self.assertTrue(state["items"]["b"]["retired"])
        self.assertNotIn("retired", state["items"]["a"])
        # Both are older than the retention 200 days later, whether or not the box still has them
        # (as for any entry); one that is still in the box comes back as a new topic on the next run.
        st.merge(state, [topic("a")], NOW + datetime.timedelta(days=200))
        self.assertEqual(state["items"], {})
        st.merge(state, [topic("a")], NOW + datetime.timedelta(days=201))
        self.assertEqual(state["items"]["a"]["pub_date"], "2027-05-13T09:00:00Z")

    def test_without_the_portal_page_there_are_no_topics_and_nothing_fails(self):
        feed.run(WIKI, FakeClient(day_pages={DAY: fixture("en_day.html")}), NOW, **self.dirs)
        self.assertEqual(self.topics(), [])
        self.assertEqual(len(self.stories()), 11)


if __name__ == "__main__":
    unittest.main()
