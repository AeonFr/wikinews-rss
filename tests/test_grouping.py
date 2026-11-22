"""Grouping of headlines about the same main article into one feed item."""
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
OCT23 = "Portal:Current events/2026 October 23"
OCT24 = "Portal:Current events/2026 October 24"
OCT25 = "Portal:Current events/2026 October 25"

LOCKDOWN = "The Israeli government orders the military to prepare for a complete lockdown of the West Bank."
RAIDS = ("The Israeli military raids 15 cities in the occupied West Bank, arresting several "
         "Palestinians and destroying a three-storey building in Hebron.")
HEADS = ["Headline number %d about the West Bank lockdown and its consequences." % i for i in range(5)]
# A feed item's title starts with the article nearest to its entries.
PFX = "2026 West Bank lockdown: "


def day_page(date, headlines):
    """Minimal rendered day page with every headline under the 2026 West Bank lockdown topic."""
    lis = "".join('<li>%s <a rel="nofollow" class="external text" href="https://news.example/%s/%d">'
                  "(News)</a></li>" % (h, date, i) for i, h in enumerate(headlines))
    return ('<div class="current-events-main vevent"><span class="bday">%s</span>'
            '<div class="current-events-content"><p><b>Armed conflicts and attacks</b></p>'
            '<ul><li><a href="/wiki/2026_West_Bank_lockdown" title="2026 West Bank lockdown">'
            "2026 West Bank lockdown</a><ul>%s</ul></li></ul></div></div>" % (date, lis))


def en_client(oct24=None, oct25=None):
    pages = {OCT23: fixture("en_day.html")}
    if oct24:
        pages[OCT24] = day_page("2026-10-24", oct24)
    if oct25:
        pages[OCT25] = day_page("2026-10-25", oct25)
    return FakeClient(day_pages=pages)


class GroupingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"),
                         data_dir=os.path.join(self.tmp.name, "data"))

    def tearDown(self):
        self.tmp.cleanup()

    def run_en(self, now=NOW, oct24=None, oct25=None, **kw):
        return feed.run(WIKI, en_client(oct24, oct25), now, **dict(self.dirs, **kw))

    def items(self):
        root = ET.parse(os.path.join(self.dirs["out_dir"], "en.xml")).getroot()
        return root.findall("channel/item")

    def matching(self, text):
        return [i for i in self.items() if text in i.findtext("title")]

    def by_title(self, text):
        return {i.findtext("title"): i for i in self.matching(text)}

    def snapshot(self):
        files = {}
        for sub in ("state_dir", "out_dir", "data_dir"):
            for name in sorted(os.listdir(self.dirs[sub])):
                with open(os.path.join(self.dirs[sub], name), "rb") as f:
                    files[(sub, name)] = f.read()
        return files

    def assert_stable(self, run, *nows):
        """Re-running without changes leaves every file byte-for-byte identical."""
        snap = self.snapshot()
        for now in nows:
            run(now)
            self.assertEqual(self.snapshot(), snap)

    def state(self):
        with open(os.path.join(self.dirs["state_dir"], "en.json"), encoding="utf-8") as f:
            return json.load(f)

    def save_state(self, state):
        st.save_state(os.path.join(self.dirs["state_dir"], "en.json"), state)

    def stories(self):
        with open(os.path.join(self.dirs["data_dir"], "news.json"), encoding="utf-8") as f:
            return {s["title"]: s for s in json.load(f)["stories"]}

    def test_en_later_day_is_a_new_item(self):
        res = self.run_en(oct24=[RAIDS])
        self.assertEqual((res["scraped"], res["new"], res["in_feed"]), (12, 11, 12))
        items = self.by_title("West Bank")
        self.assertEqual(set(items), {PFX + LOCKDOWN, PFX + RAIDS})
        self.assertTrue(items[PFX + LOCKDOWN].findtext("guid").startswith("wikipedia:en:2026-10-23:"))
        self.assertEqual(items[PFX + LOCKDOWN].findtext("pubDate"), "Fri, 23 Oct 2026 00:00:00 GMT")
        self.assertTrue(items[PFX + RAIDS].findtext("guid").startswith("wikipedia:en:2026-10-24:"))
        self.assertEqual(items[PFX + RAIDS].findtext("pubDate"), "Sat, 24 Oct 2026 09:00:00 GMT")
        # The only group is the fixture's two entries under "Russo-Ukrainian war".
        [group] = self.state()["groups"].values()
        self.assertEqual(len(group["members"]), 2)

    def test_en_same_day_grouped_oldest_first(self):
        # The portal lists the follow-up (HEADS[0]) below the headline that was first in the
        # document (HEADS[1]): the title is the reverse of the document order, and the
        # description follows the title.
        res = self.run_en(oct24=[HEADS[1], HEADS[0]])
        self.assertEqual((res["scraped"], res["new"], res["in_feed"]), (13, 11, 12))
        [item] = self.matching("Headline number")
        self.assertEqual(item.findtext("title"), PFX + HEADS[0] + " / " + HEADS[1])
        # Founder (guid, pubDate): the first headline in the document, as before.
        founder = "wikipedia:en:2026-10-24:" + parsers.text_hash(HEADS[1])
        self.assertEqual(item.findtext("guid"), founder)
        self.assertEqual(item.findtext("pubDate"), "Sat, 24 Oct 2026 09:00:00 GMT")
        self.assertEqual(item.findtext("link"), "https://example.org/wiki/2026_West_Bank_lockdown")
        desc = item.findtext("description")
        self.assertLess(desc.index("number 0"), desc.index("https://news.example/2026-10-24/1"))
        self.assertLess(desc.index("https://news.example/2026-10-24/1"), desc.index("number 1"))
        self.assertLess(desc.index("number 1"), desc.index("https://news.example/2026-10-24/0"))
        self.assertEqual(desc.count("Topics:"), 1)
        self.assertEqual(desc.count("2026_October_24"), 2)  # one attribution line: page + history
        self.assertNotIn("2026_October_23", desc)
        self.assertEqual([c.text for c in item.findall("category")],
                         ["Armed conflicts and attacks", "2026 West Bank lockdown"])
        # The 23 Oct headline on the same article stays on its own.
        [lockdown] = self.matching("complete lockdown")
        self.assertEqual(lockdown.findtext("title"), PFX + LOCKDOWN)

    def test_en_guid_and_pubdate_stable_when_member_added(self):
        self.run_en(oct24=[HEADS[0]])
        [before] = self.matching("Headline number")
        # Three hours later a follow-up appears above it on the same day page.
        res = self.run_en(NOW + datetime.timedelta(hours=3), oct24=[HEADS[1], HEADS[0]])
        self.assertEqual(res["new"], 0)  # absorbed into the existing item
        [after] = self.matching("Headline number")
        self.assertEqual(after.findtext("title"), PFX + HEADS[0] + " / " + HEADS[1])
        self.assertEqual(after.findtext("guid"), before.findtext("guid"))
        self.assertEqual(after.findtext("pubDate"), before.findtext("pubDate"))
        self.assertEqual(len(self.items()), 12)
        self.assert_stable(lambda now: self.run_en(now, oct24=[HEADS[1], HEADS[0]]),
                           NOW + datetime.timedelta(hours=4), NOW + datetime.timedelta(hours=30))

        # The next day the story develops: a new item, the 24 Oct one is untouched.
        res = self.run_en(NOW + datetime.timedelta(days=1), oct24=[HEADS[1], HEADS[0]], oct25=[HEADS[2]])
        self.assertEqual(res["new"], 1)
        items = self.by_title("Headline number")
        self.assertEqual(set(items), {PFX + HEADS[0] + " / " + HEADS[1], PFX + HEADS[2]})
        self.assertEqual(items[PFX + HEADS[0] + " / " + HEADS[1]].findtext("guid"), before.findtext("guid"))
        self.assertTrue(items[PFX + HEADS[2]].findtext("guid").startswith("wikipedia:en:2026-10-25:"))
        self.assertEqual(items[PFX + HEADS[2]].findtext("pubDate"), "Sun, 25 Oct 2026 09:00:00 GMT")
        self.assert_stable(lambda now: self.run_en(now, oct24=[HEADS[1], HEADS[0]], oct25=[HEADS[2]]),
                           NOW + datetime.timedelta(days=1, hours=5))

    def test_en_cap_splits_long_stories(self):
        self.run_en(oct24=HEADS[:4], max_group=3)
        titles = set(self.by_title("Headline number"))
        # The first three in the document (oldest first) fill the first item, shown in
        # reverse document order; the fourth starts a new one.
        self.assertEqual(titles, {PFX + HEADS[2] + " / " + HEADS[1] + " / " + HEADS[0], PFX + HEADS[3]})
        self.assertEqual(len(self.items()), 11 + 4 - 2)
        self.assert_stable(lambda now: self.run_en(now, oct24=HEADS[:4], max_group=3),
                           NOW + datetime.timedelta(hours=2))

    def test_en_max_group_1_disables_grouping(self):
        self.run_en(oct24=HEADS[:2], max_group=1)
        self.assertEqual(len(self.items()), 13)
        self.assertEqual(self.state()["groups"], {})

    def test_en_new_headline_joins_open_group_not_full_one(self):
        self.run_en(oct24=HEADS[:3], max_group=3)  # full
        self.run_en(NOW + datetime.timedelta(hours=1), oct24=HEADS[:4], max_group=3)
        titles = set(self.by_title("Headline number"))
        self.assertEqual(titles, {PFX + HEADS[2] + " / " + HEADS[1] + " / " + HEADS[0], PFX + HEADS[3]})

    def test_story_lists_every_headline_of_the_group(self):
        # The feed title of an item can go stale in readers when a headline is added to its
        # group (same guid); the story page, reached through the item's link, has them all.
        self.run_en(oct24=[HEADS[0]], site_url="https://x.org")
        [before] = self.matching("Headline number")
        self.run_en(NOW + datetime.timedelta(hours=3), oct24=[HEADS[1], HEADS[0]], site_url="https://x.org")
        [after] = self.matching("Headline number")
        self.assertEqual(after.findtext("link"), before.findtext("link"))  # same story page
        story_id = after.findtext("link").rstrip("/").rsplit("/", 1)[1]
        stories = self.stories()
        story = stories[PFX + HEADS[0] + " / " + HEADS[1]]
        self.assertEqual(story["id"], story_id)
        self.assertEqual(len(story["headlines"]), 2)
        self.assertIn("number 0", story["headlines"][0]["html"])  # same order as the item's title
        self.assertIn("number 1", story["headlines"][1]["html"])
        self.assertEqual(story["article"]["title"], "2026 West Bank lockdown")
        self.assertEqual(story["pub_date"], "2026-10-24T09:00:00Z")

    # --- migration --------------------------------------------------------------

    def write_old_state(self):
        """Turn the current state into the format written before grouping existed."""
        state = self.state()
        del state["groups"]
        for it in state["items"].values():
            for key in ("pos", "page_date", "group_key"):
                it.pop(key, None)
        self.save_state(state)

    def test_migration_from_ungrouped_state(self):
        # Old version: lockdown seen on the 23rd; raids and two headlines seen on the 24th,
        # all as separate items.
        self.run_en(NOW - datetime.timedelta(hours=8), max_group=1)
        self.run_en(NOW, oct24=[RAIDS, HEADS[0]], max_group=1)
        self.write_old_state()
        old_items = {i.findtext("title"): i for i in self.items()}
        old = {t: (old_items[PFX + t].findtext("guid"), old_items[PFX + t].findtext("pubDate"))
               for t in (LOCKDOWN, RAIDS, HEADS[0])}

        res = self.run_en(NOW + datetime.timedelta(hours=2), oct24=[RAIDS, HEADS[0]])
        self.assertEqual(res["new"], 0)
        self.assertEqual(len(self.items()), 12)
        items = self.by_title("West Bank")
        # Same article, different days: still separate, with their guids and pubDates.
        self.assertEqual(items[PFX + LOCKDOWN].findtext("guid"), old[LOCKDOWN][0])
        self.assertEqual(items[PFX + LOCKDOWN].findtext("pubDate"), old[LOCKDOWN][1])
        # Same article, same day: grouped under the oldest (first in the document).
        item = items[PFX + HEADS[0] + " / " + RAIDS]
        self.assertEqual((item.findtext("guid"), item.findtext("pubDate")), old[RAIDS])
        state = self.state()
        self.assertEqual(state["groups"][old[RAIDS][0]]["members"], [old[RAIDS][0], old[HEADS[0]][0]])
        self.assertIn(old[HEADS[0]][0], state["items"])  # kept so it never comes back on its own
        self.assert_stable(lambda now: self.run_en(now, oct24=[RAIDS, HEADS[0]]), NOW + datetime.timedelta(days=1))

    def test_migration_undoes_multi_day_group(self):
        # State written by the previous version: lockdown (23 Oct) grouped with raids and
        # HEADS[0] (24 Oct), and HEADS[1] (24 Oct, first seen later) on its own because the
        # group was full. Only the group guid (lockdown's) and HEADS[1] were published.
        self.run_en(NOW, oct24=[RAIDS, HEADS[0]], max_group=1)
        self.run_en(NOW + datetime.timedelta(hours=1), oct24=[RAIDS, HEADS[0], HEADS[1]], max_group=1)
        state = self.state()
        guid = {it["title"]: g for g, it in state["items"].items()}
        g_lock, g_raids, g_h0, g_h1 = (guid[t] for t in (LOCKDOWN, RAIDS, HEADS[0], HEADS[1]))
        lock = state["items"][g_lock]
        state["groups"] = {g_lock: {"members": [g_lock, g_raids, g_h0],
                                    "first_seen": lock["first_seen"], "pub_date": lock["pub_date"]}}
        self.save_state(state)
        headlines = dict(state["items"])

        later = NOW + datetime.timedelta(hours=2)
        res = self.run_en(later, oct24=[RAIDS, HEADS[0], HEADS[1]])
        self.assertEqual(res["new"], 0)
        state = self.state()
        self.assertEqual(state["groups"], {})  # only the founder was left
        # No headline lost or renamed, and none changed its dates.
        self.assertEqual(set(state["items"]), set(headlines))
        for g, it in headlines.items():
            self.assertEqual((state["items"][g]["first_seen"], state["items"][g]["pub_date"]),
                             (it["first_seen"], it["pub_date"]))
        feed_items = {i.findtext("guid"): i for i in self.items()}
        self.assertEqual(len(feed_items), 14)
        self.assertEqual(feed_items[g_lock].findtext("title"), PFX + LOCKDOWN)  # group guid keeps founder
        self.assertEqual(feed_items[g_lock].findtext("pubDate"), "Fri, 23 Oct 2026 00:00:00 GMT")
        self.assertEqual(feed_items[g_h1].findtext("title"), PFX + HEADS[1])  # published guid unchanged
        for g, title in ((g_raids, RAIDS), (g_h0, HEADS[0])):
            self.assertEqual(feed_items[g].findtext("title"), PFX + title)
            self.assertEqual(feed_items[g].findtext("pubDate"), "Sat, 24 Oct 2026 09:00:00 GMT")
        self.assert_stable(lambda now: self.run_en(now, oct24=[RAIDS, HEADS[0], HEADS[1]]),
                           later + datetime.timedelta(hours=1), later + datetime.timedelta(days=1))


class RegroupStateTest(unittest.TestCase):
    T0 = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)

    def item(self, guid, key="pageid:1", order=0):
        return {"guid": guid, "date": None, "date_source": "first_seen", "title": guid, "sources": [],
                "group_key": key, "order": order, "pos": order, "link": "https://x/%s" % key}

    def test_group_expires_as_a_whole(self):
        state = {"items": {}}
        st.merge(state, [self.item("a")], self.T0)
        st.merge(state, [self.item("a"), self.item("b", order=1)], self.T0 + datetime.timedelta(hours=1))
        self.assertEqual(state["groups"]["a"]["members"], ["a", "b"])
        # "a" leaves the portal; the group stays while it is recent.
        st.merge(state, [self.item("b", order=1)], self.T0 + datetime.timedelta(days=29), retention_days=30)
        [unit] = st.latest(state, 10)
        self.assertEqual((unit["guid"], unit["title"]), ("a", "b / a"))  # reverse of the portal order
        # Once it is older than the limit every headline of the group goes with it.
        st.merge(state, [self.item("b", order=1)], self.T0 + datetime.timedelta(days=31), retention_days=30)
        self.assertEqual((state["items"], state["groups"]), ({}, {}))

    def test_gone_unit_is_not_reopened(self):
        state = {"items": {}}
        st.merge(state, [self.item("a")], self.T0)
        st.merge(state, [self.item("c", key="pageid:2")], self.T0 + datetime.timedelta(days=1))  # a gone
        st.merge(state, [self.item("b")], self.T0 + datetime.timedelta(days=2))
        self.assertEqual(state["groups"], {})
        self.assertEqual(sorted(u["guid"] for u in st.latest(state, 10)), ["a", "b", "c"])

    def test_same_day_groups_later_day_starts_new_unit(self):
        state = {"items": {}}
        st.merge(state, [self.item("a")], self.T0)
        st.merge(state, [self.item("a"), self.item("b", order=1)], self.T0 + datetime.timedelta(hours=10))
        st.merge(state, [self.item("a"), self.item("b", order=1), self.item("c", order=2)],
                 self.T0 + datetime.timedelta(hours=15))  # 00:00 UTC on the 25th
        self.assertEqual(state["groups"], {"a": {"members": ["a", "b"], "first_seen": "2026-10-24T09:00:00Z",
                                                 "pub_date": "2026-10-24T09:00:00Z"}})
        units = {u["guid"]: u for u in st.latest(state, 10)}
        self.assertEqual(sorted(units), ["a", "c"])
        self.assertEqual(units["a"]["title"], "b / a")  # reverse of the portal (list) order
        self.assertEqual(units["c"]["pub_date"], "2026-10-25T00:00:00Z")

    def mixed_state(self):
        """A group written by the previous version: a (24th) + b (24th) + c, d (25th)."""
        state = {"items": {}}
        day2 = self.T0 + datetime.timedelta(days=1)
        st.merge(state, [self.item("a"), self.item("b", order=1)], self.T0, max_group=1)
        st.merge(state, [self.item("a"), self.item("b", order=1), self.item("c", order=2),
                         self.item("d", order=3)], day2, max_group=1)
        state["groups"] = {"a": {"members": ["a", "b", "c", "d"], "first_seen": "2026-10-24T09:00:00Z",
                                 "pub_date": "2026-10-24T09:00:00Z"}}
        return state

    def test_migration_splits_later_days_keeps_same_day(self):
        state = self.mixed_state()
        items = json.loads(json.dumps(state["items"]))
        current = [self.item(g, order=i) for i, g in enumerate("abcd")]
        new = st.merge(state, current, self.T0 + datetime.timedelta(days=1, hours=1))
        self.assertEqual(new, [])
        self.assertEqual(list(state["groups"]), ["a"])
        self.assertEqual(state["groups"]["a"]["members"], ["a", "b"])
        units = {u["guid"]: u for u in st.latest(state, 10)}
        self.assertEqual(sorted(units), ["a", "c", "d"])  # c and d are items of their own again
        for g in "cd":
            self.assertEqual((units[g]["title"], units[g]["pub_date"], units[g]["first_seen"]),
                             (g, items[g]["pub_date"], items[g]["first_seen"]))
        dumped = st.dump_state(state)
        st.merge(state, current, self.T0 + datetime.timedelta(days=2))
        self.assertEqual(st.dump_state(state), dumped)

    def test_migration_with_expired_founder(self):
        state = self.mixed_state()
        del state["items"]["a"], state["items"]["b"]
        st.merge(state, [self.item("c", order=2), self.item("d", order=3)], self.T0 + datetime.timedelta(days=1, hours=1))
        self.assertEqual(state["groups"], {})
        self.assertEqual(sorted(u["guid"] for u in st.latest(state, 10)), ["c", "d"])

    def test_items_without_article_are_never_grouped(self):
        state = {"items": {}}
        st.merge(state, [self.item("a", key=None), self.item("b", key=None, order=1)], self.T0)
        self.assertEqual(state["groups"], {})


if __name__ == "__main__":
    unittest.main()
