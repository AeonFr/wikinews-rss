import os
import zlib

from wikipedia_rss.client import ApiError

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return f.read()


class FakeClient:
    """Offline stand-in for WikiClient serving the fixtures."""

    def __init__(self, day_pages=None, raw_pages=None):
        self.day_pages = day_pages or {}
        self.raw_pages = raw_pages or {}
        self.requests = 0

    def raw(self, title):
        self.requests += 1
        return self.raw_pages[title]

    def api(self, **params):
        self.requests += 1
        if params["action"] == "parse":
            if params["page"] not in self.day_pages:
                raise ApiError("missingtitle")
            return {"parse": {"title": params["page"], "text": self.day_pages[params["page"]]}}
        titles = params["titles"].split("|")
        pages = [{"title": t, "pageid": zlib.crc32(t.encode()) % 10 ** 7,
                  "pageprops": {"wikibase_item": "Q1"},
                  "canonicalurl": "https://example.org/wiki/" + t.replace(" ", "_"),
                  "extract": "Extract of %s." % t}
                 for t in titles]
        return {"query": {"pages": pages}}
