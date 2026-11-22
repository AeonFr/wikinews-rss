"""Limits of the optional map phase (map and location read from the infobox of the stories' articles).

The feature is optional, so it is kept cheap and polite: its requests are never retried, the whole
phase gets a wall-clock budget, and it stops at once if Wikipedia says it is throttling or
overloaded (HTTP 429/503, maxlag). See infobox.update_cache.
"""

MAX_ARTICLE_FETCHES = 25    # requests per run; the rest waits for the next run
ARTICLE_FETCH_DELAY = 1.0   # seconds between two of those requests
ARTICLE_FETCH_BUDGET = 90   # seconds (wall clock) for the whole phase; then it stops quietly
