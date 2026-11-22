import os
import zlib

from wikipedia_rss.client import ApiError

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return f.read()


class FakeClient:
    """Offline stand-in for WikiClient serving the fixtures."""

    def __init__(self, day_pages=None, article_pages=None, failing=(), raising=None, on_request=None):
        self.day_pages = day_pages or {}
        # Lead sections (section="0") of articles by title; an article not here does not exist.
        self.article_pages = article_pages or {}
        self.failing = set(failing)  # articles whose request fails with an API error
        self.raising = dict(raising or {})  # article title -> exception raised by its request
        self.on_request = on_request        # called with no arguments on every request (fake clocks)
        self.requests = 0
        self.leads = []              # titles asked for as lead sections, in order
        self.lead_retries = []       # the `retries` override of each of those requests

    def api(self, retries=None, **params):
        self.requests += 1
        if self.on_request:
            self.on_request()
        if params["action"] == "parse":
            if params.get("section") == "0":
                self.leads.append(params["page"])
                self.lead_retries.append(retries)
                if params["page"] in self.raising:
                    raise self.raising[params["page"]]
                if params["page"] in self.failing:
                    raise ApiError("internal_api_error_DBQueryError")
                if params["page"] in self.article_pages:
                    return {"parse": {"title": params["page"], "text": self.article_pages[params["page"]]}}
                raise ApiError("missingtitle")
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
