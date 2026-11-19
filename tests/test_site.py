import unittest

from wikipedia_rss import site


class UrlsTest(unittest.TestCase):
    def test_story_id_is_short_and_url_safe(self):
        self.assertEqual(site.story_id("wikipedia:en:2026-10-18:1c69c8c8eee6"), "2026-10-18-1c69c8c8eee6")

    def test_story_url(self):
        self.assertEqual(site.story_url("https://x.org/news/", "wikipedia:en:2026-10-18:1c69c8c8eee6"),
                         "https://x.org/news/story.html?id=2026-10-18-1c69c8c8eee6")


if __name__ == "__main__":
    unittest.main()
