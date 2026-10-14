"""Export a deliberate public snapshot from the canonical graph and one harvest queue.

Only an allowlist of bibliography fields is copied from candidate records.
Never serialize the complete private run manifest or candidate JSONL rows.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from rdflib import Graph, Namespace, RDF, RDFS

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUN = "20261014T155152Z-080d85"
IR = Namespace("https://islam-research.local/vocab/")
SKOS = Namespace("http://www.w3.org/2004/02/skos/core#")
PROV = Namespace("http://www.w3.org/ns/prov#")
DCT = Namespace("http://purl.org/dc/terms/")
LOCAL = "https://islam-research.local/id/"


def vals(graph, subject, predicate):
    return [str(value) for value in graph.objects(subject, predicate)]


def export_curated(graph_path: Path):
    graph = Graph().parse(str(graph_path), format="turtle")
    type_names = {
        IR.SourceRecord: "source", IR.Claim: "claim", IR.EvidenceRecord: "evidence",
        IR.ResearchQuestion: "question", IR.ResearcherPosition: "hypothesis",
        SKOS.Concept: "concept", PROV.Agent: "person",
    }
    subjects = {s for s in graph.subjects() if str(s).startswith(LOCAL)}
    nodes = []
    for subject in sorted(subjects, key=str):
        label = graph.value(subject, RDFS.label) or graph.value(subject, SKOS.prefLabel) or subject
        types = [type_names[t] for t in graph.objects(subject, RDF.type) if t in type_names]
        links = []
        for value in graph.objects(subject, DCT.source):
            if str(value).startswith(("https://", "http://")):
                links.append({"url": str(value), "label": str(value).split("/")[2]})
        node = {
            "id": str(subject), "label": str(label), "type": types[0] if types else "record",
            "status": "; ".join(vals(graph, subject, IR.reviewStatus)) or "not stated",
            "summary": "; ".join(vals(graph, subject, IR.claimText) + vals(graph, subject, IR.paraphrase) + vals(graph, subject, DCT.description)),
            "scope": "; ".join(vals(graph, subject, IR.scope)),
            "people": vals(graph, subject, DCT.creator) + vals(graph, subject, IR.attributedTo),
            "role": "; ".join(vals(graph, subject, IR.sourceRole)),
            "locator": "; ".join(vals(graph, subject, IR.locator)),
            "links": links,
        }
        node["people"] = [value for value in node["people"] if value and not value.startswith(LOCAL)]
        nodes.append(node)

    node_ids = {node["id"] for node in nodes}
    excluded = {RDF.type, RDFS.label, RDFS.comment, SKOS.prefLabel, SKOS.definition}
    edges = []
    for source, predicate, target in graph:
        if source in subjects and str(target) in node_ids and predicate not in excluded:
            edges.append({"from": str(source), "to": str(target), "label": str(predicate).rsplit("/", 1)[-1].rsplit("#", 1)[-1]})
    return nodes, edges


def export_candidates(queue_path: Path):
    candidates = []
    with queue_path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            item = json.loads(line)
            # Explicit allowlist: do not add text, local locations, screening, or run internals.
            safe = {
                "id": str(item.get("candidate_id") or item.get("record_id") or item.get("doi") or item.get("provider_id") or ""),
                "title": str(item.get("title") or "Untitled metadata record"),
                "providers": [str(v) for v in item.get("providers", [])],
                "provider_ids": [str(value) for value in (item.get("provider_ids_by_provider") or {}).values()]
                    or ([str(item.get("provider_id"))] if item.get("provider_id") else []),
                "provider_ids_by_provider": {str(k): str(v) for k, v in (item.get("provider_ids_by_provider") or {}).items()},
                "doi": str(item.get("doi")) if item.get("doi") else "",
                "authors": [str(a.get("name") or "") if isinstance(a, dict) else str(a) for a in item.get("authors", [])],
                "year": item.get("year"),
                "venue": str(item.get("venue") or ""),
                "work_type": str(item.get("work_type") or ""),
                "landing_url": str(item.get("landing_page") or ""),
                "provider_ranks": {str(k): v for k, v in (item.get("provider_ranks") or {}).items()},
                "provider_ranks_by_query": {
                    str(query): {str(provider): rank for provider, rank in (ranks or {}).items()}
                    for query, ranks in (item.get("provider_ranks_by_query") or {}).items()
                },
                "queries": [str(q) for q in item.get("queries", [])],
                "retrieved_at": str(item.get("retrieved_at") or ""),
                "review_status": "candidate_unreviewed",
            }
            if not safe["id"]:
                continue
            if safe["landing_url"] and not re.match(r"^https?://", safe["landing_url"], re.I):
                safe["landing_url"] = ""
            candidates.append(safe)
    return sorted(candidates, key=lambda item: ((item["year"] is None), -(item["year"] or 0), item["title"].casefold()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default=DEFAULT_RUN, help="Harvest queue under research-library/searches (never copied wholesale)")
    parser.add_argument("--output", type=Path, default=ROOT / "web/src/data/public-graph.json")
    args = parser.parse_args()
    graph_path = ROOT / "graph/research.ttl"
    queue = ROOT / "research-library" / "searches" / args.run_id / "candidates.jsonl"
    if not graph_path.is_file() or not queue.is_file():
        parser.error(f"required input missing: {graph_path if not graph_path.is_file() else queue}")
    nodes, edges = export_curated(graph_path)
    candidates = export_candidates(queue)
    payload = {"snapshot_id": args.run_id, "curated_graph": "canonical_rdf", "nodes": nodes, "edges": edges, "candidates": candidates}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote public-safe snapshot: {args.output} ({len(nodes)} curated records, {len(candidates)} unreviewed candidates)")


if __name__ == "__main__":
    main()
