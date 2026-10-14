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
    configured = plan.get("providers", ["both"])
    providers = []
    for provider in configured:
        providers.extend(("openalex", "crossref") if provider == "both" else (provider,))
    if not providers:
        raise ValueError("Search plan must configure at least one provider.")
    started_at = utc_now()
    run_id = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    run_dir = LIBRARY / "searches" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    records = []
    for query_index, query in enumerate(plan["queries"], 1):
        # Rotate the first provider for each query. All requests remain sequential.
        offset = (query_index - 1) % len(providers)
        query_providers = providers[offset:] + providers[:offset]
        for provider in query_providers:
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
        "request_policy": {"mode": "sequential_round_robin", "persistent_per_host_cooldown_seconds": "ISLAM_RESEARCH_MIN_INTERVAL (default 2)"},
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
    existing_queue = run_dir / "candidates.jsonl"
    if existing_queue.is_file():
        count = sum(1 for line in existing_queue.read_text(encoding="utf-8").splitlines() if line.strip())
        print(f"Candidate queue: {existing_queue}\n{count} candidates; all remain unreviewed")
        return 0
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


def source_search(args) -> int:
    """Search a local historical-text/catalog corpus or resolve a Coranicum verse."""
    command = [sys.executable, str(ROOT / "scripts/source_search.py"), args.source, args.query, "--limit", str(args.limit)]
    if args.path:
        command.extend(("--path", str(args.path.expanduser().resolve())))
    if args.output:
        command.extend(("--output", str(args.output.expanduser())))
    result = subprocess.run(command, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


def source_fetch(args) -> int:
    command = [sys.executable, str(ROOT / "scripts/source_fetch.py"), args.source, args.reference]
    if args.translation:
        command.extend(("--translation", args.translation))
    result = subprocess.run(command, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


def graph_import_candidates(args) -> int:
    try:
        from rdflib import Graph, Literal, Namespace, RDF, RDFS, URIRef
        from rdflib.namespace import DCTERMS, PROV, XSD
    except ImportError:
        print("Candidate graph import needs RDFLib. Install with: python3 -m pip install -e '.[graph]'", file=sys.stderr)
        return 2
    run_dir = LIBRARY / "searches" / args.run_id
    queue = run_dir / "candidates.jsonl"
    if not queue.is_file():
        raise ValueError(f"No candidate queue found for run {args.run_id}")
    ir = Namespace("https://islam-research.local/vocab/")
    ns = Namespace("https://islam-research.local/id/")
    graph = Graph()
    graph.bind("ir", ir)
    graph.bind("prov", PROV)
    graph.bind("dct", DCTERMS)
    activity = ns["candidate-harvest-" + args.run_id]
    graph.add((activity, RDF.type, PROV.Activity))
    graph.add((activity, RDFS.label, Literal("Programmatic candidate discovery; no claims accepted")))
    graph.add((activity, ir.reviewStatus, Literal("candidate_unreviewed")))
    count = 0
    for line in queue.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        identity = str(item.get("record_id") or item.get("candidate_id") or item.get("provider_id") or item.get("title") or line)
        digest = hashlib.sha256(identity.encode()).hexdigest()[:24]
        node = ns["candidate-source-" + digest]
        graph.add((node, RDF.type, ir.SourceRecord))
        graph.add((node, RDFS.label, Literal(item.get("title") or "Untitled source candidate")))
        for author in item.get("authors", []):
            name = author.get("name") if isinstance(author, dict) else str(author)
            if name:
                graph.add((node, DCTERMS.creator, Literal(name)))
        if not list(graph.objects(node, DCTERMS.creator)):
            graph.add((node, DCTERMS.creator, Literal("Unknown; candidate metadata omitted author")))
        graph.add((node, ir.reviewStatus, Literal("candidate_unreviewed")))
        graph.add((node, ir.sourceRole, Literal(item.get("work_type") or "unclassified source candidate")))
        graph.add((node, DCTERMS.identifier, Literal(item.get("provider_id") or identity)))
        graph.add((node, DCTERMS.source, URIRef(item["landing_page"]) if str(item.get("landing_page", "")).startswith(("http://", "https://")) else Literal(item.get("landing_page", ""))))
        if item.get("doi"):
            graph.add((node, DCTERMS.identifier, Literal("doi:" + str(item["doi"]))))
        graph.add((node, PROV.wasGeneratedBy, activity))
        if item.get("locator"):
            graph.add((node, ir.locator, Literal(item["locator"])))
        count += 1
    output = args.output.expanduser() if args.output else LIBRARY / "imports" / f"{args.run_id}-candidates.ttl"
    output.parent.mkdir(parents=True, exist_ok=True)
    graph.serialize(destination=str(output), format="turtle")
    print(f"Candidate-only RDF graph: {output}\n{count} source candidates; no claims were created")
    return 0


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


def visualize_graph(args) -> int:
    """Generate an offline, interactive radial view of the canonical RDF graph."""
    try:
        from rdflib import Graph, Namespace, RDF, RDFS
    except ImportError:
        print("Graph visualization needs RDFLib. Install with: python3 -m pip install -e '.[graph]'", file=sys.stderr)
        return 2

    graph = Graph().parse(str(args.graph), format="turtle")
    ir = Namespace("https://islam-research.local/vocab/")
    skos = Namespace("http://www.w3.org/2004/02/skos/core#")
    prov = Namespace("http://www.w3.org/ns/prov#")
    dct = Namespace("http://purl.org/dc/terms/")
    local = "https://islam-research.local/id/"
    type_names = {
        ir.SourceRecord: "source", ir.Claim: "claim", ir.EvidenceRecord: "evidence",
        ir.ResearchQuestion: "question", ir.ResearcherPosition: "hypothesis",
        skos.Concept: "concept", prov.Agent: "person",
    }
    subjects = {s for s in graph.subjects() if str(s).startswith(local)}
    nodes = []
    for subject in subjects:
        label = graph.value(subject, RDFS.label) or graph.value(subject, skos.prefLabel) or subject
        types = [type_names[t] for t in graph.objects(subject, RDF.type) if t in type_names]
        details = [f"Type: {', '.join(types) or 'record'}"]
        for predicate, caption in ((ir.claimText, "Claim"), (ir.paraphrase, "Evidence note"), (dct.description, "Description"), (ir.scope, "Scope"), (dct.source, "Source URL"), (ir.locator, "Locator"), (ir.reviewStatus, "Review status")):
            for value in graph.objects(subject, predicate):
                details.append(f"{caption}: {value}")
        nodes.append({"id": str(subject), "label": str(label), "type": types[0] if types else "record", "details": details})
    node_ids = {node["id"] for node in nodes}
    excluded = {RDF.type, RDFS.label, RDFS.comment, skos.prefLabel, skos.definition}
    edges = []
    for source, predicate, target in graph:
        if source in subjects and str(target) in node_ids and predicate not in excluded:
            edges.append({"source": str(source), "target": str(target), "label": str(predicate).rsplit("/", 1)[-1].rsplit("#", 1)[-1]})
    payload = json.dumps({"nodes": sorted(nodes, key=lambda n: n["id"]), "edges": edges}, ensure_ascii=False).replace("<", "\\u003c")
    template = '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research graph wheel</title><style>
*{box-sizing:border-box}body{margin:0;background:#101722;color:#e8edf4;font:15px system-ui,sans-serif}header{padding:16px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #293546}h1{font-size:20px;margin:0 12px 0 0}input,select{background:#1b2736;color:#e8edf4;border:1px solid #40516a;border-radius:7px;padding:9px}#layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:calc(100vh - 65px)}svg{width:100%;height:calc(100vh - 66px);min-height:580px}.panel{padding:18px;border-left:1px solid #293546;background:#141e2b;overflow:auto}.panel h2{font-size:18px}.muted{color:#a7b5c8;font-size:13px}.link{stroke:#8797aa;stroke-opacity:.28;stroke-width:1.2}.link.focus{stroke:#f4c66a;stroke-opacity:.9;stroke-width:2.5}.node circle{stroke:#101722;stroke-width:2;cursor:pointer}.node text{fill:#dce5ef;font-size:11px;pointer-events:none}.node.dim{opacity:.13}.node.selected circle{stroke:#fff;stroke-width:4}.legend{display:flex;gap:12px;flex-wrap:wrap;color:#b8c4d2;font-size:12px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
@media(max-width:800px){#layout{grid-template-columns:1fr}.panel{border-left:0;border-top:1px solid #293546}svg{height:65vh;min-height:450px}}
</style><header><h1>Research graph wheel</h1><input id="search" placeholder="Find a node…"><select id="filter"><option value="">All node types</option></select><span class="muted" id="count"></span><span class="legend" id="legend"></span></header>
<div id="layout"><svg viewBox="0 0 1200 850" role="img" aria-label="Interactive radial research graph"><g id="links"></g><g id="nodes"></g></svg><aside class="panel" id="panel"><h2>Explore the graph</h2><p class="muted">Select a node to highlight its direct connections. This view displays recorded relationships; proximity and line count do not indicate importance or truth.</p></aside></div>
<script>const data=__DATA__, colors={question:'#f4c66a',concept:'#55c6a9',source:'#83a8ff',evidence:'#c28af0',claim:'#ff8c78',hypothesis:'#f17ab4',person:'#9aa9b9',record:'#93a2b4'};function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}const svg=document.querySelector('svg'),lg=document.querySelector('#links'),ng=document.querySelector('#nodes'),filter=document.querySelector('#filter'),search=document.querySelector('#search');const types=[...new Set(data.nodes.map(n=>n.type))].sort();types.forEach(t=>{let o=document.createElement('option');o.value=t;o.textContent=t;filter.append(o);document.querySelector('#legend').insertAdjacentHTML('beforeend',`<span><i class="dot" style="background:${colors[t]||colors.record}"></i>${t}</span>`)});document.querySelector('#count').textContent=`${data.nodes.length} nodes · ${data.edges.length} relations`;const cx=600,cy=420,R=310,byType={};types.forEach(t=>byType[t]=data.nodes.filter(n=>n.type===t));const pos={};let k=0;types.forEach(t=>byType[t].forEach((n,i)=>{const angle=(k++/data.nodes.length)*Math.PI*2-Math.PI/2;pos[n.id]={x:cx+R*Math.cos(angle),y:cy+R*Math.sin(angle)}}));const edgeEls=[];data.edges.forEach(e=>{const a=pos[e.source],b=pos[e.target];if(!a||!b)return;const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);line.setAttribute('class','link');line.dataset.a=e.source;line.dataset.b=e.target;line.addEventListener('mouseenter',()=>{document.querySelector('#panel').innerHTML=`<h2>${esc(e.label)}</h2><p class="muted">Relationship: ${esc(e.label)}</p>`});lg.append(line);edgeEls.push(line)});const nodeEls=[],nodeElementById=new Map();data.nodes.forEach(n=>{const p=pos[n.id],g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','node');g.dataset.type=n.type;g.dataset.search=(n.label+' '+n.type).toLowerCase();const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);c.setAttribute('r',n.type==='question'?11:8);c.setAttribute('fill',colors[n.type]||colors.record);const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x',p.x+12);text.setAttribute('y',p.y+4);text.textContent=n.label.length>30?n.label.slice(0,28)+'…':n.label;g.append(c,text);g.addEventListener('click',()=>select(n,g));ng.append(g);nodeEls.push(g);nodeElementById.set(n.id,g)});function select(n,g){nodeEls.forEach(el=>el.classList.remove('selected'));g.classList.add('selected');const connected=new Set([n.id]);edgeEls.forEach(e=>{let hit=e.dataset.a===n.id||e.dataset.b===n.id;e.classList.toggle('focus',hit);if(hit){connected.add(e.dataset.a);connected.add(e.dataset.b)}});nodeEls.forEach((el,i)=>el.classList.toggle('dim',!connected.has(data.nodes[i].id)));document.querySelector('#panel').innerHTML=`<h2>${esc(n.label)}</h2>${n.details.map(d=>`<p>${esc(d)}</p>`).join('')}<p class="muted">${connected.size-1} directly connected node(s)</p>`}function apply(){const q=search.value.toLowerCase(),t=filter.value;nodeEls.forEach(el=>el.style.display=(!t||el.dataset.type===t)&&el.dataset.search.includes(q)?'':'none');edgeEls.forEach(e=>{const a=nodeElementById.get(e.dataset.a),b=nodeElementById.get(e.dataset.b);e.style.display=a&&b&&a.style.display!=='none'&&b.style.display!=='none'?'':'none'})}filter.addEventListener('change',apply);search.addEventListener('input',apply);</script></html>'''
    output = args.output.expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(template.replace("__DATA__", payload), encoding="utf-8")
    print(f"Offline graph wheel: {output} ({len(nodes)} nodes, {len(edges)} relations)")
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
    source_search_cmd = sub.add_parser("source-search", help="search local OpenITI/QAC/Fihrist/IIIF data or resolve a Coranicum verse")
    source_search_cmd.add_argument("source", choices=("openiti", "qac", "fihrist", "iiif", "corpus-coranicum"))
    source_search_cmd.add_argument("query", help="Text query or Quran reference such as 4:59")
    source_search_cmd.add_argument("--path", type=Path, help="Local corpus directory or data file; not needed for Corpus Coranicum")
    source_search_cmd.add_argument("--limit", type=int, default=20)
    source_search_cmd.add_argument("--output", type=Path)
    source_search_cmd.set_defaults(func=source_search)
    source_fetch_cmd = sub.add_parser("source-fetch", help="fetch a Quran verse or exact hadith reference for review")
    source_fetch_cmd.add_argument("source", choices=("quran-verse", "sunnah-reference"))
    source_fetch_cmd.add_argument("reference", help="Quran verse key (4:59) or collection:hadith number")
    source_fetch_cmd.add_argument("--translation", help="Quran Foundation translation resource ID")
    source_fetch_cmd.set_defaults(func=source_fetch)
    graph_import = sub.add_parser("graph-import", help="write a provenance-linked RDF graph of unreviewed source candidates")
    graph_import.add_argument("run_id")
    graph_import.add_argument("--output", type=Path)
    graph_import.set_defaults(func=graph_import_candidates)
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
    visualize = sub.add_parser("visualize", help="generate an offline interactive radial graph view")
    visualize.add_argument("--graph", type=Path, default=ROOT / "graph/research.ttl")
    visualize.add_argument("--output", type=Path, default=LIBRARY / "reports/research-graph-wheel.html")
    visualize.set_defaults(func=visualize_graph)
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
