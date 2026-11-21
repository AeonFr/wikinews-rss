import os
import tempfile
import unittest

from wikipedia_rss import stamp

ROOT = os.path.join(os.path.dirname(__file__), "..")


class StampTest(unittest.TestCase):
    def make_site(self, tmp):
        os.makedirs(os.path.join(tmp, "assets"))
        for name, text in (("site.css", "a{}"), ("site.js", "1;")):
            with open(os.path.join(tmp, "assets", name), "w") as f:
                f.write(text)
        with open(os.path.join(tmp, "index.html"), "w") as f:
            f.write('<link href="assets/site.css"><script src="assets/site.js"></script>'
                    '<a href="story.html">x</a><img src="https://x.org/assets/other.png">')

    def test_references_get_the_hash_of_their_file_and_it_follows_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.make_site(tmp)
            self.assertEqual(stamp.stamp(tmp), ["index.html"])
            html = open(os.path.join(tmp, "index.html")).read()
            css, js = (stamp.asset_hash(os.path.join(tmp, "assets", n)) for n in ("site.css", "site.js"))
            self.assertIn('href="assets/site.css?v=%s"' % css, html)
            self.assertIn('src="assets/site.js?v=%s"' % js, html)
            self.assertIn('href="story.html"', html)                      # other links are left alone
            self.assertIn('src="https://x.org/assets/other.png"', html)   # so are other sites' assets
            self.assertEqual(stamp.stamp(tmp), [])                        # idempotent
            # Change an asset: only its own reference changes.
            with open(os.path.join(tmp, "assets", "site.css"), "w") as f:
                f.write("a{color:red}")
            self.assertEqual(stamp.stamp(tmp), ["index.html"])
            new = open(os.path.join(tmp, "index.html")).read()
            self.assertNotIn("site.css?v=%s" % css, new)
            self.assertIn('src="assets/site.js?v=%s"' % js, new)

    def test_check_only_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.make_site(tmp)
            self.assertEqual(stamp.main(["--root", tmp, "--check"]), 1)
            self.assertNotIn("?v=", open(os.path.join(tmp, "index.html")).read())
            stamp.main(["--root", tmp])
            self.assertEqual(stamp.main(["--root", tmp, "--check"]), 0)

    def test_the_pages_of_the_site_are_stamped_with_their_current_assets(self):
        # Fails when an asset was edited and the pages were not stamped: run
        # `python3 -m wikipedia_rss.stamp`.
        self.assertEqual(stamp.stamp(ROOT, write=False), [])
        for page in ("index.html", "story.html"):
            html = open(os.path.join(ROOT, page), encoding="utf-8").read()
            self.assertRegex(html, r'assets/site\.css\?v=[0-9a-f]{10}"')
            self.assertRegex(html, r'assets/site\.js\?v=[0-9a-f]{10}"')


if __name__ == "__main__":
    unittest.main()
