import datetime
import unittest

from wikipedia_rss import parsers
from wikipedia_rss.config import WIKI

from helpers import fixture



class DailyPagesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items = parsers.parse_daily_html(fixture("en_day.html"), WIKI, datetime.date(2026, 1, 1),
                                             "Portal:Current events/2026 October 23")

    def test_leaf_items(self):
        self.assertEqual(len(self.items), 11)
        self.assertTrue(all(it["date"] == datetime.date(2026, 10, 23) for it in self.items))  # from span.bday
        self.assertTrue(all(it["sources"] for it in self.items))

    def test_first_item(self):
        it = self.items[0]
        self.assertEqual(it["category"], "Armed conflicts and attacks")
        self.assertEqual([t["title"] for t in it["topics"]], ["Gaza war", "2026 West Bank lockdown"])
        self.assertEqual(it["main_title"], "Gaza war")
        self.assertEqual(it["sources"][0]["name"], "Al Jazeera")
        self.assertTrue(it["title"].startswith("The Israeli government orders"))
        self.assertTrue(it["title"].endswith("West Bank."))
        self.assertIn('<a href="https://en.wikipedia.org/wiki/West_Bank">West Bank</a>', it["html"])
        self.assertNotIn("aljazeera", it["html"])  # sources are listed separately

    def test_multiple_sources_and_no_topic(self):
        typhoon = self.items[3]
        self.assertEqual([s["name"] for s in typhoon["sources"]], ["AFP via France 24", "Reuters"])
        nairobi = self.items[4]
        self.assertIsNone(nairobi["main_title"])
        self.assertEqual(nairobi["topics"], [])
        self.assertEqual(self.items[-1]["category"], "Sports")

    def test_page_title(self):
        self.assertEqual(parsers.daily_page_title(WIKI, datetime.date(2026, 10, 3)),
                         "Portal:Current events/2026 October 3")


class HelpersTest(unittest.TestCase):
    def test_first_sentence(self):
        self.assertEqual(parsers.first_sentence("The U.S. Senate votes. Then more."), "The U.S. Senate votes.")
        long = "word " * 100
        self.assertTrue(parsers.first_sentence(long).endswith("…"))
        self.assertLessEqual(len(parsers.first_sentence(long)), 201)

    def test_text_hash_ignores_punctuation_and_case(self):
        self.assertEqual(parsers.text_hash("A ship, hit!"), parsers.text_hash("a  ship hit"))


if __name__ == "__main__":
    unittest.main()
