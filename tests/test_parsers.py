import datetime
import unittest

from wikipedia_rss import parsers
from wikipedia_rss.config import LANGUAGES

from helpers import fixture

EN, ES = LANGUAGES["en"], LANGUAGES["es"]


class DailyPagesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items = parsers.parse_daily_html(fixture("en_day.html"), EN, datetime.date(2026, 1, 1),
                                             "Portal:Current events/2026 October 23")

    def test_leaf_items(self):
        self.assertEqual(len(self.items), 11)
        self.assertTrue(all(it["date"] == datetime.date(2026, 10, 23) for it in self.items))  # from span.bday
        self.assertTrue(all(it["sources"] for it in self.items))

    def test_first_item(self):
        it = self.items[0]
        self.assertEqual(it["category"], "Armed conflicts and attacks")
        self.assertEqual([t["title"] for t in it["topics"]], ["Gaza war", "2026 West Bank lockdown"])
        self.assertEqual(it["main_title"], "2026 West Bank lockdown")
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
        self.assertEqual(parsers.daily_page_title(EN, datetime.date(2026, 10, 3)),
                         "Portal:Current events/2026 October 3")


class SingleListTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items = parsers.parse_single_list(fixture("es_tpl_portada.wiki"), ES, datetime.date(2026, 10, 24))
        cls.by_main = {it["main_title"]: it for it in cls.items}

    def test_skips_deaths_and_commemorations(self):
        self.assertEqual(len(self.items), 17)
        titles = " ".join(it["title"] for it in self.items)
        self.assertNotIn("Dónal Lunny", titles)
        self.assertNotIn("Naciones Unidas", titles)

    def test_group_bullet_is_split(self):
        conflicts = [it for it in self.items if it["category"] == "Guerras y conflictos"]
        self.assertEqual(len(conflicts), 7)
        self.assertEqual(conflicts[1]["title"], "Guerras y conflictos: Gaza-Israel")
        self.assertEqual(conflicts[1]["main_title"], "Guerra de Gaza")

    def test_date_prefixes(self):
        it = self.by_main["Festival de la Canción de Eurovisión Junior 2026"]
        self.assertEqual((it["date"], it["date_source"]), (datetime.date(2026, 10, 24), "text_date"))
        self.assertEqual(it["title"], "Festival de la Canción de Eurovisión Junior")
        rng = self.by_main["Copa Mundial Femenina de Fútbol Sub-17 de 2026"]  # "17 de octubre-7 de noviembre"
        self.assertEqual(rng["date"], datetime.date(2026, 10, 17))
        self.assertEqual(self.by_main["Premios Princesa de Asturias"]["title"],
                         "Entrega de los Premios Princesa de Asturias")
        undated = self.by_main["PHP2Shell"]
        self.assertEqual((undated["date"], undated["date_source"]), (None, "first_seen"))

    def test_html_links(self):
        it = self.by_main["PHP2Shell"]
        self.assertEqual(it["html"], '<a href="https://es.wikipedia.org/wiki/PHP2Shell">'
                                     'Vulnerabilidad crítica en el lenguaje PHP denominada PHP2Shell</a>')


class HelpersTest(unittest.TestCase):
    def test_infer_date(self):
        d = datetime.date
        self.assertEqual(parsers.infer_date(23, 10, d(2026, 10, 24)), d(2026, 10, 23))
        self.assertEqual(parsers.infer_date(28, 12, d(2027, 1, 3)), d(2026, 12, 28))
        self.assertIsNone(parsers.infer_date(2, 1, d(2026, 12, 30)))   # next January: future
        self.assertIsNone(parsers.infer_date(30, 10, d(2026, 10, 24)))  # future
        self.assertIsNone(parsers.infer_date(31, 2, d(2026, 10, 24)))

    def test_first_sentence(self):
        self.assertEqual(parsers.first_sentence("The U.S. Senate votes. Then more."), "The U.S. Senate votes.")
        long = "word " * 100
        self.assertTrue(parsers.first_sentence(long).endswith("…"))
        self.assertLessEqual(len(parsers.first_sentence(long)), 201)

    def test_text_hash_ignores_punctuation_and_case(self):
        self.assertEqual(parsers.text_hash("A ship, hit!"), parsers.text_hash("a  ship hit"))


if __name__ == "__main__":
    unittest.main()
