"""Cache busting for the website's assets.

The site is plain static files, so a browser keeps using a cached assets/site.css or
assets/site.js until its cache expires, whatever was deployed. Each reference to an asset in
the HTML pages carries a `?v=` with a hash of the asset's content, so that the URL changes
exactly when the file does:

    <link rel="stylesheet" href="assets/site.css?v=3f9a1c07b2">

    python3 -m wikipedia_rss.stamp          # rewrite the references that are out of date
    python3 -m wikipedia_rss.stamp --check  # only report them (exit code 1 if any)

The tests check that the stamps are current, and the scheduled workflow stamps before it commits,
so a change to an asset that nobody stamped does not stay unnoticed.
"""
import argparse
import glob
import hashlib
import os
import re
import sys

# assets/<name>.css or .js, optionally already stamped, in an attribute of an HTML page.
REFERENCE = re.compile(r'(assets/[\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(?=")')
HASH_LENGTH = 10


def asset_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:HASH_LENGTH]


def stamped(html, root):
    """The page with every asset reference carrying the current hash of its file."""
    def replace(match):
        asset = match.group(1)
        return "%s?v=%s" % (asset, asset_hash(os.path.join(root, asset)))
    return REFERENCE.sub(replace, html)


def stamp(root=".", write=True):
    """Stamp the HTML pages in `root`; returns the pages that were out of date."""
    stale = []
    for path in sorted(glob.glob(os.path.join(root, "*.html"))):
        with open(path, encoding="utf-8", newline="") as f:
            html = f.read()
        new = stamped(html, root)
        if new != html:
            stale.append(os.path.basename(path))
            if write:
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new)
    return stale


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wikipedia_rss.stamp", description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".", help="directory with the HTML pages and assets/ (default: .)")
    ap.add_argument("--check", action="store_true", help="do not write: exit with 1 if a page is out of date")
    args = ap.parse_args(argv)
    stale = stamp(args.root, write=not args.check)
    for name in stale:
        print("%s: %s" % (name, "out of date" if args.check else "stamped"))
    return 1 if args.check and stale else 0


if __name__ == "__main__":
    sys.exit(main())
