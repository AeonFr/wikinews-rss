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
        st.merge(state, [item("new")], T0 + datetime.timedelta(days=91), retention_days=90)
        self.assertEqual(list(state["items"]), ["new"])

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
