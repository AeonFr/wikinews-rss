"""Configuration of the source portal (English Wikipedia's Portal:Current events)."""
from dataclasses import dataclass, field
from typing import Dict, List
from urllib.parse import quote

DEFAULT_USER_AGENT = "wikipedia-noticias-rss/0.1 (francanobr@gmail.com)"
USER_AGENT_ENV = "WIKIPEDIA_RSS_USER_AGENT"

# Used to fetch the news sites' pages (link previews). Deliberately generic, with no
# contact details: those belong to the Wikipedia user agent above, not to third parties.
SOURCES_USER_AGENT = "Mozilla/5.0 (compatible; wikipedia-noticias-link-preview/0.1)"
SOURCES_USER_AGENT_ENV = "WIKIPEDIA_RSS_SOURCES_USER_AGENT"

LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"

# News older than this many days is deleted from the state, the feed and the website.
RETENTION_DAYS = 183  # about 6 months


@dataclass
class WikiConfig:
    code: str  # also the name of the feed (feeds/<code>.xml) and of the state file
    host: str
    portal: str
    daily_title: str  # e.g. "Portal:Current events/{year} {month} {day}"
    month_names: List[str]
    # Sections ("<p><b>" in the daily pages) to skip, case-insensitive prefix match.
    skip_sections: List[str] = field(default_factory=list)
    # Link namespaces that are never articles (images, categories...).
    ignore_namespaces: List[str] = field(default_factory=list)
    # Fetch article intro extracts (shown in the card of the story page).
    use_extracts: bool = False
    strings: Dict[str, str] = field(default_factory=dict)

    def url(self, title):
        return "https://%s/wiki/%s" % (self.host, quote(title.replace(" ", "_"), safe="/:(),'!*"))

    def history_url(self, title):
        return "https://%s/w/index.php?title=%s&action=history" % (self.host, quote(title.replace(" ", "_"), safe="/:"))


WIKI = WikiConfig(
    code="en",
    host="en.wikipedia.org",
    portal="Portal:Current events",
    daily_title="Portal:Current events/{year} {month} {day}",
    month_names=["January", "February", "March", "April", "May", "June", "July",
                 "August", "September", "October", "November", "December"],
    ignore_namespaces=["File", "Image", "Category"],
    use_extracts=True,
    strings={
        "title": "Wikipedia Current events",
        "description": "News items from Wikipedia's Portal:Current events, one item per entry of the daily pages.",
        "sources": "Sources",
        "topics": "Topics",
        "attribution": "From Wikipedia's {page} ({history}). Text licensed under {license}.",
        "history": "history",
        "copyright": "Text from Wikipedia contributors, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).",
    },
)
