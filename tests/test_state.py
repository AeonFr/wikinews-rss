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

    def test_retention(self):
        state = {"items": {}}
        st.merge(state, [item("old")], T0)
        day1 = T0 + datetime.timedelta(days=1)
        st.merge(state, [item("new")], day1, retention_days=90)
        self.assertEqual(state["items"]["old"]["gone_since"], st.utc_iso(day1))
        st.merge(state, [item("new")], day1 + datetime.timedelta(days=90), retention_days=90)
        self.assertIn("old", state["items"])
        st.merge(state, [item("new")], day1 + datetime.timedelta(days=91), retention_days=90)
        self.assertEqual(list(state["items"]), ["new"])

    def test_returning_item_loses_gone_since(self):
        state = {"items": {}}
        st.merge(state, [item("a")], T0)
        st.merge(state, [], T0 + datetime.timedelta(days=1))
        self.assertIn("gone_since", state["items"]["a"])
        st.merge(state, [item("a")], T0 + datetime.timedelta(days=2))
        self.assertNotIn("gone_since", state["items"]["a"])

    def test_unchanged_merge_leaves_state_identical(self):
        state = {"items": {}}
        st.merge(state, [item("a"), item("b", "2026-10-22")], T0)
        st.merge(state, [item("a")], T0 + datetime.timedelta(days=1))  # b disappears
        dumped = st.dump_state(state)
        for days in (2, 3):
            st.merge(state, [item("a")], T0 + datetime.timedelta(days=days))
            self.assertEqual(st.dump_state(state), dumped)
        self.assertEqual(state["updated"], st.utc_iso(T0 + datetime.timedelta(days=1)))
        st.merge(state, [dict(item("a"), title="edited")], T0 + datetime.timedelta(days=4))
        self.assertEqual(state["updated"], st.utc_iso(T0 + datetime.timedelta(days=4)))

    def test_migrates_last_seen(self):
        state = {"updated": "2026-10-24T09:00:00Z", "items": {}}
        st.merge(state, [item("a"), item("b")], T0)
        for it in state["items"].values():
            it["last_seen"] = "2026-10-24T09:00:00Z"  # format written by older versions
        st.merge(state, [item("a")], T0 + datetime.timedelta(hours=1))
        self.assertNotIn("last_seen", state["items"]["a"])
        self.assertEqual(state["items"]["b"], dict(state["items"]["b"], gone_since="2026-10-24T09:00:00Z"))
        self.assertNotIn("last_seen", state["items"]["b"])

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
