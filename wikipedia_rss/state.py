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
import logging
import os
import tempfile

from .config import RETENTION_DAYS

log = logging.getLogger(__name__)

# Bumped when the rule that decides which headlines are grouped changes: the headlines
# still on the portal are then regrouped once (see merge). 1: innermost topic's article;
# 2: the outermost topic's article; 3: same, but a day's entries under one top-level
# article stay together however many they are (the cap was 6 in version 2).
GROUPING_VERSION = 3

# Most headlines of one article and day in a group. High, so that in practice all of them
# stay together: a story is split into several items only beyond this.
MAX_GROUP = 100

# A group's feed title joins this many of its headlines; the rest are only counted.
TITLE_PARTS = 3


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


def merge(state, items, now, retention_days=RETENTION_DAYS, max_group=MAX_GROUP, also_read=()):
    """Merge freshly scraped headlines (each with a 'guid') into state, then group them.

    Returns the guids of the new feed items (new headlines not absorbed by a group).

    Known headlines keep first_seen, pub_date and date_source; their content is refreshed.
    Headlines (and groups) with a pub_date older than retention_days are deleted, and new
    headlines that old are ignored. A headline that is no longer on a daily page read in this
    run was removed by the editors (or edited into another text: that is a new headline, see
    below) and is deleted too; the ones of pages not read in this run are kept until the
    retention deletes them. state["updated"] only moves to now if the state actually changed.

    "Topics in the news" (kind "topic") are not deleted when the portal's main page drops them:
    they are marked "retired" (and unmarked if they come back), so that the website can keep their
    pages while the front page and the feed leave them out. `also_read` lists the pages that were
    read in this run although no headline came from them (an empty "Topics in the news" box).
    """
    known = state.setdefault("items", {})
    # State written before grouping existed, or under another grouping rule: regroup
    # everything currently scraped.
    migrating = "groups" not in state or state.get("grouping") != GROUPING_VERSION
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

    for guid in removed_from_pages(known, items, current):
        del known[guid]
    retire_topics(known, items, current, also_read)
    expire(state, cutoff)

    current &= set(known)
    pending = set(new)
    if migrating:
        # Groups with a headline still on the portal are dissolved and formed again under the
        # current rule. Older groups (nothing of them on the portal any more) are kept as they
        # are: their headlines no longer have the data to be regrouped.
        pending = set(current)
        for g, rec in list(groups.items()):
            if any(m in current for m in rec["members"]):
                pending.update(m for m in rec["members"] if m in known)
                del groups[g]
        state["grouping"] = GROUPING_VERSION
    owner = regroup(state, [it["guid"] for it in items if it["guid"] in known], list(pending), max_group)
    if "updated" not in state or json.dumps([known, groups], sort_keys=True) != before:
        state["updated"] = now_iso
    return [g for g in new if owner.get(g, g) == g]


def retire_topics(known, items, current, also_read=()):
    """Mark the stored "Topics in the news" that the portal's main page no longer has as retired."""
    pages = {it["page"] for it in items if it.get("page")} | set(also_read)
    for guid, old in known.items():
        if old.get("kind") != "topic" or old.get("page") not in pages:
            continue
        if guid in current:
            old.pop("retired", None)
        else:
            old["retired"] = True


def removed_from_pages(known, items, current):
    """Guids of the stored headlines that are no longer on the daily pages read in this run.

    `items` are the headlines scraped (their "page" says which pages were read), `current` the
    guids of those that were merged. A headline edited so that it no longer matches its old
    self (its text and its source both changed) is a new headline: the old one is what goes
    here. A page with many headlines that lost most of them at once is more likely to be blanked
    or misread than edited, so none of its headlines are removed (they would come back as new).
    (A short page, like the portal's "Topics in the news", can replace most of its items.)
    """
    removed = []
    for page in {it["page"] for it in items if it.get("page")}:
        stored = [g for g, old in known.items() if old.get("page") == page and old.get("kind") != "topic"]
        gone = [g for g in stored if g not in current]
        if len(stored) >= 8 and 2 * len(gone) > len(stored):
            log.warning("%s: %d of %d headlines are gone; keeping them", page, len(gone), len(stored))
            continue
        removed += gone
    return removed


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


def group_title(members):
    """The headlines of a group joined with " / ", the first TITLE_PARTS of them if there are more."""
    titles = [m["title"] for m in members]
    if len(titles) <= TITLE_PARTS:
        return " / ".join(titles)
    return " / ".join(titles[:TITLE_PARTS]) + " / … (+%d more)" % (len(titles) - TITLE_PARTS)


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
            "title": group_title(members),
            "link": members[0]["link"],
            "pub_date": rec["pub_date"],
            "first_seen": rec["first_seen"],
            "date_source": head.get("date_source"),
            "order": min(m.get("order", 0) for m in members),
            "members": members,
        })
    return out


def _newest_first(items):
    return sorted(items, key=lambda it: (it["pub_date"], it["first_seen"], -it.get("order", 0)), reverse=True)


def latest(state, limit):
    """The website's stories, newest first: an article of the day and everything nested under it."""
    return _newest_first(feed_items(state))[:limit]


def nearest_topic(headline):
    """The topic line closest to an entry that links an article, or None (a first-level entry)."""
    for topic in reversed(headline.get("topics") or []):
        if topic.get("title"):
            return topic
    return None


def rss_title(members, topic):
    """"Nearest article: first headline / second headline", or just the headlines without a topic."""
    title = group_title(members)
    return "%s: %s" % (topic["label"], title) if topic else title


def rss_items(state, with_retired=False):
    """The RSS feed's items: each story split by the article nearest to its entries.

    The website shows a story as one nested whole (an article of the day and everything under
    it), but a feed item is about one thing: the entries of a story under the same nearest
    article (the innermost topic line that links one) are one item, titled with that article
    as a prefix ("Houthi–Saudi conflict: ..."); an entry under no topic is an item of its own.
    The wider chain of articles is on the story's page, which each item links to. "story_guid"
    is the guid of the whole story (the top-level article of the day) the item is nested under.

    An item's guid, pub_date and first_seen are its oldest headline's, so they do not change when
    a headline is added later.
    """
    out = []
    for story in feed_items(state):
        members = story.get("members") or [story]
        parts = {}
        for i, m in enumerate(members):
            topic = nearest_topic(m)
            parts.setdefault(topic["title"] if topic else "\0%d" % i, []).append(m)
        for part in parts.values():
            founder = min(part, key=_first_key)
            topic = nearest_topic(founder)
            item = dict(founder, title=rss_title(part, topic), story_guid=story["guid"])
            if len(part) > 1:
                item.update(link=part[0]["link"], order=min(m.get("order", 0) for m in part), members=part)
            else:
                item.pop("members", None)
            if item.get("retired") and not with_retired:
                continue
            out.append(item)
    return out


def rss_latest(state, limit, with_retired=False):
    return _newest_first(rss_items(state, with_retired))[:limit]
