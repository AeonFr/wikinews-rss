"""Persistent per-language state: guid -> item (with first_seen and pub_date)."""
import datetime
import json
import os
import tempfile


def utc_iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)


def write_atomic(path, data):
    """Write text to path via a temp file in the same directory + rename."""
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def load_state(path):
    if not os.path.exists(path):
        return {"items": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_state(path, state):
    write_atomic(path, json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def pub_date_for(item, first_seen):
    """pubDate: the item's own date if it has one, else the moment it was first seen.

    A dated item seen on that same day keeps the precise first_seen time.
    """
    date = item.get("date")
    if date and date != first_seen.date().isoformat():
        return date + "T00:00:00Z"
    return utc_iso(first_seen)


def merge(state, items, now, retention_days=90):
    """Merge freshly scraped items (each with a 'guid') into state. Returns the new guids.

    Known items keep first_seen, pub_date and date_source; their content is refreshed.
    Items no longer on the portal stay until not seen for retention_days.
    """
    known = state.setdefault("items", {})
    now_iso = utc_iso(now)
    scraped = {it["guid"] for it in items}
    # An edited daily item gets a new text hash; recognise it by date + first source URL.
    by_source = {}
    for guid, old in known.items():
        if old.get("sources") and guid not in scraped:
            by_source.setdefault((old.get("date"), old["sources"][0]["url"]), guid)

    new = []
    for item in items:
        guid = item["guid"]
        if guid not in known and item.get("sources"):
            alias = by_source.pop((item.get("date"), item["sources"][0]["url"]), None)
            if alias:
                guid = item["guid"] = alias
        old = known.get(guid)
        if old:
            for key in ("first_seen", "pub_date", "date_source", "date"):
                item[key] = old.get(key)
        else:
            item["first_seen"] = now_iso
            item["pub_date"] = pub_date_for(item, now)
            new.append(guid)
        item["last_seen"] = now_iso
        known[guid] = item

    cutoff = now - datetime.timedelta(days=retention_days)
    for guid in [g for g, it in known.items() if parse_iso(it["last_seen"]) < cutoff]:
        del known[guid]
    state["updated"] = now_iso
    return new


def latest(state, limit):
    items = sorted(state.get("items", {}).values(),
                   key=lambda it: (it["pub_date"], it["first_seen"], -it.get("order", 0)),
                   reverse=True)
    return items[:limit]
