#!/usr/bin/env python3
"""Search a user-supplied local source corpus and save reviewable candidates."""
import argparse
import datetime as dt
import json
import itertools
from pathlib import Path
import re
import sys
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research-library" / "searches"


def norm(value):
    value = str(value or "").casefold()
    return " ".join(value.split())


def parse_openiti_metadata(text_path):
    yml = text_path.with_suffix(".yml")
    fields = {}
    if yml.is_file():
        for line in yml.read_text(encoding="utf-8", errors="replace").splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                fields[key.strip()] = value.strip()
    version_uri = fields.get("00#VERS#URI######", "")
    title = fields.get("10#BOOK#TITLEB#AR") or fields.get("10#BOOK#TITLEA#AR") or text_path.parent.parent.name
    author = text_path.parent.parent.name
    based = fields.get("80#VERS#BASED####", "")
    return version_uri or text_path.stem, title, author, based


def openiti_results(root, query, limit):
    needle = norm(query)
    for path in sorted(root.rglob("*.mARkdown")):
        identifier, title, author, edition_url = parse_openiti_metadata(path)
        try:
            with path.open(encoding="utf-8", errors="replace") as stream:
                for line_no, line in enumerate(stream, 1):
                    if needle and needle in norm(line):
                        yield {"record_id": "openiti:" + identifier, "provider": "OpenITI local corpus",
                            "provider_id": identifier, "title": title, "authors": [{"name": author}],
                            "year": None, "work_type": "classical_text", "venue": "OpenITI",
                            "landing_page": edition_url or "https://github.com/OpenITI",
                            "local_path": str(path), "locator": f"{path.name}, line {line_no}",
                            "snippet": line.strip()[:500], "review_status": "candidate_unreviewed"}
                        break
        except OSError:
            continue


def xml_record(path, query):
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return None
    fields = {}
    texts = []
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1].casefold()
        value = " ".join("".join(element.itertext()).split())
        if value:
            texts.append(value)
            if tag in ("title", "author", "idno", "repository", "collection", "settlement", "institution"):
                fields.setdefault(tag, []).append(value)
    if norm(query) not in norm(" ".join(texts)):
        return None
    record_id = (fields.get("idno") or [path.stem])[0]
    title = (fields.get("title") or [path.stem])[0]
    authors = [{"name": value} for value in fields.get("author", [])]
    return {"record_id": "fihrist:" + record_id, "provider": "Fihrist local TEI catalogue",
        "provider_id": record_id, "title": title, "authors": authors, "year": None,
        "work_type": "manuscript_catalogue_record", "venue": "Fihrist",
        "landing_page": "https://www.fihrist.org.uk/", "local_path": str(path),
        "locator": "TEI catalogue record", "snippet": " | ".join(texts[:4])[:500],
        "review_status": "candidate_unreviewed"}


def iiif_label(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for entries in value.values():
            if isinstance(entries, list) and entries:
                return str(entries[0])
            if isinstance(entries, str):
                return entries
    if isinstance(value, list):
        return " ".join(iiif_label(item) for item in value)
    return ""


def iiif_record(path, query):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    label = iiif_label(data.get("label") or data.get("description"))
    metadata = data.get("metadata") or []
    fields = [f"{iiif_label(row.get('label'))}: {iiif_label(row.get('value'))}" for row in metadata if isinstance(row, dict)]
    searchable = " ".join([label, *fields])
    if norm(query) not in norm(searchable):
        return None
    identifier = data.get("id") or data.get("@id") or path.stem
    return {"record_id": "iiif:" + str(identifier), "provider": "IIIF local manifest index",
        "provider_id": str(identifier), "title": label or path.stem, "authors": [], "year": None,
        "work_type": "digitized_object_manifest", "venue": "IIIF", "landing_page": str(identifier),
        "local_path": str(path), "locator": "IIIF Presentation manifest",
        "snippet": " | ".join(fields)[:500], "rights": data.get("rights") or data.get("requiredStatement"),
        "review_status": "candidate_unreviewed"}


def corpus_coranicum_candidate(reference):
    match = re.fullmatch(r"\s*(\d{1,3})\s*[:.]\s*(\d{1,3})\s*", reference)
    if not match:
        raise ValueError("Corpus Coranicum resolver expects a Quran reference such as 4:59.")
    sura, verse = (int(part) for part in match.groups())
    url = f"https://corpuscoranicum.de/en/verse-navigator/sura/{sura}/verse/{verse}/commentary"
    return {"record_id": f"corpus-coranicum:Q{sura}:{verse}", "provider": "Corpus Coranicum reference resolver",
        "provider_id": f"Q{sura}:{verse}", "title": f"Corpus Coranicum commentary for Q {sura}:{verse}",
        "authors": [], "year": None, "work_type": "quranic_commentary_and_manuscript_reference",
        "venue": "Corpus Coranicum", "landing_page": url, "locator": f"Q {sura}:{verse}",
        "review_status": "candidate_unreviewed", "note": "Stable passage link only; no bulk content fetched."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=("openiti", "qac", "fihrist", "iiif", "corpus-coranicum"))
    parser.add_argument("query", help="Text query or Quran reference for Corpus Coranicum")
    parser.add_argument("--path", type=Path, help="User-provided corpus file or directory (required except Corpus Coranicum resolver)")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 1000:
        parser.error("--limit must be from 1 to 1000")
    if args.source == "corpus-coranicum":
        rows = [corpus_coranicum_candidate(args.query)]
    else:
        if not args.path or not args.path.expanduser().exists():
            parser.error("--path must point to an existing local corpus or export")
        root = args.path.expanduser().resolve()
        if args.source == "openiti":
            paths = [root] if root.is_file() else None
            if paths:
                parser.error("OpenITI source path must be a corpus directory")
            rows = list(itertools.islice(openiti_results(root, args.query, args.limit), args.limit))
        elif args.source == "qac":
            if not root.is_file():
                parser.error("QAC source path must be the downloaded morphology/annotation file")
            rows = []
            with root.open(encoding="utf-8", errors="replace") as stream:
                for line_no, line in enumerate(stream, 1):
                    if norm(args.query) in norm(line):
                        rows.append({"record_id": f"qac:{root.name}:{line_no}", "provider": "Quranic Arabic Corpus local data",
                            "provider_id": f"{root.name}:{line_no}", "title": "Quranic Arabic Corpus annotation match",
                            "authors": [{"name": "Kais Dukes; Quranic Arabic Corpus"}], "year": None,
                            "work_type": "quranic_morphology_or_syntax_annotation", "venue": "Quranic Arabic Corpus",
                            "landing_page": "https://corpus.quran.com/download/", "local_path": str(root),
                            "locator": f"{root.name}, line {line_no}", "snippet": line.strip()[:500],
                            "review_status": "candidate_unreviewed"})
                        if len(rows) >= args.limit:
                            break
        elif args.source == "fihrist":
            files = [root] if root.is_file() else sorted(root.rglob("*.xml"))
            rows = list(itertools.islice((item for path in files if (item := xml_record(path, args.query))), args.limit))
        else:
            files = [root] if root.is_file() else sorted(root.rglob("*.json"))
            rows = list(itertools.islice((item for path in files if (item := iiif_record(path, args.query))), args.limit))
        rows = rows[:args.limit]
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    run_dir = OUT / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    queue_path = run_dir / "candidates.jsonl"
    output = args.output.expanduser() if args.output else queue_path
    output.parent.mkdir(parents=True, exist_ok=True)
    for index, row in enumerate(rows, 1):
        row["provider_rank"] = index
        row["search_query"] = args.query
        row["retrieved_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    queue_path.write_text(content, encoding="utf-8")
    if output != queue_path:
        output.write_text(content, encoding="utf-8")
    manifest = {"run_id": run_id, "plan_id": f"local-{args.source}", "question": None,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "providers": [args.source], "queries": [{"query": args.query, "provider": args.source,
        "output": str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else str(output),
        "exit_code": 0, "status": "complete", "result_count": len(rows)}],
        "status": "complete", "review_status": "candidate_unreviewed"}
    (run_dir / "run.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Run ID: {run_id}\nCandidate queue: {output}\n{len(rows)} results; all remain unreviewed")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        sys.exit(f"source search: {exc}")
