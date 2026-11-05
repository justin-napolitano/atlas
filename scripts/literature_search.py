#!/usr/bin/env python3
"""Search OpenAlex and Crossref for bibliographic discovery; does not rate sources."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research-library" / "searches"
sys.path.insert(0, str(ROOT / "src"))
from islam_research.net import request_json as fetch_json


def urlsplit_host(url):
    return urllib.parse.urlsplit(url).netloc


def normalize_doi(value):
    if not value:
        return ""
    return re.sub(r"^https?://(dx\.)?doi\.org/", "", str(value).strip(), flags=re.I).lower()


def openalex(query, limit):
    select = "id,doi,title,publication_year,type,cited_by_count,authorships,primary_location,open_access,primary_topic"
    params = urllib.parse.urlencode({"search": query, "per-page": limit, "select": select})
    data = fetch_json("https://api.openalex.org/works?" + params)
    records = []
    for rank, item in enumerate(data.get("results", []), 1):
        authors = []
        for authorship in item.get("authorships", [])[:12]:
            author = authorship.get("author") or {}
            if author.get("display_name"):
                authors.append({"name": author["display_name"], "openalex_id": author.get("id")})
        location = item.get("primary_location") or {}
        source = location.get("source") or {}
        oa = item.get("open_access") or {}
        topic = item.get("primary_topic") or {}
        records.append({
            "provider": "OpenAlex", "provider_rank": rank, "provider_id": item.get("id"),
            "doi": normalize_doi(item.get("doi")), "title": item.get("title"),
            "year": item.get("publication_year"), "work_type": item.get("type"),
            "authors": authors, "venue": source.get("display_name"),
            "landing_page": location.get("landing_page_url"), "open_access": oa.get("is_oa"),
            "open_access_url": oa.get("oa_url"), "primary_topic": topic.get("display_name"),
            "cited_by_count_snapshot": item.get("cited_by_count"),
        })
    return records


def crossref(query, limit):
    params_dict = {"query.bibliographic": query, "rows": limit}
    if os.environ.get("CROSSREF_MAILTO"):
        params_dict["mailto"] = os.environ["CROSSREF_MAILTO"]
    params = urllib.parse.urlencode(params_dict)
    data = fetch_json("https://api.crossref.org/works?" + params).get("message", {})
    records = []
    for rank, item in enumerate(data.get("items", []), 1):
        authors = []
        for author in item.get("author", [])[:12]:
            name = " ".join(x for x in (author.get("given"), author.get("family")) if x)
            if name:
                authors.append({"name": name})
        date = item.get("published-print") or item.get("published-online") or item.get("created") or {}
        parts = date.get("date-parts") or [[None]]
        records.append({
            "provider": "Crossref", "provider_rank": rank,
            "provider_id": item.get("DOI"), "doi": normalize_doi(item.get("DOI")),
            "title": (item.get("title") or [None])[0], "year": (parts[0] or [None])[0],
            "work_type": item.get("type"), "authors": authors,
            "venue": (item.get("container-title") or [None])[0],
            "landing_page": item.get("URL"),
            "cited_by_count_snapshot": item.get("is-referenced-by-count"),
        })
    return records


def semantic_scholar(query, limit):
    fields = "title,year,authors,venue,externalIds,url,abstract,citationCount,openAccessPdf"
    params = urllib.parse.urlencode({"query": query, "limit": min(limit, 100), "fields": fields})
    headers = {}
    if os.environ.get("SEMANTIC_SCHOLAR_API_KEY"):
        headers["x-api-key"] = os.environ["SEMANTIC_SCHOLAR_API_KEY"]
    data = fetch_json("https://api.semanticscholar.org/graph/v1/paper/search?" + params, headers)
    records = []
    for rank, item in enumerate(data.get("data", []), 1):
        ids = item.get("externalIds") or {}
        authors = [{"name": person.get("name"), "semantic_scholar_id": person.get("authorId")} for person in item.get("authors", []) if person.get("name")]
        oa = item.get("openAccessPdf") or {}
        records.append({"provider": "Semantic Scholar", "provider_rank": rank,
            "provider_id": item.get("paperId"), "doi": normalize_doi(ids.get("DOI")),
            "title": item.get("title"), "year": item.get("year"), "work_type": "paper",
            "authors": authors, "venue": item.get("venue"), "landing_page": item.get("url"),
            "abstract": item.get("abstract"), "open_access_url": oa.get("url"),
            "cited_by_count_snapshot": item.get("citationCount")})
    return records


def openaire(query, limit):
    params = urllib.parse.urlencode({"search": query, "type": "publication", "page": 1, "pageSize": min(limit, 100)})
    data = fetch_json("https://api.openaire.eu/graph/v3/research-products?" + params)
    records = []
    for rank, item in enumerate(data.get("results", []), 1):
        ids = item.get("pids") or item.get("pid") or []
        if isinstance(ids, dict):
            ids = [ids]
        doi = next((entry.get("value") for entry in ids if str(entry.get("scheme", "")).casefold() == "doi"), "")
        authors = [{"name": author.get("fullName") or author.get("name")} for author in item.get("authors", []) if author.get("fullName") or author.get("name")]
        title = item.get("mainTitle") or item.get("title") or ""
        records.append({"provider": "OpenAIRE", "provider_rank": rank,
            "provider_id": item.get("id"), "doi": normalize_doi(doi), "title": title,
            "year": item.get("publicationYear"), "work_type": item.get("type"),
            "authors": authors, "venue": item.get("publisher"), "landing_page": item.get("webLink") or item.get("url")})
    return records


def datacite(query, limit):
    params = urllib.parse.urlencode({"query": query, "page[size]": min(limit, 100)})
    data = fetch_json("https://api.datacite.org/dois?" + params)
    records = []
    for rank, item in enumerate(data.get("data", []), 1):
        attrs = item.get("attributes", {})
        titles = attrs.get("titles") or []
        creators = attrs.get("creators") or []
        authors = [{"name": c.get("name") or " ".join(p for p in (c.get("givenName"), c.get("familyName")) if p)} for c in creators]
        records.append({"provider": "DataCite", "provider_rank": rank,
            "provider_id": item.get("id"), "doi": normalize_doi(attrs.get("doi") or item.get("id")),
            "title": next((t.get("title") for t in titles if t.get("title")), ""),
            "year": attrs.get("publicationYear"), "work_type": (attrs.get("types") or {}).get("resourceTypeGeneral"),
            "authors": authors, "venue": attrs.get("publisher"), "landing_page": attrs.get("url"),
            "license": ", ".join((lic.get("rights") or "") for lic in attrs.get("rightsList", []))})
    return records


def core(query, limit):
    params = urllib.parse.urlencode({"q": query, "limit": min(limit, 100)})
    headers = {}
    if os.environ.get("CORE_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["CORE_API_KEY"]
    data = fetch_json("https://api.core.ac.uk/v3/search/works/?" + params, headers)
    records = []
    for rank, item in enumerate(data.get("results", []), 1):
        authors = [{"name": author.get("name")} for author in item.get("authors", []) if author.get("name")]
        records.append({"provider": "CORE", "provider_rank": rank,
            "provider_id": str(item.get("id", "")), "doi": normalize_doi(item.get("doi")),
            "title": item.get("title"), "year": item.get("yearPublished"),
            "work_type": item.get("documentType"), "authors": authors,
            "venue": item.get("publisher"), "landing_page": item.get("downloadUrl") or (item.get("sourceFulltextUrls") or [None])[0],
            "abstract": item.get("abstract"), "license": item.get("license")})
    return records


PROVIDERS = {
    "openalex": openalex, "crossref": crossref, "semantic_scholar": semantic_scholar,
    "openaire": openaire, "datacite": datacite, "core": core,
}


def merge_records(records):
    merged = {}
    for record in records:
        if record.get("doi"):
            record["doi"] = normalize_doi(record["doi"])
        title = re.sub(r"\W+", " ", (record.get("title") or "").casefold()).strip()
        key = "doi:" + record["doi"] if record.get("doi") else "title:" + title + ":" + str(record.get("year") or "")
        if key == "title::":
            key = f"{record['provider']}:{record['provider_id']}"
        if key not in merged:
            merged[key] = {"record_id": key, "providers": [], "provider_ranks": {}, **record}
        current = merged[key]
        current["providers"].append(record["provider"])
        current["provider_ranks"][record["provider"]] = record["provider_rank"]
        for field in ("doi", "title", "year", "work_type", "authors", "venue", "landing_page", "open_access", "open_access_url", "primary_topic", "cited_by_count_snapshot", "abstract", "license"):
            if current.get(field) in (None, "", []):
                current[field] = record.get(field)
    return list(merged.values())


def slugify(value):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.casefold())).strip("-")[:64] or "query"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Search phrase")
    parser.add_argument("--provider", choices=("both", *PROVIDERS), default="both")
    parser.add_argument("--limit", type=int, default=20, help="Results per service (1-100)")
    parser.add_argument("--output", type=Path, help="JSONL output path (default: ignored research-library/searches/)")
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be from 1 to 100")
    records = []
    errors = []
    providers = ("openalex", "crossref") if args.provider == "both" else (args.provider,)
    for provider in providers:
        try:
            result = PROVIDERS[provider](args.query, args.limit)
            records.extend(result)
            print(f"{provider}: {len(result)} results", file=sys.stderr)
        except (RuntimeError, ValueError) as exc:
            errors.append(f"{provider}: {exc}")
            print(errors[-1], file=sys.stderr)
    if not records:
        raise SystemExit("No results were retrieved. " + " | ".join(errors))
    results = merge_records(records)
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    output = args.output or OUT / f"{dt.datetime.now().strftime('%Y%m%d')}-{slugify(args.query)}.jsonl"
    output = output.expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as stream:
        for item in results:
            item["search_query"] = args.query
            item["retrieved_at"] = retrieved
            stream.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"Saved {len(results)} deduplicated records to {output}")
    print("Provider result order and citation counts are discovery metadata, not source-quality ratings.")


if __name__ == "__main__":
    main()
