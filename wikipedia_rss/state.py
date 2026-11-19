"""Persistent per-language state.

- "items": headline guid -> headline (one portal entry, with first_seen and pub_date).
- "groups": feed guid -> {"members": [headline guids], "first_seen", "pub_date"} for
  headlines about the same main article and the same day shown as one feed item. The key
  is the guid of the group's first (oldest) headline and never changes, nor do
  first_seen/pub_date, when headlines are added. Headlines in no group are feed items on
  their own.

The state only changes when the scraped content changes, so a run that finds
nothing new leaves the file byte-for-byte identical (no per-run timestamps):

- "updated" is the time of the last real change (it is also the feed's lastBuildDate).

Retention: headlines (and groups) whose pub_date is older than `retention_days` are
deleted, whether or not they are still on the portal, so the state, the feed and the
website do not grow indefinitely. Old headlines that are still scraped are ignored.
"""
import datetime
import json
import os
import tempfile

from .config import RETENTION_DAYS


def utc_iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)


def write_atomic(path, data):
    """Write text to path via a temp file in the same directory + rename.

    Does nothing if the file already has exactly this content. Returns True if written.
    """
    try:
        with open(path, encoding="utf-8", newline="") as f:
            if f.read() == data:
                return False
    except FileNotFoundError:
        pass
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
    return True


def load_state(path):
    if not os.path.exists(path):
        return {"items": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump_state(state):
    return json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def save_state(path, state):
    return write_atomic(path, dump_state(state))


def pub_date_for(item, first_seen):
    """pubDate: the item's own date if it has one, else the moment it was first seen.

    A dated item seen on that same day keeps the precise first_seen time.
    """
    date = item.get("date")
    if date and date != first_seen.date().isoformat():
        return date + "T00:00:00Z"
    return utc_iso(first_seen)


def merge(state, items, now, retention_days=RETENTION_DAYS, max_group=3):
    """Merge freshly scraped headlines (each with a 'guid') into state, then group them.

    Returns the guids of the new feed items (new headlines not absorbed by a group).

    Known headlines keep first_seen, pub_date and date_source; their content is refreshed.
    Headlines (and groups) with a pub_date older than retention_days are deleted, and new
    headlines that old are ignored. Headlines that are no longer on the portal are kept
    until then. state["updated"] only moves to now if the state actually changed.
    """
    known = state.setdefault("items", {})
    # State written before grouping existed: regroup everything currently scraped.
    migrating = "groups" not in state
    groups = state.setdefault("groups", {})
    before = json.dumps([known, groups], sort_keys=True)
    now_iso = utc_iso(now)
    cutoff = utc_iso(now - datetime.timedelta(days=retention_days))
    scraped = {it["guid"] for it in items}
    # An edited daily item gets a new text hash; recognise it by date + first source URL.
    by_source = {}
    for guid, old in known.items():
        if old.get("sources") and guid not in scraped:
            by_source.setdefault((old.get("date"), old["sources"][0]["url"]), guid)

    new, current = [], set()
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
            if item["pub_date"] < cutoff:
                continue
            new.append(guid)
        known[guid] = item
        current.add(guid)

    expire(state, cutoff)

    current &= set(known)
    owner = regroup(state, [it["guid"] for it in items if it["guid"] in known],
                    list(current) if migrating else new, max_group)
    if "updated" not in state or json.dumps([known, groups], sort_keys=True) != before:
        state["updated"] = now_iso
    return [g for g in new if owner.get(g, g) == g]


def expire(state, cutoff):
    """Delete groups and ungrouped headlines whose pub_date is older than `cutoff` (ISO string).

    A group goes as a whole when its pub_date (its founder's) is old: its headlines are all
    from the same day. Also drops keys written by older versions ("last_seen", "gone_since").
    """
    known, groups = state["items"], state["groups"]
    for g, rec in list(groups.items()):
        if rec["pub_date"] < cutoff:
            for m in rec["members"]:
                known.pop(m, None)
            del groups[g]
    grouped = {m for rec in groups.values() for m in rec["members"]}
    for guid, it in list(known.items()):
        it.pop("last_seen", None)
        it.pop("gone_since", None)
        if guid not in grouped and it["pub_date"] < cutoff:
            del known[guid]


def _first_key(it):
    return (it["pub_date"], it["first_seen"], it.get("order", 0))


def day_of(rec):
    """UTC calendar day of a headline or group: the day of its pub_date.

    pub_date is the item's own date (en: daily page; es: bullet prefix) at 00:00, or
    first_seen when it has no date (or was first seen on that same day), so this is the
    event's day, falling back to the day it was first seen.
    """
    return rec["pub_date"][:10]


def split_mixed_days(state):
    """Undo groups formed by older versions that mixed headlines from different days.

    Members whose day differs from the group's (its founder's: the group's pub_date)
    leave the group and become feed items on their own again, under their own headline
    guid with their own first_seen/pub_date (both already in "items"). The group keeps its
    guid and dates; if only its founder is left the record is dropped (same feed item).
    """
    known, groups = state["items"], state["groups"]
    for g in list(groups):
        rec = groups[g]
        rec["members"] = [m for m in rec["members"] if m not in known or day_of(known[m]) == day_of(rec)]
        if rec["members"] == [g]:
            del groups[g]


def regroup(state, current, pending, max_group):
    """Put each pending headline into the group of its main article and day.

    current: headline guids scraped in this run; pending: the ones not yet assigned
    (new headlines, or every scraped one when migrating an old state).
    A pending headline joins the most recent open unit (feed item) with the same
    "group_key" and the same day (day_of: the unit's day is its founder's) that is still
    on the portal (has a headline in `current`) and has fewer than max_group headlines;
    otherwise it starts its own unit, so a later development of a story is a new item.
    Pending headlines are processed oldest first, so a unit's guid and pubDate are those
    of its oldest headline. Assignments are never revisited, which keeps guids stable.
    Returns headline guid -> unit guid for grouped headlines.
    """
    known, groups = state["items"], state["groups"]
    split_mixed_days(state)
    for g in list(groups):
        groups[g]["members"] = [m for m in groups[g]["members"] if m in known]
        if not groups[g]["members"]:  # every headline expired by retention
            del groups[g]
    owner = {m: g for g, rec in groups.items() for m in rec["members"]}

    def unit(u):
        return groups[u] if u in groups else known[u]

    def unit_key(u):
        members = groups[u]["members"] if u in groups else [u]
        return next((known[m]["group_key"] for m in members if known[m].get("group_key")), None)

    pending = sorted(set(pending), key=lambda g: _first_key(known[g]))
    waiting = set(pending)
    open_units = {}  # (group_key, day) -> live unit guids
    for u in sorted({owner.get(g, g) for g in current if g not in waiting}):
        key = unit_key(u)
        if key:
            open_units.setdefault((key, day_of(unit(u))), []).append(u)

    for h in pending:
        key = known[h].get("group_key")
        if not key:
            continue
        slot = (key, day_of(known[h]))
        candidates = [u for u in open_units.get(slot, [])
                      if len(groups[u]["members"] if u in groups else [u]) < max_group]
        if not candidates:
            open_units.setdefault(slot, []).append(h)
            continue
        u = max(candidates, key=lambda c: _first_key(unit(c)))
        if u not in groups:
            groups[u] = {"members": [u], "first_seen": known[u]["first_seen"], "pub_date": known[u]["pub_date"]}
            owner[u] = u
        groups[u]["members"].append(h)
        owner[h] = u
    return owner


def _display_order(members):
    """Oldest first: the reverse of the portal's order.

    The portal shows the most recent daily page first and, within a page (or the es
    list), tends to put follow-ups above the story they follow, so the title reads
    oldest page first and, within a page, from the bottom of the document up.
    """
    members = sorted(members, key=lambda m: m.get("pos", m.get("order", 0)), reverse=True)
    return sorted(members, key=lambda m: m.get("page_date") or "")


def feed_items(state):
    """Feed items: ungrouped headlines as they are, plus one combined item per group."""
    known, groups = state.get("items", {}), state.get("groups", {})
    grouped = {m for rec in groups.values() for m in rec["members"]}
    out = [it for g, it in known.items() if g not in grouped]
    for g, rec in groups.items():
        members = _display_order([known[m] for m in rec["members"] if m in known])
        if not members:
            continue
        head = known.get(g, members[0])
        out.append({
            "guid": g,
            "title": " / ".join(m["title"] for m in members),
            "link": members[0]["link"],
            "pub_date": rec["pub_date"],
            "first_seen": rec["first_seen"],
            "date_source": head.get("date_source"),
            "order": min(m.get("order", 0) for m in members),
            "members": members,
        })
    return out


def latest(state, limit):
    items = sorted(feed_items(state),
                   key=lambda it: (it["pub_date"], it["first_seen"], -it.get("order", 0)),
                   reverse=True)
    return items[:limit]
