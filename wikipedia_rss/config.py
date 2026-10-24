"""Per-language configuration. Add a language by adding an entry to LANGUAGES."""
from dataclasses import dataclass, field
from typing import Dict, List
from urllib.parse import quote

DEFAULT_USER_AGENT = "wikipedia-noticias-rss/0.1 (francanobr@gmail.com)"
USER_AGENT_ENV = "WIKIPEDIA_RSS_USER_AGENT"

LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"


@dataclass
class LangConfig:
    code: str
    host: str
    # "daily_pages": one page per day (title built from daily_title).
    # "single_list": one hand-edited bullet list (list_page, read as wikitext).
    mode: str
    portal: str
    month_names: List[str]
    daily_title: str = ""      # e.g. "Portal:Current events/{year} {month} {day}"
    list_page: str = ""
    # Sections (";Heading" in single_list, "<p><b>" in daily_pages) to skip, case-insensitive prefix match.
    skip_sections: List[str] = field(default_factory=list)
    # Link namespaces that are never articles (images, categories...).
    ignore_namespaces: List[str] = field(default_factory=list)
    # Fetch article intro extracts to use in the item description.
    use_extracts: bool = False
    strings: Dict[str, str] = field(default_factory=dict)

    def url(self, title):
        return "https://%s/wiki/%s" % (self.host, quote(title.replace(" ", "_"), safe="/:(),'!*"))

    def history_url(self, title):
        return "https://%s/w/index.php?title=%s&action=history" % (self.host, quote(title.replace(" ", "_"), safe="/:"))


LANGUAGES = {
    "en": LangConfig(
        code="en",
        host="en.wikipedia.org",
        mode="daily_pages",
        portal="Portal:Current events",
        daily_title="Portal:Current events/{year} {month} {day}",
        month_names=["January", "February", "March", "April", "May", "June", "July",
                     "August", "September", "October", "November", "December"],
        ignore_namespaces=["File", "Image", "Category"],
        strings={
            "title": "Wikipedia Current events",
            "description": "News items from Wikipedia's Portal:Current events, one item per entry of the daily pages.",
            "sources": "Sources",
            "topics": "Topics",
            "attribution": "From Wikipedia's {page} ({history}). Text licensed under {license}.",
            "history": "history",
            "copyright": "Text from Wikipedia contributors, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).",
        },
    ),
    "es": LangConfig(
        code="es",
        host="es.wikipedia.org",
        mode="single_list",
        portal="Portal:Actualidad",
        list_page="Plantilla:Portada:Actualidad",
        month_names=["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                     "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        skip_sections=["Fallecimientos", "Conmemoraciones"],
        ignore_namespaces=["Archivo", "File", "Imagen", "Image", "Categoría", "Category"],
        use_extracts=True,
        strings={
            "title": "Wikipedia Actualidad",
            "description": "Temas de actualidad de la portada de Wikipedia en español (Plantilla:Portada:Actualidad).",
            "sources": "Fuentes",
            "topics": "Temas",
            "attribution": "De {page} de Wikipedia ({history}). Texto bajo licencia {license}.",
            "history": "historial",
            "copyright": "Texto de colaboradores de Wikipedia, bajo licencia CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).",
        },
    ),
}
