#!/usr/bin/env python3
"""Fetch one precise Quran verse or hadith reference for local human review."""
import argparse
import base64
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from islam_research.net import request_json


def quran_verse(reference, translation=None):
    client_id = os.environ.get("QF_CLIENT_ID")
    client_secret = os.environ.get("QF_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError("Set QF_CLIENT_ID and QF_CLIENT_SECRET from a Quran Foundation developer app.")
    if not re.fullmatch(r"\d{1,3}:\d{1,3}", reference):
        raise ValueError("Use a Quran verse key such as 4:59.")
    environment = os.environ.get("QF_ENV", "production")
    if environment not in ("prelive", "production"):
        raise ValueError("QF_ENV must be prelive or production.")
    auth_host = "prelive-oauth2.quran.foundation" if environment == "prelive" else "oauth2.quran.foundation"
    api_host = "apis-prelive.quran.foundation" if environment == "prelive" else "apis.quran.foundation"
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    token = request_json(f"https://{auth_host}/oauth2/token", {
        "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded",
    }, data=urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "content"}).encode())
    params = {"translations": str(translation)} if translation else {}
    suffix = "?" + urllib.parse.urlencode(params) if params else ""
    url = f"https://{api_host}/content/api/v4/verses/by_key/{reference}{suffix}"
    result = request_json(url, {"x-auth-token": token["access_token"], "x-client-id": client_id})
    return {"provider": "Quran Foundation Content API", "source_url": url,
        "locator": "Q " + reference, "resource": "verse text" if not translation else f"verse text and translation resource {translation}",
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "data": result, "notice": "On-demand response shown for review; no offline corpus snapshot was created."}


def sunnah_reference(reference):
    key = os.environ.get("SUNNAH_API_KEY")
    if not key:
        raise ValueError("Set SUNNAH_API_KEY after requesting API access from Sunnah.com.")
    if not re.fullmatch(r"[^:,]+:[^:,]+", reference):
        raise ValueError("Use an exact collection:hadith-number reference, for example bukhari:1.")
    url = "https://api.sunnah.com/v1/hadiths/refs?" + urllib.parse.urlencode({"refs": reference})
    data = request_json(url, {"X-API-Key": key})
    return {"provider": "Sunnah.com API", "source_url": url, "locator": reference,
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "data": data, "notice": "Exact-reference lookup only; collection inclusion does not itself assess authenticity or representativeness."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=("quran-verse", "sunnah-reference"))
    parser.add_argument("reference")
    parser.add_argument("--translation", help="Quran Foundation translation resource ID")
    args = parser.parse_args()
    result = quran_verse(args.reference, args.translation) if args.source == "quran-verse" else sunnah_reference(args.reference)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        sys.exit(f"source fetch: {exc}")
