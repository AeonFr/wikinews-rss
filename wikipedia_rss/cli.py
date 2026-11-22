import argparse
import datetime
import logging
import os
import sys

from .client import WikiClient
from .config import (DEFAULT_USER_AGENT, RETENTION_DAYS, SOURCES_USER_AGENT, SOURCES_USER_AGENT_ENV,
                     USER_AGENT_ENV, WIKI)
from .feed import run
from .limits import ARTICLE_FETCH_DELAY
from .sources import Fetcher
from .state import MAX_GROUP

log = logging.getLogger("wikipedia_rss")


def main(argv=None, now=None):
    """`now` (datetime con zona) permite fijar el reloj, p. ej. en tests; por defecto, la hora actual UTC."""
    ap = argparse.ArgumentParser(prog="wikipedia_rss",
                                 description="Genera el feed RSS y los datos de la web a partir de "
                                             "Portal:Current events de la Wikipedia en inglés.")
    ap.add_argument("--days", type=int, default=7, help="días de páginas diarias a leer")
    ap.add_argument("--out", default="feeds", help="directorio de salida del feed XML")
    ap.add_argument("--data", default="data", help="directorio de salida de los datos de la web (news.json)")
    ap.add_argument("--state", default="state", help="directorio del estado JSON")
    ap.add_argument("--max-items", type=int, default=50, help="máximo de items en el feed RSS (la web los muestra todos)")
    ap.add_argument("--site-url", help="URL pública de la web (raíz): los items del feed enlazan a sus páginas "
                                       "y se añade atom:link rel=self; sin ella enlazan al artículo de Wikipedia")
    ap.add_argument("--cache", metavar="DIR", help="caché HTTP en disco (30 min)")
    ap.add_argument("--retention-days", type=int, default=RETENTION_DAYS,
                    help="las noticias con más de N días se borran del estado, el feed y la web")
    ap.add_argument("--max-group", type=int, default=MAX_GROUP,
                    help="máximo de titulares sobre el mismo artículo agrupados en un item (1 desactiva la agrupación)")
    ap.add_argument("--no-source-previews", action="store_true",
                    help="no descarga título, descripción e imagen de las fuentes citadas (data/sources.json)")
    ap.add_argument("--no-article-maps", action="store_true",
                    help="no lee el mapa ni la ubicación del infobox de los artículos (state/articles.json)")
    ap.add_argument("--dry-run", action="store_true", help="no escribe feed, datos ni estado; muestra un resumen")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    user_agent = os.environ.get(USER_AGENT_ENV) or DEFAULT_USER_AGENT
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)

    client = WikiClient(WIKI.host, user_agent, cache_dir=args.cache)
    fetch_source = None
    if not args.no_source_previews:
        fetch_source = Fetcher(os.environ.get(SOURCES_USER_AGENT_ENV) or SOURCES_USER_AGENT)
    try:
        res = run(WIKI, client, now, days=args.days, max_items=args.max_items,
                  state_dir=args.state, out_dir=args.out, data_dir=args.data, site_url=args.site_url,
                  dry_run=args.dry_run, retention_days=args.retention_days, max_group=args.max_group,
                  fetch_source=fetch_source, article_maps=not args.no_article_maps,
                  article_delay=ARTICLE_FETCH_DELAY)
    except Exception as e:
        log.error("%s: failed: %s", WIKI.code, e, exc_info=args.verbose)
        return 1
    log.info("%s: %d items parsed, %d new, %d in feed, %d HTTP requests",
             WIKI.code, res["scraped"], res["new"], res["in_feed"], res["requests"])
    if args.dry_run:
        for it in res["items"][:10]:
            print("%s  %s" % (it["pub_date"], it["title"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
