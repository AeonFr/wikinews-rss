import datetime
import unittest

from wikipedia_rss import state as st

T0 = datetime.datetime(2026, 10, 24, 9, 0, tzinfo=datetime.timezone.utc)


def item(guid, date=None, source=None):
    return {"guid": guid, "date": date, "date_source": "page_date" if date else "first_seen",
            "title": guid, "sources": [{"name": "X", "url": source}] if source else []}


class MergeTest(unittest.TestCase):
    def test_known_items_keep_dates(self):
        state = {"items": {}}
        self.assertEqual(st.merge(state, [item("a"), item("b", "2026-10-22")], T0), ["a", "b"])
        self.assertEqual(state["items"]["a"]["pub_date"], "2026-10-24T09:00:00Z")
        self.assertEqual(state["items"]["b"]["pub_date"], "2026-10-22T00:00:00Z")
        later = T0 + datetime.timedelta(hours=5)
        changed = dict(item("a"), title="edited")
        self.assertEqual(st.merge(state, [changed], later), [])
        a = state["items"]["a"]
        self.assertEqual((a["first_seen"], a["pub_date"], a["title"]), ("2026-10-24T09:00:00Z",) * 2 + ("edited",))
        self.assertIn("b", state["items"])  # gone from the portal, kept in state

    def test_retention_deletes_news_older_than_the_limit(self):
        state = {"items": {}}
        st.merge(state, [item("old", "2026-10-01"), item("new", "2026-10-20")], T0, retention_days=30)
        # Gone from the portal but still recent: kept.
        st.merge(state, [], T0 + datetime.timedelta(days=5), retention_days=30)
        self.assertEqual(sorted(state["items"]), ["new", "old"])
        # 31 Oct 00:00 is exactly 30 days after "old" (1 Oct): not older than the limit yet.
        st.merge(state, [], datetime.datetime(2026, 10, 31, 0, 0, tzinfo=datetime.timezone.utc), retention_days=30)
        self.assertIn("old", state["items"])
        st.merge(state, [], datetime.datetime(2026, 10, 31, 0, 1, tzinfo=datetime.timezone.utc), retention_days=30)
        self.assertEqual(list(state["items"]), ["new"])

    def test_retention_applies_even_if_still_on_the_portal(self):
        state = {"items": {}}
        st.merge(state, [item("a", "2026-10-01")], T0, retention_days=30)
        later = T0 + datetime.timedelta(days=10)
        self.assertEqual(st.merge(state, [item("a", "2026-10-01")], later, retention_days=30), [])
        self.assertEqual(state["items"], {})
        # It stays out: scraping it again does not bring it back as a new item.
        self.assertEqual(st.merge(state, [item("a", "2026-10-01")], later + datetime.timedelta(hours=12),
                                  retention_days=30), [])
        self.assertEqual(state["items"], {})

    def test_new_items_older_than_the_limit_are_ignored(self):
        state = {"items": {}}
        self.assertEqual(st.merge(state, [item("ancient", "2026-08-01"), item("fresh", "2026-10-23")], T0, retention_days=30),
                         ["fresh"])
        self.assertEqual(list(state["items"]), ["fresh"])

    def test_returning_item_is_not_marked_gone(self):
        state = {"items": {}}
        st.merge(state, [item("a")], T0)
        st.merge(state, [], T0 + datetime.timedelta(days=1))
        st.merge(state, [item("a")], T0 + datetime.timedelta(days=2))
        self.assertNotIn("gone_since", state["items"]["a"])

    def test_unchanged_merge_leaves_state_identical(self):
        state = {"items": {}}
        st.merge(state, [item("a"), item("b", "2026-10-22")], T0)
        dumped = st.dump_state(state)
        for days in (1, 2, 3):  # b disappears from the portal: not a change, it is kept
            st.merge(state, [item("a")], T0 + datetime.timedelta(days=days))
            self.assertEqual(st.dump_state(state), dumped)
        self.assertEqual(state["updated"], st.utc_iso(T0))
        st.merge(state, [dict(item("a"), title="edited")], T0 + datetime.timedelta(days=4))
        self.assertEqual(state["updated"], st.utc_iso(T0 + datetime.timedelta(days=4)))

    def test_drops_keys_written_by_older_versions(self):
        state = {"updated": "2026-10-24T09:00:00Z", "items": {}}
        st.merge(state, [item("a"), item("b")], T0)
        state["items"]["a"]["last_seen"] = "2026-10-24T09:00:00Z"  # per-run stamp of the first versions
        state["items"]["b"]["gone_since"] = "2026-10-24T09:00:00Z"  # retention used to depend on it
        st.merge(state, [item("a")], T0 + datetime.timedelta(hours=1))
        for it in state["items"].values():
            self.assertFalse({"last_seen", "gone_since"} & set(it))

    def test_write_atomic_skips_identical_content(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "f.txt")
            self.assertTrue(st.write_atomic(path, "x\n"))
            self.assertFalse(st.write_atomic(path, "x\n"))
            self.assertTrue(st.write_atomic(path, "y\n"))

    def test_edited_daily_item_reuses_guid(self):
        state = {"items": {}}
        st.merge(state, [item("en:1", "2026-10-23", "https://news/x")], T0)
        new = st.merge(state, [item("en:2", "2026-10-23", "https://news/x")], T0 + datetime.timedelta(hours=1))
        self.assertEqual(new, [])
        self.assertEqual(list(state["items"]), ["en:1"])

    def test_latest_order(self):
        state = {"items": {}}
        st.merge(state, [item("a", "2026-10-20"), item("b"), item("c", "2026-10-23")], T0)
        self.assertEqual([i["guid"] for i in st.latest(state, 2)], ["b", "c"])


if __name__ == "__main__":
    unittest.main()


PAGE = "Portal:Current events/2026 October 24"
OTHER = "Portal:Current events/2026 October 23"


def on_page(guid, page=PAGE, **extra):
    return dict(item(guid, "2026-10-24"), page=page, **extra)


class RemovedFromPageTest(unittest.TestCase):
    LATER = T0 + datetime.timedelta(hours=3)

    def test_headlines_gone_from_a_page_read_in_this_run_are_deleted(self):
        state = {"items": {}}
        st.merge(state, [on_page("a"), on_page("b"), on_page("c"), on_page("x", OTHER)], T0)
        # "c" was removed from the page; the other page was not read this run, so "x" stays.
        st.merge(state, [on_page("a"), on_page("b")], self.LATER)
        self.assertEqual(set(state["items"]), {"a", "b", "x"})

    def test_an_edit_that_changes_the_text_and_the_source_replaces_the_old_headline(self):
        state = {"items": {}}
        old = dict(on_page("old-text"), sources=[{"name": "AP", "url": "https://ap.example/1"}])
        st.merge(state, [old, on_page("b")], T0)
        new = dict(on_page("new-text"), sources=[{"name": "La Prensa", "url": "https://prensa.example/2"}])
        # Not recognised as the same headline (the date and first source differ), so it is a new
        # one, and the old one is no longer on the page.
        self.assertEqual(st.merge(state, [new, on_page("b")], self.LATER), ["new-text"])
        self.assertEqual(set(state["items"]), {"new-text", "b"})

    def test_a_page_that_lost_most_of_its_headlines_is_left_alone(self):
        state = {"items": {}}
        st.merge(state, [on_page(g) for g in "abcdefgh"], T0)
        with self.assertLogs("wikipedia_rss.state", "WARNING"):
            st.merge(state, [on_page("a")], self.LATER)  # a blanked or misread page
        self.assertEqual(set(state["items"]), set("abcdefgh"))

    def test_a_short_page_can_replace_most_of_its_items(self):
        state = {"items": {}}
        st.merge(state, [on_page(g) for g in "abcd"], T0)
        st.merge(state, [on_page("a"), on_page("x"), on_page("y"), on_page("z")], self.LATER)
        self.assertEqual(set(state["items"]), set("axyz"))

    def test_a_group_survives_losing_a_member_even_its_first(self):
        state = {"items": {}}

        def grouped(guid, order):
            return on_page(guid, group_key="pageid:1", order=order, pos=order, link="https://x/1")
        st.merge(state, [grouped(g, i) for i, g in enumerate("abc")], T0)
        self.assertEqual(state["groups"]["a"]["members"], ["a", "b", "c"])
        st.merge(state, [grouped("b", 1), grouped("c", 2)], self.LATER)
        self.assertEqual(set(state["items"]), {"b", "c"})
        [unit] = st.latest(state, 10)
        self.assertEqual([m["guid"] for m in unit["members"]], ["c", "b"])
        # And the state is stable from then on.
        before = st.dump_state(state)
        st.merge(state, [grouped("b", 1), grouped("c", 2)], self.LATER + datetime.timedelta(hours=1))
        self.assertEqual(st.dump_state(state), before)
