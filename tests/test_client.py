import gzip
import io
import unittest
import urllib.error
from unittest import mock

from wikipedia_rss.client import ApiError, WikiClient


class FakeResponse(io.BytesIO):
    def __init__(self, body, headers=None):
        super().__init__(body)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class ClientTest(unittest.TestCase):
    def test_user_agent_gzip_and_retry_after(self):
        sleeps, seen = [], []
        responses = [
            urllib.error.HTTPError("u", 429, "Too Many", {"Retry-After": "7"}, None),
            FakeResponse(gzip.compress(b'{"query": {}}'), {"Content-Encoding": "gzip"}),
        ]

        def urlopen(req, timeout):
            seen.append(req)
            r = responses.pop(0)
            if isinstance(r, Exception):
                raise r
            return r

        client = WikiClient("en.wikipedia.org", "test-agent/1.0 (me@example.org)", sleep=sleeps.append)
        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertEqual(client.api(action="query"), {"query": {}})
        self.assertEqual(sleeps, [7.0])
        self.assertEqual(seen[0].get_header("User-agent"), "test-agent/1.0 (me@example.org)")
        self.assertIn("maxlag=5", seen[0].full_url)

    def test_api_error(self):
        client = WikiClient("en.wikipedia.org", "ua")
        body = b'{"error": {"code": "missingtitle", "info": "nope"}}'
        with mock.patch("urllib.request.urlopen", lambda req, timeout: FakeResponse(body)):
            with self.assertRaises(ApiError) as cm:
                client.api(action="parse", page="X")
        self.assertEqual(cm.exception.code, "missingtitle")


if __name__ == "__main__":
    unittest.main()
