"""Sequential, persistent per-host request pacing for source adapters."""
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PACE_DB = ROOT / "research-library" / "runtime" / "provider-pacing.sqlite3"
USER_AGENT = "islam-research/0.2 (+https://github.com/justin-napolitano/islam-research; local research discovery)"
MIN_INTERVAL = float(os.environ.get("ISLAM_RESEARCH_MIN_INTERVAL", "2.0"))


def wait_for_host(url, min_interval=MIN_INTERVAL):
    host = urllib.parse.urlsplit(url).netloc.lower()
    PACE_DB.parent.mkdir(parents=True, exist_ok=True)
    while True:
        with sqlite3.connect(PACE_DB, timeout=30) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS host_requests (host TEXT PRIMARY KEY, requested_at REAL NOT NULL)")
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT requested_at FROM host_requests WHERE host = ?", (host,)).fetchone()
            now = time.time()
            delay = max(0.0, row[0] + min_interval - now) if row else 0.0
            if delay <= 0:
                connection.execute("INSERT INTO host_requests(host, requested_at) VALUES(?, ?) ON CONFLICT(host) DO UPDATE SET requested_at=excluded.requested_at", (host, now))
                connection.commit()
                return
            connection.rollback()
        time.sleep(delay)


def request_json(url, headers=None, data=None, timeout=25):
    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    request_headers.update(headers or {})
    for attempt in range(3):
        wait_for_host(url)
        try:
            request = urllib.request.Request(url, data=data, headers=request_headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = float(retry_after)
                except (TypeError, ValueError):
                    try:
                        delay = max(0.0, parsedate_to_datetime(retry_after).timestamp() - time.time()) if retry_after else 0.0
                    except (TypeError, ValueError, OverflowError):
                        delay = 0.0
                time.sleep(min(max(delay, 2 ** attempt), 120))
                continue
            raise RuntimeError(f"Source returned HTTP {exc.code}: {urllib.parse.urlsplit(url).netloc}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Could not reach source {urllib.parse.urlsplit(url).netloc}: {exc}") from exc
    raise RuntimeError(f"Request failed after retries: {urllib.parse.urlsplit(url).netloc}")
