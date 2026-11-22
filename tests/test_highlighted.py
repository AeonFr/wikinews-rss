"""Entries without an article of their own are about the article their text highlights (italic or bold link)."""
import datetime
import json
import os
import tempfile
import unittest
from unittest import mock

from wikipedia_rss import feed, parsers, site
from wikipedia_rss import state as st
from wikipedia_rss.config import WIKI

from helpers import FakeClient, fixture

NOW = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)
WP = "https://en.wikipedia.org/wiki/"
DAY = "Portal:Current events/2026 October 23"


def link(title, text=None, extra=""):
    return '<a href="%s%s"%s>%s</a>' % (WP, title.replace(" ", "_"), extra, text or title)


def titles(html, sources=()):
    return parsers.highlighted_titles(html, WIKI, [{"name": n, "url": "https://x/" + n} for n in sources])


class ParserTest(unittest.TestCase):
    def test_italic_and_bold_links_in_order_without_repeats(self):
        html = "A <i>%s</i> and <b>%s</b>, again <i>%s</i>." % (link("Voyager 1"), link("Pale Blue Dot"), link("Voyager 1"))
        self.assertEqual(titles(html), ["Voyager 1", "Pale Blue Dot"])

    def test_a_plain_link_or_a_link_around_emphasis_is_not_highlighted(self):
        self.assertEqual(titles("In %s and <a href=\"%sTokyo\"><i>Tokyo</i></a>." % (link("Japan"), WP)), [])
        self.assertEqual(titles("<i>The Guardian</i> says so."), [])  # emphasis without a link

    def test_the_title_is_decoded_and_the_fragment_dropped(self):
        html = '<i><a href="%sCall_of_Duty:_Modern_Warfare_II_(2022_video_game)">CoD</a></i> <b><a href="%sZ%%C3%%BCrich#History">Z</a></b>' % (WP, WP)
        self.assertEqual(titles(html), ["Call of Duty: Modern Warfare II (2022 video game)", "Zürich"])

    def test_other_namespaces_are_not_articles(self):
        html = "".join("<i>%s</i>" % link(t) for t in (
            "File:Voyager.jpg", "Category:Probes", "Portal:Current events", "Wikipedia:Notability", "Help:Contents",
            "Special:Search", "Template:Infobox", "Draft:Foo", "category:Lower", "Talk:Voyager 1", "User:Someone"))
        self.assertEqual(titles(html), [])
        # a colon in the title of an article is not a namespace
        self.assertEqual(titles("<i>%s</i>" % link("Star Wars: The Last Jedi")), ["Star Wars: The Last Jedi"])

    def test_fragment_only_links_and_other_hosts_are_ignored(self):
        html = ('<i><a href="%s#Section">x</a></i><i><a href="%s">main</a></i><i><a href="#top">y</a></i>'
                '<i><a href="https://de.wikipedia.org/wiki/Foo">de</a></i><i><a href="https://example.com/wiki/Foo">e</a></i>'
                % (WP, WP))
        self.assertEqual(titles(html), [])

    def test_red_links_are_ignored(self):
        html = '<i><a href="https://en.wikipedia.org/w/index.php?title=Nope&amp;action=edit&amp;redlink=1">Nope</a></i>'
        self.assertEqual(titles(html), [])
        self.assertEqual(titles('<i><a href="%sNope?action=edit&amp;redlink=1">Nope</a></i>' % WP), [])

    def test_links_named_like_a_cited_source_are_skipped(self):
        html = "Said <i>%s</i> and <i>%s</i> about <i>%s</i>." % (link("The Guardian"), link("BBC News"), link("Voyager 1"))
        self.assertEqual(titles(html, ["the guardian", "AP via BBC News"]), ["Voyager 1"])
        # with no such source the outlet is just a highlighted article
        self.assertEqual(titles(html), ["The Guardian", "BBC News", "Voyager 1"])

    def test_no_html(self):
        self.assertEqual(parsers.highlighted_titles("", WIKI), [])
        self.assertEqual(parsers.highlighted_titles(None, WIKI), [])


def day_page(*entries):
    body = "".join("<li>%s <a rel=\"nofollow\" class=\"external text\" href=\"https://src/%d\">(%s)</a></li>"
                   % (text, i, source) for i, (text, source) in enumerate(entries))
    return ('<div class="current-events"><div class="current-events-main vevent"><span class="bday">2026-10-23</span>'
            '<div class="current-events-content description"><p><b>Science</b></p><ul>%s</ul></div></div></div>' % body)


VOYAGER = ("NASA's space probe <i>%s</i> reaches the distance of one light-day from Earth, with extra words so "
           "that the text is long enough to count as an entry." % link("Voyager 1", extra=' title="Voyager 1"'))
GUARDIAN = ("Police investigate a case that is separate to those looked at by <i>%s</i> and a long list of other "
            "words so that it counts." % link("The Guardian"))
PLAIN = "A %s entry about nothing in particular, which is long enough to be an entry of its own on the page." % link("Tokyo")
OTHER_TOPIC = ("<a href=\"/wiki/Gaza_war\" title=\"Gaza war\">Gaza war</a><ul><li>An event with a <i>%s</i> in the "
               "middle of a text that is long enough.  <a rel=\"nofollow\" class=\"external text\" href=\"https://s/9\">(AP)</a>"
               "</li></ul>" % link("Pale Blue Dot"))


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirs = dict(state_dir=os.path.join(self.tmp.name, "state"), out_dir=os.path.join(self.tmp.name, "feeds"),
                         data_dir=os.path.join(self.tmp.name, "data"))

    def tearDown(self):
        self.tmp.cleanup()

    def client(self, html):
        return FakeClient(day_pages={DAY: html})

    def read(self, sub, name):
        with open(os.path.join(self.dirs[sub], name), encoding="utf-8") as f:
            return f.read()

    def stories(self):
        return json.loads(self.read("data_dir", "news.json"))["stories"]

    def run_feed(self, html, **kw):
        client = self.client(html)
        feed.run(WIKI, client, NOW, site_url="https://x.org", **dict(self.dirs, **kw))
        return client

    def test_a_portal_only_entry_gets_its_highlighted_link_as_more_articles(self):
        html = day_page((VOYAGER, "BBC"), (PLAIN, "AP"))
        self.run_feed(html, article_maps=False)
        by_text = {s["headlines"][0]["html"][:12]: s for s in self.stories()}
        voyager = next(s for s in self.stories() if "Voyager" in s["headlines"][0]["html"])
        self.assertIsNone(voyager["article"])
        self.assertEqual(voyager["more_articles"], [
            {"title": "Voyager 1", "url": "https://example.org/wiki/Voyager_1", "extract": "Extract of Voyager 1."}])
        plain = next(s for s in self.stories() if "Tokyo" in s["headlines"][0]["html"])
        self.assertEqual(plain["more_articles"], [])
        self.assertEqual(len(by_text), 2)

    def test_only_the_stories_without_an_article_get_them(self):
        # an entry under a topic has an article already: its highlighted link is not added
        self.run_feed(day_page((VOYAGER, "BBC")).replace("</ul>", "<li>%s</li></ul>" % OTHER_TOPIC), article_maps=False)
        topical = next(s for s in self.stories() if s["article"])
        self.assertEqual(topical["article"]["title"], "Gaza war")
        self.assertEqual(topical["more_articles"], [])
        with open(os.path.join(self.dirs["state_dir"], "en.json"), encoding="utf-8") as f:
            items = json.load(f)["items"]
        self.assertEqual(sorted(it["highlighted_articles"][0]["title"] for it in items.values()
                                if "highlighted_articles" in it and not it.get("pageid")), ["Voyager 1"])

    def test_the_source_name_is_not_an_article(self):
        self.run_feed(day_page((GUARDIAN, "The Guardian")), article_maps=False)
        [story] = self.stories()
        self.assertEqual(story["more_articles"], [])
        with open(os.path.join(self.dirs["state_dir"], "en.json"), encoding="utf-8") as f:
            self.assertNotIn("highlighted_articles", next(iter(json.load(f)["items"].values())))

    def test_a_missing_page_is_dropped(self):
        client = self.client(day_page((VOYAGER, "BBC")))
        real = client.api

        def api(retries=None, **params):
            out = real(retries, **params)
            if params["action"] == "query":
                out["query"]["pages"] = [p for p in out["query"]["pages"] if p["title"] != "Voyager 1"]
            return out
        client.api = api
        feed.run(WIKI, client, NOW, article_maps=False, **self.dirs)
        self.assertEqual(self.stories()[0]["more_articles"], [])

    def test_extracts_come_with_the_main_lookup_and_the_feed_is_untouched(self):
        html = day_page((VOYAGER, "BBC"), (PLAIN, "AP"))
        client = self.client(html)
        asked = []
        real = client.api

        def api(retries=None, **params):
            if params["action"] == "query":
                asked.append((params["titles"], params.get("prop", "")))
            return real(retries, **params)
        client.api = api
        feed.run(WIKI, client, NOW, site_url="https://x.org", article_maps=False, **self.dirs)
        # the highlighted article is looked up with the others, with its extract
        self.assertTrue(any("Voyager 1" in titles_.split("|") and "extracts" in prop for titles_, prop in asked))
        self.assertEqual(len(asked), 1)
        xml = self.read("out_dir", "en.xml")
        # the same run without the feature gives the very same feed (and a state without the new key)
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        dirs = {k: os.path.join(other.name, k) for k in ("state_dir", "out_dir", "data_dir")}
        with mock.patch.object(feed, "highlighted_titles", lambda cfg, it: []):
            feed.run(WIKI, self.client(html), NOW, site_url="https://x.org", article_maps=False, **dirs)
        with open(os.path.join(dirs["out_dir"], "en.xml"), encoding="utf-8") as f:
            self.assertEqual(f.read(), xml)

    def test_the_existing_fixture_is_unchanged(self):
        # nothing in it is highlighted: the same stories, the same state, the same feed as without the feature
        self.run_feed(fixture("en_day.html"), article_maps=False)
        xml, data, state = (self.read("out_dir", "en.xml"), self.read("data_dir", "news.json"), self.read("state_dir", "en.json"))
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        dirs = {k: os.path.join(other.name, k) for k in ("state_dir", "out_dir", "data_dir")}
        with mock.patch.object(feed, "highlighted_titles", lambda cfg, it: []):
            feed.run(WIKI, self.client(fixture("en_day.html")), NOW, site_url="https://x.org", article_maps=False, **dirs)
        for sub, name, text in (("out_dir", "en.xml", xml), ("data_dir", "news.json", data), ("state_dir", "en.json", state)):
            with open(os.path.join(dirs[sub], name), encoding="utf-8") as f:
                self.assertEqual(f.read(), text)
        self.assertNotIn("highlighted_articles", state)

    def test_stored_headlines_are_backfilled_once(self):
        # state written before the feature: the entry is stored, not on the scraped pages any more
        self.run_feed(day_page((VOYAGER, "BBC")), article_maps=False)
        path = os.path.join(self.dirs["state_dir"], "en.json")
        state = st.load_state(path)
        [it] = state["items"].values()
        del it["highlighted_articles"]
        st.save_state(path, state)
        client = self.client(day_page((VOYAGER, "BBC")))
        pages = {}
        feed.backfill_highlighted(WIKI, client, state, pages)
        self.assertEqual([a["title"] for a in it["highlighted_articles"]], ["Voyager 1"])
        before = client.requests
        feed.backfill_highlighted(WIKI, client, state, pages)  # now it has the key: no request
        self.assertEqual(client.requests, before)

    def test_the_highlighted_articles_join_the_map_candidates_after_the_others(self):
        html = day_page((VOYAGER, "BBC")).replace("</ul>", "<li>%s</li></ul>" % OTHER_TOPIC)
        client = self.client(html)
        self.run_feed(html, article_maps=False)
        with open(os.path.join(self.dirs["state_dir"], "en.json"), encoding="utf-8") as f:
            state = json.load(f)
        stories = st.rss_latest(state, None, with_retired=True)
        urls = [a["title"] for a in site.story_articles(stories)]
        self.assertEqual(urls, ["Gaza war", "Voyager 1"])
        client = self.client(html)
        feed.run(WIKI, client, NOW, **self.dirs)
        self.assertEqual(sorted(client.leads), ["Gaza war", "Voyager 1"])
        # and a map found for it ends up on the story
        info = {"https://example.org/wiki/Voyager_1": {"checked": "2026-10-24T09:00:00Z", "location": "Interstellar space"}}
        data = site.build_data(WIKI, stories, state["updated"], 183, None, info)
        voyager = next(s for s in data["stories"] if "Voyager" in s["headlines"][0]["html"])
        self.assertEqual(voyager["more_articles"][0]["location"], "Interstellar space")

    def test_the_cap_is_not_raised(self):
        # the cap is per run whatever the articles are: 1 request when the cap is 1
        html = day_page((VOYAGER, "BBC")).replace("</ul>", "<li>%s</li></ul>" % OTHER_TOPIC)
        client = self.client(html)
        feed.run(WIKI, client, NOW, max_article_fetches=1, **self.dirs)
        self.assertEqual(client.leads, ["Gaza war"])  # the topic's article first, the implicit one waits


if __name__ == "__main__":
    unittest.main()
