"""Grouping of headlines about the same main article into one feed item."""
import datetime
import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET

from wikipedia_rss import feed, state as st
from wikipedia_rss.config import LANGUAGES

from helpers import FakeClient, fixture

NOW = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)
OCT23 = "Portal:Current events/2026 October 23"
OCT24 = "Portal:Current events/2026 October 24"
ES_PAGE = "Plantilla:Portada:Actualidad"

LOCKDOWN = "The Israeli government orders the military to prepare for a complete lockdown of the West Bank."
RAIDS = ("The Israeli military raids 15 cities in the occupied West Bank, arresting several "
         "Palestinians and destroying a three-storey building in Hebron.")


def day_page(date, headlines):
    """Minimal rendered day page with every headline under the 2026 West Bank lockdown topic."""
    lis = "".join('<li>%s <a rel="nofollow" class="external text" href="https://news.example/%s/%d">'
                  "(News)</a></li>" % (h, date, i) for i, h in enumerate(headlines))
    return ('<div class="current-events-main vevent"><span class="bday">%s</span>'
            '<div class="current-events-content"><p><b>Armed conflicts and attacks</b></p>'
            '<ul><li><a href="/wiki/2026_West_Bank_lockdown" title="2026 West Bank lockdown">'
            "2026 West Bank lockdown</a><ul>%s</ul></li></ul></div></div>" % (date, lis))


def en_client(oct24=None):
    pages = {OCT23: fixture("en_day.html")}
    if oct24:
        pages[OCT24] = day_page("2026-10-24", oct24)
    return FakeClient(day_pages=pages)


def es_client(wiki=None):
    return FakeClient(raw_pages={ES_PAGE: wiki or fixture("es_tpl_portada.wiki")})


ES_EXTRA = "* [[PHP2Shell|Publicado el parche para PHP2Shell]]\n"
ES_ORIGINAL = "Vulnerabilidad crítica en el lenguaje PHP denominada PHP2Shell"


def es_wiki_with_extra(before=True):
    wiki = fixture("es_tpl_portada.wiki")
    line = "* [[PHP2Shell|%s]]\n" % ES_ORIGINAL
    return wiki.replace(line, ES_EXTRA + line if before else line + ES_EXTRA, 1)


class GroupingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"))

    def tearDown(self):
        self.tmp.cleanup()

    def run_en(self, now=NOW, oct24=None, **kw):
        return feed.run_language(LANGUAGES["en"], en_client(oct24), now, **dict(self.dirs, **kw))

    def run_es(self, now=NOW, wiki=None, **kw):
        return feed.run_language(LANGUAGES["es"], es_client(wiki), now, **dict(self.dirs, **kw))

    def items(self, lang):
        root = ET.parse(os.path.join(self.dirs["out_dir"], lang + ".xml")).getroot()
        return root.findall("channel/item")

    def matching(self, lang, text):
        return [i for i in self.items(lang) if text in i.findtext("title")]

    def snapshot(self):
        files = {}
        for sub in ("state_dir", "out_dir"):
            for name in sorted(os.listdir(self.dirs[sub])):
                with open(os.path.join(self.dirs[sub], name), "rb") as f:
                    files[(sub, name)] = f.read()
        return files

    def state(self, lang):
        with open(os.path.join(self.dirs["state_dir"], lang + ".json"), encoding="utf-8") as f:
            return json.load(f)

    # --- en -------------------------------------------------------------------

    def test_en_groups_same_article_across_days(self):
        res = self.run_en(oct24=[RAIDS])
        self.assertEqual((res["scraped"], res["new"], res["in_feed"]), (12, 11, 11))
        [item] = self.matching("en", "lockdown")
        # Most recent page first, then document order.
        self.assertEqual(item.findtext("title"), RAIDS + " / " + LOCKDOWN)
        self.assertTrue(item.findtext("guid").startswith("wikipedia:en:2026-10-23:"))
        self.assertEqual(item.findtext("pubDate"), "Fri, 23 Oct 2026 00:00:00 GMT")
        self.assertEqual(item.findtext("link"), "https://example.org/wiki/2026_West_Bank_lockdown")
        desc = item.findtext("description")
        self.assertLess(desc.index("raids 15 cities"), desc.index("https://news.example/2026-10-24/0"))
        self.assertLess(desc.index("https://news.example/2026-10-24/0"), desc.index("prepare for a complete"))
        self.assertIn("aljazeera.com", desc)
        self.assertEqual(desc.count("Topics:"), 1)
        self.assertIn("2026_October_24", desc)
        self.assertIn("2026_October_23", desc)
        self.assertEqual([c.text for c in item.findall("category")],
                         ["Armed conflicts and attacks", "2026 West Bank lockdown"])

    def test_en_guid_and_pubdate_stable_when_member_added(self):
        self.run_en()
        [before] = self.matching("en", "lockdown")
        self.assertEqual(before.findtext("title"), LOCKDOWN)

        res = self.run_en(NOW + datetime.timedelta(hours=3), oct24=[RAIDS])
        self.assertEqual(res["new"], 0)  # absorbed into the existing item
        [after] = self.matching("en", "lockdown")
        self.assertEqual(after.findtext("title"), RAIDS + " / " + LOCKDOWN)
        self.assertEqual(after.findtext("guid"), before.findtext("guid"))
        self.assertEqual(after.findtext("pubDate"), before.findtext("pubDate"))
        self.assertEqual(len(self.items("en")), 11)

        # Re-running without changes leaves every file byte-for-byte identical.
        snap = self.snapshot()
        for hours in (4, 30):
            self.run_en(NOW + datetime.timedelta(hours=hours), oct24=[RAIDS])
            self.assertEqual(self.snapshot(), snap)

    def test_en_cap_splits_long_stories(self):
        heads = ["Headline number %d about the West Bank lockdown and its consequences." % i for i in range(4)]
        self.run_en(oct24=heads, max_group=3)
        items = self.matching("en", "lockdown")
        titles = sorted({i.findtext("title") for i in items}, key=len, reverse=True)
        # Oldest headline + the next two (oldest first) fill the first item; the rest start a new one.
        self.assertEqual(titles, [heads[0] + " / " + heads[1] + " / " + LOCKDOWN, heads[2] + " / " + heads[3]])
        self.assertEqual(len(self.items("en")), 11 + 4 - 3)

    def test_en_max_group_1_disables_grouping(self):
        self.run_en(oct24=[RAIDS], max_group=1)
        self.assertEqual(len(self.items("en")), 12)
        self.assertEqual(self.state("en")["groups"], {})

    def test_en_new_headline_joins_open_group_not_full_one(self):
        heads = ["Headline number %d about the West Bank lockdown and its consequences." % i for i in range(3)]
        self.run_en(oct24=heads[:2], max_group=3)  # full: lockdown + 2
        self.run_en(NOW + datetime.timedelta(hours=1), oct24=heads, max_group=3)
        titles = {i.findtext("title") for i in self.matching("en", "lockdown")}
        self.assertEqual(titles, {heads[0] + " / " + heads[1] + " / " + LOCKDOWN, heads[2]})

    # --- es -------------------------------------------------------------------

    def test_es_groups_bullets_about_same_article(self):
        res = self.run_es(wiki=es_wiki_with_extra(before=True))
        self.assertEqual((res["scraped"], res["new"], res["in_feed"]), (18, 17, 17))
        [item] = self.matching("es", "PHP2Shell")
        self.assertEqual(item.findtext("title"), "Publicado el parche para PHP2Shell / " + ES_ORIGINAL)
        self.assertRegex(item.findtext("guid"), r"^wikipedia:es:\d+$")
        self.assertEqual(item.findtext("description").count("Extract of PHP2Shell."), 1)

    def test_es_guid_stable_when_member_added(self):
        self.run_es()
        [before] = self.matching("es", "PHP2Shell")
        # The new bullet appears above the old one: the old one keeps the article guid.
        res = self.run_es(NOW + datetime.timedelta(days=1), wiki=es_wiki_with_extra(before=True))
        self.assertEqual(res["new"], 0)
        [after] = self.matching("es", "PHP2Shell")
        self.assertEqual(after.findtext("guid"), before.findtext("guid"))
        self.assertEqual(after.findtext("pubDate"), before.findtext("pubDate"))
        self.assertEqual(after.findtext("title"), "Publicado el parche para PHP2Shell / " + ES_ORIGINAL)
        headlines = self.state("es")["items"]
        self.assertEqual(headlines[before.findtext("guid")]["text"], ES_ORIGINAL)
        snap = self.snapshot()
        self.run_es(NOW + datetime.timedelta(days=2), wiki=es_wiki_with_extra(before=True))
        self.assertEqual(self.snapshot(), snap)

    # --- migration --------------------------------------------------------------

    def write_old_state(self, lang):
        """Turn the current state into the format written before grouping existed."""
        path = os.path.join(self.dirs["state_dir"], lang + ".json")
        state = self.state(lang)
        del state["groups"]
        for it in state["items"].values():
            for key in ("pos", "page_date", "group_key"):
                it.pop(key, None)
        st.save_state(path, state)

    def test_migration_from_ungrouped_state(self):
        # Old version: lockdown seen on the 23rd, raids seen on the 24th as separate items.
        self.run_en(NOW - datetime.timedelta(hours=8), max_group=1)
        self.run_en(NOW, oct24=[RAIDS], max_group=1)
        self.write_old_state("en")
        old_items = {i.findtext("guid"): i for i in self.items("en")}
        [lockdown_guid] = [g for g, i in old_items.items() if i.findtext("title") == LOCKDOWN]
        [raids_guid] = [g for g, i in old_items.items() if i.findtext("title") == RAIDS]
        old_pub = old_items[lockdown_guid].findtext("pubDate")

        res = self.run_en(NOW + datetime.timedelta(hours=2), oct24=[RAIDS])
        self.assertEqual(res["new"], 0)
        guids = [i.findtext("guid") for i in self.items("en")]
        self.assertEqual(len(guids), 11)
        self.assertIn(lockdown_guid, guids)    # oldest member's guid is reused
        self.assertNotIn(raids_guid, guids)    # absorbed guid leaves the feed
        [item] = self.matching("en", "lockdown")
        self.assertEqual(item.findtext("guid"), lockdown_guid)
        self.assertEqual(item.findtext("pubDate"), old_pub)
        self.assertEqual(item.findtext("title"), RAIDS + " / " + LOCKDOWN)
        state = self.state("en")
        self.assertEqual(state["groups"][lockdown_guid]["members"], [lockdown_guid, raids_guid])
        self.assertIn(raids_guid, state["items"])  # kept so it never comes back on its own

        snap = self.snapshot()
        self.run_en(NOW + datetime.timedelta(days=1), oct24=[RAIDS])
        self.assertEqual(self.snapshot(), snap)


class RegroupStateTest(unittest.TestCase):
    T0 = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)

    def item(self, guid, key="pageid:1", order=0):
        return {"guid": guid, "date": None, "date_source": "first_seen", "title": guid, "sources": [],
                "group_key": key, "order": order, "pos": order, "link": "https://x/%s" % key}

    def test_group_survives_founder_expiry(self):
        state = {"items": {}}
        st.merge(state, [self.item("a")], self.T0)
        st.merge(state, [self.item("a"), self.item("b", order=1)], self.T0 + datetime.timedelta(hours=1))
        self.assertEqual(state["groups"]["a"]["members"], ["a", "b"])
        pub = state["groups"]["a"]["pub_date"]
        # "a" leaves the portal and expires; "b" stays: the item keeps guid "a".
        for days in (1, 100):
            st.merge(state, [self.item("b", order=1)], self.T0 + datetime.timedelta(days=days), retention_days=90)
        self.assertNotIn("a", state["items"])
        [unit] = st.latest(state, 10)
        self.assertEqual((unit["guid"], unit["pub_date"], unit["title"]), ("a", pub, "b"))
        # Once every member expired the group goes too.
        st.merge(state, [], self.T0 + datetime.timedelta(days=101), retention_days=90)
        st.merge(state, [], self.T0 + datetime.timedelta(days=300), retention_days=90)
        self.assertEqual((state["items"], state["groups"]), ({}, {}))

    def test_gone_unit_is_not_reopened(self):
        state = {"items": {}}
        st.merge(state, [self.item("a")], self.T0)
        st.merge(state, [self.item("c", key="pageid:2")], self.T0 + datetime.timedelta(days=1))  # a gone
        st.merge(state, [self.item("b")], self.T0 + datetime.timedelta(days=2))
        self.assertEqual(state["groups"], {})
        self.assertEqual(sorted(u["guid"] for u in st.latest(state, 10)), ["a", "b", "c"])

    def test_items_without_article_are_never_grouped(self):
        state = {"items": {}}
        st.merge(state, [self.item("a", key=None), self.item("b", key=None, order=1)], self.T0)
        self.assertEqual(state["groups"], {})


if __name__ == "__main__":
    unittest.main()
