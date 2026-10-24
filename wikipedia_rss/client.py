"""Minimal, polite HTTP client for the MediaWiki Action API."""
import gzip
import hashlib
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, code, info=""):
        super().__init__("%s: %s" % (code, info))
        self.code = code


class WikiClient:
    def __init__(self, host, user_agent, cache_dir=None, cache_ttl=1800,
                 retries=4, timeout=30, sleep=time.sleep):
        self.host = host
        self.user_agent = user_agent
        self.cache_dir = cache_dir
        self.cache_ttl = cache_ttl
        self.retries = retries
        self.timeout = timeout
        self.sleep = sleep
        self.requests = 0  # real (non-cached) requests made

    def api(self, **params):
        params.update(format="json", formatversion="2", maxlag="5")
        url = "https://%s/w/api.php?%s" % (self.host, urllib.parse.urlencode(params))
        data = json.loads(self._get(url, is_api=True))
        if "error" in data:
            raise ApiError(data["error"].get("code"), data["error"].get("info", ""))
        return data

    def raw(self, title):
        url = "https://%s/w/index.php?%s" % (
            self.host, urllib.parse.urlencode({"title": title, "action": "raw"}))
        return self._get(url).decode("utf-8")

    def _cache_path(self, url):
        return os.path.join(self.cache_dir, hashlib.sha1(url.encode()).hexdigest())

    def _get(self, url, is_api=False):
        if self.cache_dir:
            path = self._cache_path(url)
            if os.path.exists(path) and time.time() - os.path.getmtime(path) < self.cache_ttl:
                log.debug("cache hit %s", url)
                with open(path, "rb") as f:
                    return f.read()

        delay = 2.0
        for attempt in range(self.retries + 1):
            retry_after = None
            try:
                log.debug("GET %s", url)
                self.requests += 1
                req = urllib.request.Request(url, headers={
                    "User-Agent": self.user_agent,
                    "Accept-Encoding": "gzip",
                })
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip":
                        body = gzip.decompress(body)
                    # maxlag errors come back as HTTP 200 with a Retry-After header.
                    if is_api and b'"maxlag"' in body[:200]:
                        retry_after = resp.headers.get("Retry-After")
                        raise _Retry("maxlag")
                if self.cache_dir:
                    os.makedirs(self.cache_dir, exist_ok=True)
                    with open(self._cache_path(url), "wb") as f:
                        f.write(body)
                return body
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504):
                    raise
                retry_after = e.headers.get("Retry-After")
                err = e
            except (urllib.error.URLError, TimeoutError, _Retry) as e:
                err = e
            if attempt == self.retries:
                raise err
            wait = delay
            if retry_after and retry_after.isdigit():
                wait = max(wait, float(retry_after))
            log.warning("request failed (%s), retrying in %.0fs", err, wait)
            self.sleep(wait)
            delay *= 2


class _Retry(Exception):
    pass
