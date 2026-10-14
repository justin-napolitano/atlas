"""Orchestrate repeatable local research workflows."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "research-library"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_plan(args) -> int:
    plan_path = args.plan.expanduser().resolve()
    plan = read_json(plan_path)
    if not isinstance(plan.get("queries"), list) or not plan["queries"]:
        raise ValueError("Search plan must contain a non-empty queries array.")
    providers = plan.get("providers", ["both"])
    started_at = utc_now()
    run_id = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    run_dir = LIBRARY / "searches" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    records = []
    for query_index, query in enumerate(plan["queries"], 1):
        for provider in providers:
            output = run_dir / f"q{query_index:02d}-{provider}.jsonl"
            command = [sys.executable, str(ROOT / "scripts/literature_search.py"), query["text"], "--provider", provider, "--limit", str(int(query.get("limit", plan.get("limit", 20)))), "--output", str(output)]
            result = subprocess.run(command, text=True, capture_output=True)
            provider_errors = [line for line in result.stderr.splitlines() if "Could not reach" in line or "HTTP " in line]
            row_status = "partial_failure" if result.returncode or provider_errors else "complete"
            records.append({"query": query["text"], "provider": provider, "output": str(output.relative_to(ROOT)), "exit_code": result.returncode, "stderr": result.stderr.strip(), "provider_errors": provider_errors, "status": row_status})
            if result.returncode:
                print(result.stderr.strip(), file=sys.stderr)
    manifest = {
        "run_id": run_id,
        "plan_id": plan.get("id", plan_path.stem),
        "plan_path": str(plan_path),
        "question": plan.get("question"),
        "purpose": plan.get("purpose"),
        "started_at": started_at,
        "providers": providers,
        "filters": plan.get("filters", {}),
        "queries": records,
        "status": "complete" if all(row["status"] == "complete" for row in records) else "partial_failure",
        "review_status": "candidate_unreviewed",
    }
    write_json(run_dir / "run.json", manifest)
    print(f"Run manifest: {run_dir / 'run.json'}")
    print(f"Status: {manifest['status']}; candidates remain unreviewed")
    return 0 if manifest["status"] == "complete" else 1


def candidates(args) -> int:
    """Merge candidates across the query snapshots for one run."""
    run_dir = LIBRARY / "searches" / args.run_id
    manifest_path = run_dir / "run.json"
    if not manifest_path.is_file():
        raise ValueError(f"No search run found: {args.run_id}")
    manifest = read_json(manifest_path)
    merged = {}
    for row in manifest["queries"]:
        snapshot = ROOT / row["output"]
        if not snapshot.is_file():
            continue
        for line in snapshot.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            key = record.get("record_id") or record.get("doi") or record.get("provider_id")
            if not key:
                continue
            if key not in merged:
                merged[key] = {**record, "candidate_id": key, "queries": [], "provider_ranks_by_query": {}}
            current = merged[key]
            if row["query"] not in current["queries"]:
                current["queries"].append(row["query"])
            current["provider_ranks_by_query"][row["query"]] = record.get("provider_ranks", {})
    output = run_dir / "candidates.jsonl"
    with output.open("w", encoding="utf-8") as stream:
        ordered = sorted(merged.values(), key=lambda item: (not bool(item.get("title")), (item.get("title") or "").casefold(), str(item.get("year") or "")))
        for record in ordered:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"Candidate queue: {output}")
    print(f"{len(merged)} unique candidates; all remain unreviewed")
    for record in ordered[:args.limit]:
        print(f"- {record.get('candidate_id')} | {record.get('year') or 'n.d.'} | {record.get('title') or '(untitled)'} | {record.get('venue') or 'venue unknown'}")
    if len(ordered) > args.limit:
        print(f"Showing {args.limit}; inspect the JSONL queue for the remaining candidates.")
    return 0


def screen(args) -> int:
    candidate_file = LIBRARY / "searches" / args.run_id / "candidates.jsonl"
    if not candidate_file.is_file():
        raise ValueError(f"Build the candidate queue first: islam-research candidates {args.run_id}")
    candidates_by_id = {json.loads(line).get("candidate_id") for line in candidate_file.read_text(encoding="utf-8").splitlines()}
    if args.candidate_id not in candidates_by_id:
        raise ValueError(f"Candidate is not in run {args.run_id}: {args.candidate_id}")
    decision = {
        "candidate_id": args.candidate_id, "decision": args.decision, "reason": args.reason,
        "source_role": args.source_role, "relevance": args.relevance,
        "tradition_or_scope": args.tradition_or_scope, "edition_status": args.edition_status,
        "reviewer": args.reviewer, "reviewed_at": utc_now(), "review_status": "human_reviewed",
    }
    path = (args.output or LIBRARY / "screening" / f"{args.run_id}.jsonl").expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(decision, ensure_ascii=False) + "\n")
    print(f"Screening decision recorded: {path}")
    return 0


def intake(args) -> int:
    source = args.document.expanduser().resolve()
    if not source.is_file():
        raise ValueError(f"Not a file: {source}")
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    intake_id = digest.hexdigest()[:16]
    out = LIBRARY / "intake" / intake_id
    out.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(ROOT / "scripts/review_document.py"), str(source), "--output-dir", str(out)]
    result = subprocess.run(command, text=True, capture_output=True)
    manifest = {
        "intake_id": intake_id,
        "source_name": source.name,
        "source_path": str(source),
        "source_sha256": digest.hexdigest(),
        "size_bytes": source.stat().st_size,
        "intaken_at": utc_now(),
        "tool": "scripts/review_document.py",
        "tool_version": "0.1.0",
        "activity_status": "complete" if result.returncode == 0 else "failed",
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "review_status": "machine_extracted_unverified",
        "rights_status": "not_assessed",
    }
    write_json(out / "intake.json", manifest)
    print(result.stdout.strip())
    print(f"Intake manifest: {out / 'intake.json'}")
    if result.returncode:
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


def annotate(args) -> int:
    """Write a local Web Annotation JSON-LD record for a verified passage."""
    if not args.source.startswith(("https://", "http://", "urn:")):
        raise ValueError("--source must be an HTTP(S) IRI or URN identifying the cited source.")
    selector = {"type": "TextQuoteSelector", "exact": args.quote}
    if args.prefix:
        selector["prefix"] = args.prefix
    if args.suffix:
        selector["suffix"] = args.suffix
    record = {
        "@context": ["http://www.w3.org/ns/anno.jsonld", {"ir": "https://islam-research.local/vocab/"}],
        "id": f"urn:uuid:{uuid.uuid4()}",
        "type": "Annotation",
        "motivation": "commenting",
        "body": {
            "type": "TextualBody",
            "value": args.note,
            "purpose": "commenting",
            "language": args.language,
        },
        "target": {
            "type": "SpecificResource",
            "source": args.source,
            "selector": selector,
        },
        "created": utc_now(),
        "creator": {"type": "Person", "name": args.reviewer},
        "ir:locator": args.locator,
        "ir:translation": args.translation,
        "ir:reviewStatus": "human_located_unreviewed_claim",
    }
    output = args.output or LIBRARY / "annotations" / f"{record['id'].rsplit(':', 1)[-1]}.jsonld"
    output = output.expanduser()
    write_json(output, record)
    print(f"Passage annotation: {output}")
    print("Locator and quotation still require verification against the cited edition and context.")
    return 0


def validate(args) -> int:
    try:
        from pyshacl import validate as shacl_validate
        from rdflib import Graph
    except ImportError:
        print("Graph validation needs optional dependencies. Install with: python3 -m pip install -e '.[graph]'", file=sys.stderr)
        return 2
    graph = Graph().parse(str(args.graph), format="turtle")
    shapes = Graph().parse(str(args.shapes), format="turtle")
    conforms, report, report_text = shacl_validate(graph, shacl_graph=shapes, inference="rdfs", abort_on_first=False, allow_infos=True, allow_warnings=True)
    print(report_text)
    print(f"Conforms: {conforms}")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        report.serialize(destination=str(args.output), format="turtle")
        print(f"Validation report: {args.output}")
    return 0 if conforms else 1


def report(args) -> int:
    try:
        from rdflib import Graph, Namespace, RDF, RDFS
    except ImportError:
        print("Question reports need RDFLib. Install with: python3 -m pip install -e '.[graph]'", file=sys.stderr)
        return 2
    graph = Graph().parse(str(args.graph), format="turtle")
    ir = Namespace("https://islam-research.local/vocab/")
    skos = Namespace("http://www.w3.org/2004/02/skos/core#")
    prov = Namespace("http://www.w3.org/ns/prov#")
    questions = list(graph.subjects(RDF.type, ir.ResearchQuestion))
    match = [q for q in questions if args.question.casefold() in str(q).casefold() or args.question.casefold() in str(graph.value(q, RDFS.label, default="")).casefold()]
    if len(match) != 1:
        print("Question selector must match exactly one ResearchQuestion. Candidates:", file=sys.stderr)
        for question in questions:
            print(f"- {question}: {graph.value(question, RDFS.label, default='(unlabelled)')}", file=sys.stderr)
        return 2
    question = match[0]
    lines = [f"# Research report: {graph.value(question, RDFS.label, default=question)}", "", f"- Question IRI: `{question}`", f"- Scope: {graph.value(question, ir.scope, default='Not recorded')}", f"- Status: {graph.value(question, ir.epistemicStatus, default='Not recorded')}", "", "> Generated from the canonical RDF graph. This report organizes records; it does not decide which interpretation is true.", "", "## Related concepts"]
    concepts = sorted({obj for obj in graph.objects(question, ir.about)}, key=str)
    lines.extend([f"- {graph.value(concept, skos.prefLabel, default=graph.value(concept, RDFS.label, default=concept))} (`{concept}`)" for concept in concepts] or ["- No concept links recorded."])
    lines += ["", "## Evidence and claims", ""]
    claims = sorted(set(graph.subjects(ir.addressesQuestion, question)), key=str)
    evidence = sorted({item for claim in claims for item in graph.objects(claim, ir.evidence)}, key=str)
    if claims:
        for claim in claims:
            lines.append(f"### Claim: {graph.value(claim, ir.claimText, default=graph.value(claim, RDFS.label, default=claim))}")
            for predicate in (ir.attributedTo, ir.interpretationType, ir.reviewStatus):
                for value in graph.objects(claim, predicate):
                    lines.append(f"- {predicate.split('/')[-1].split('#')[-1]}: {value}")
            linked = sorted(graph.objects(claim, ir.evidence), key=str)
            if linked:
                lines.extend([f"- Evidence record: `{item}`" for item in linked])
            else:
                lines.append("- No evidence record linked yet.")
    if evidence:
        for item in evidence:
            lines.append(f"### {graph.value(item, RDFS.label, default=item)}")
            for predicate in (ir.source, ir.locator, ir.evidenceKind, ir.stance, ir.paraphrase, prov.wasDerivedFrom):
                for value in graph.objects(item, predicate):
                    lines.append(f"- {predicate.split('/')[-1].split('#')[-1]}: {value}")
    else:
        lines.append("No evidence records are linked to claims for this question yet. This is an evidence gap, not support for any position.")
    lines += ["", "## Review gaps", "", "- Check each source edition and locator against its cited representation; metadata verification alone does not verify an interpretation.", "- Add historically located competing interpretations and describe the limits of the source set.", "- Separate additional source statements from researcher inferences and record what could change those inferences.", ""]
    content = "\n".join(lines)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
        print(f"Report: {args.output}")
    else:
        print(content)
    return 0


def export_graph(args) -> int:
    try:
        from rdflib import Graph, Namespace, RDF, RDFS
        from rdflib.compare import to_canonical_graph
    except ImportError:
        print("Graph export needs RDFLib. Install with: python3 -m pip install -e '.[graph]'", file=sys.stderr)
        return 2
    graph = Graph().parse(str(args.graph), format="turtle")
    ir = Namespace("https://islam-research.local/vocab/")
    prov = Namespace("http://www.w3.org/ns/prov#")
    dct = Namespace("http://purl.org/dc/terms/")
    skos = Namespace("http://www.w3.org/2004/02/skos/core#")
    local_prefix = "https://islam-research.local/id/"
    class_map = {
        ir.SourceRecord: "source", ir.Claim: "claim", ir.EvidenceRecord: "evidence",
        ir.ResearchQuestion: "question", ir.ResearcherPosition: "hypothesis",
        prov.Agent: "person", skos.Concept: "concept",
    }

    def compact(term):
        value = str(term)
        return "entity:" + value[len(local_prefix):] if value.startswith(local_prefix) else value

    typed = {subject for subject, _, _ in graph.triples((None, RDF.type, None)) if str(subject).startswith(local_prefix)}
    node_rows = []
    for subject in sorted(typed, key=str):
        types = list(graph.objects(subject, RDF.type))
        kind = next((class_map[t] for t in types if t in class_map), "entity")
        label = graph.value(subject, RDFS.label) or graph.value(subject, skos.prefLabel) or ""
        description = graph.value(subject, dct.description) or graph.value(subject, ir.claimText) or graph.value(subject, ir.paraphrase) or ""
        scope = graph.value(subject, ir.scope) or ""
        status = graph.value(subject, ir.epistemicStatus) or graph.value(subject, ir.reviewStatus) or ""
        created = graph.value(subject, prov.generatedAtTime) or graph.value(subject, dct.created) or ""
        updated = graph.value(subject, dct.modified) or ""
        node_rows.append([compact(subject), kind, str(label), str(description), str(scope), str(status), str(created), str(updated)])

    edge_rows = []
    for subject, predicate, obj in graph:
        if subject not in typed or obj not in typed or predicate == RDF.type:
            continue
        relation = str(predicate).rsplit("/", 1)[-1].rsplit("#", 1)[-1]
        edge_id = f"edge:{compact(subject)}:{relation}:{compact(obj)}"
        edge_rows.append([edge_id, compact(subject), relation, compact(obj), compact(obj) if predicate == ir.evidence else "", "", ""])
    edge_rows.sort()

    evidence_rows = []
    for subject in sorted(graph.subjects(RDF.type, ir.EvidenceRecord), key=str):
        evidence_rows.append([
            compact(subject), compact(graph.value(subject, ir.source)) if graph.value(subject, ir.source) else "",
            str(graph.value(subject, ir.locator) or ""), str(graph.value(subject, ir.evidenceKind) or ""),
            str(graph.value(subject, ir.paraphrase) or ""), str(graph.value(subject, ir.context) or ""),
            str(graph.value(subject, ir.stance) or ""), str(graph.value(subject, ir.translation) or ""),
            str(graph.value(subject, ir.accessedAt) or ""), str(graph.value(subject, RDFS.comment) or ""),
        ])

    outputs = {
        "nodes.csv": (["id", "type", "label", "description", "scope", "status", "created", "updated"], node_rows),
        "edges.csv": (["id", "from_id", "relation", "to_id", "evidence_id", "confidence", "note"], edge_rows),
        "evidence.csv": (["id", "source_id", "locator", "kind", "quote_or_paraphrase", "context", "stance", "translation", "accessed", "notes"], evidence_rows),
    }
    output_dir = args.output_dir.expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    changed = []
    for filename, (headers, rows) in outputs.items():
        from io import StringIO
        buffer = StringIO(newline="")
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(headers)
        writer.writerows(rows)
        content = buffer.getvalue()
        target = output_dir / filename
        if not target.exists() or target.read_text(encoding="utf-8") != content:
            changed.append(filename)
            if not args.check:
                target.write_text(content, encoding="utf-8")
    jsonld_path = output_dir / "research.jsonld"
    jsonld = to_canonical_graph(graph).serialize(format="json-ld", indent=2)
    if isinstance(jsonld, bytes):
        jsonld = jsonld.decode("utf-8")
    parsed_jsonld = json.loads(jsonld)

    def sort_jsonld(value, key=""):
        if isinstance(value, dict):
            return {name: sort_jsonld(item, name) for name, item in sorted(value.items())}
        if isinstance(value, list):
            items = [sort_jsonld(item) for item in value]
            return items if key == "@context" else sorted(items, key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
        return value

    jsonld = json.dumps(sort_jsonld(parsed_jsonld), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if not jsonld_path.exists() or jsonld_path.read_text(encoding="utf-8") != jsonld:
        changed.append("research.jsonld")
        if not args.check:
            jsonld_path.write_text(jsonld, encoding="utf-8")
    if args.check and changed:
        print("Generated exports differ or are missing: " + ", ".join(changed), file=sys.stderr)
        return 1
    print(("Exports match canonical RDF." if args.check else f"Generated {len(outputs) + 1} exports in {output_dir}"))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="islam-research", description=__doc__)
    sub = parser.add_subparsers(required=True)
    search = sub.add_parser("search", help="run a saved JSON search plan")
    search.add_argument("plan", type=Path)
    search.set_defaults(func=run_plan)
    candidate_queue = sub.add_parser("candidates", help="merge query results into a unique human screening queue")
    candidate_queue.add_argument("run_id")
    candidate_queue.add_argument("--limit", type=int, default=20, help="Number of titles to print (default: 20)")
    candidate_queue.set_defaults(func=candidates)
    screening = sub.add_parser("screen", help="append a human candidate-screening decision")
    screening.add_argument("run_id")
    screening.add_argument("candidate_id")
    screening.add_argument("--decision", choices=("include", "exclude", "uncertain"), required=True)
    screening.add_argument("--reason", required=True)
    screening.add_argument("--source-role", choices=("primary_text", "historical_source", "classical_interpretation", "modern_scholarship", "comparative", "reference", "other", "unknown"), required=True)
    screening.add_argument("--relevance", choices=("high", "medium", "low", "unclear"), required=True)
    screening.add_argument("--tradition-or-scope", default="unknown", help="Tradition, period, region, or community if known")
    screening.add_argument("--edition-status", choices=("verified", "unverified", "not_applicable", "unknown"), default="unknown")
    screening.add_argument("--reviewer", required=True)
    screening.add_argument("--output", type=Path)
    screening.set_defaults(func=screen)
    document = sub.add_parser("intake", help="intake a local document with a checksum and activity record")
    document.add_argument("document", type=Path)
    document.set_defaults(func=intake)
    annotation = sub.add_parser("annotate", help="record a passage using W3C Web Annotation JSON-LD")
    annotation.add_argument("--source", required=True, help="Source IRI (HTTP(S) URL or URN)")
    annotation.add_argument("--locator", required=True, help="Edition-specific locator, such as surah:verse or page")
    annotation.add_argument("--quote", required=True, help="Exact text from the cited representation")
    annotation.add_argument("--prefix", default="", help="Text immediately before the exact quote")
    annotation.add_argument("--suffix", default="", help="Text immediately after the exact quote")
    annotation.add_argument("--note", required=True, help="Brief note about why this passage matters; not an attributed claim")
    annotation.add_argument("--language", default="en")
    annotation.add_argument("--translation", default="", help="Translation/edition identifier, if applicable")
    annotation.add_argument("--reviewer", required=True)
    annotation.add_argument("--output", type=Path, help="Default: git-ignored research-library/annotations/")
    annotation.set_defaults(func=annotate)
    validation = sub.add_parser("validate", help="validate the canonical RDF graph with SHACL")
    validation.add_argument("--graph", type=Path, default=ROOT / "graph/research.ttl")
    validation.add_argument("--shapes", type=Path, default=ROOT / "graph/shapes.ttl")
    validation.add_argument("--output", type=Path)
    validation.set_defaults(func=validate)
    question_report = sub.add_parser("report", help="generate a question-centered report from RDF")
    question_report.add_argument("question", help="unique fragment of the question IRI or label")
    question_report.add_argument("--graph", type=Path, default=ROOT / "graph/research.ttl")
    question_report.add_argument("--output", type=Path)
    question_report.set_defaults(func=report)
    export = sub.add_parser("export", help="generate CSV indexes and JSON-LD from canonical RDF")
    export.add_argument("--graph", type=Path, default=ROOT / "graph/research.ttl")
    export.add_argument("--output-dir", type=Path, default=LIBRARY / "exports")
    export.add_argument("--check", action="store_true", help="fail if generated outputs differ or are missing")
    export.set_defaults(func=export_graph)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.func(args)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        parser.exit(2, f"islam-research: {exc}\n")
    raise SystemExit(result)


if __name__ == "__main__":
    main()
