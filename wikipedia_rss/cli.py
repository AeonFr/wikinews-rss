import argparse
import datetime
import logging
import os
import sys

from .client import WikiClient
from .config import DEFAULT_USER_AGENT, LANGUAGES, USER_AGENT_ENV
from .feed import run_language

log = logging.getLogger("wikipedia_rss")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wikipedia_rss",
                                 description="Genera feeds RSS a partir de los portales de actualidad de Wikipedia.")
    ap.add_argument("--lang", nargs="+", choices=sorted(LANGUAGES), default=sorted(LANGUAGES))
    ap.add_argument("--days", type=int, default=7, help="días de páginas diarias a leer (modo daily_pages)")
    ap.add_argument("--out", default="feeds", help="directorio de salida de los XML")
    ap.add_argument("--state", default="state", help="directorio del estado JSON")
    ap.add_argument("--max-items", type=int, default=50)
    ap.add_argument("--base-url", help="URL pública donde se sirven los feeds (para atom:link rel=self)")
    ap.add_argument("--cache", metavar="DIR", help="caché HTTP en disco (30 min)")
    ap.add_argument("--retention-days", type=int, default=90,
                    help="días que se conserva en el estado un item que ya no aparece")
    ap.add_argument("--article-dates", action="store_true",
                    help="fechar items sin fecha con la creación del artículo si es reciente (1 petición por item nuevo)")
    ap.add_argument("--dry-run", action="store_true", help="no escribe feeds ni estado; muestra un resumen")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    user_agent = os.environ.get(USER_AGENT_ENV) or DEFAULT_USER_AGENT
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)

    failed = []
    for code in args.lang:
        cfg = LANGUAGES[code]
        client = WikiClient(cfg.host, user_agent, cache_dir=args.cache)
        try:
            res = run_language(cfg, client, now, days=args.days, max_items=args.max_items,
                               state_dir=args.state, out_dir=args.out, base_url=args.base_url,
                               dry_run=args.dry_run, article_dates=args.article_dates,
                               retention_days=args.retention_days)
        except Exception as e:
            log.error("%s: failed: %s", code, e, exc_info=args.verbose)
            failed.append(code)
            continue
        log.info("%s: %d items parsed, %d new, %d in feed, %d HTTP requests",
                 code, res["scraped"], res["new"], res["in_feed"], res["requests"])
        if args.dry_run:
            for it in res["items"][:10]:
                print("%s  %-13s %s" % (it["pub_date"], it["date_source"], it["title"]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
