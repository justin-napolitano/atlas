#!/usr/bin/env python3
"""Follow registered evidence trails in a local canonical snapshot, without AI."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from islam_research.database_import import plan_turtle
from islam_research.graph_engine import traverse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=Path(__file__).resolve().parents[1] / "graph/research.ttl")
    parser.add_argument("--start", required=True, help="Exact stable record IRI")
    parser.add_argument("--profile", default="question_evidence_trail")
    args = parser.parse_args()
    try:
        plan = plan_turtle(args.graph)
        project = "local-canonical-snapshot"
        records = {r["id"]: {**r, "project_id": project, "review_state": "pending", "revision": None}
                   for r in plan["records"]}
        if args.start not in records:
            raise ValueError("Unknown starting record")
        edges = []
        for triple in plan["relations"]:
            edge_id = "urn:research:local-edge:" + hashlib.sha256(json.dumps(triple, sort_keys=True).encode()).hexdigest()
            edges.append(dict(id=edge_id, project_id=project, from_id=triple["from"], to_id=triple["to"],
                predicate=triple["predicate"], source=records[triple["from"]], target=records[triple["to"]],
                review_state="pending", provenance={"activity": "local_canonical_snapshot", "sha256": plan["sha256"],
                "review_scope": "Preserved assertion; not a new scholarly review"}))
        def adjacent(frontier, step, predicate, limit):
            column = "from_id" if step["direction"] == "out" else "to_id"
            return sorted([e for e in edges if e[column] in frontier and e["predicate"] == step["predicate"]
                and e["source"]["kind"] in predicate["from_kinds"] and e["target"]["kind"] in predicate["to_kinds"]],
                key=lambda e: e["id"])[:limit]
        result = traverse(records[args.start], project, args.profile, adjacent)
        result["snapshot_sha256"] = plan["sha256"]
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError) as error:
        print(f"Graph exploration failed ({type(error).__name__}); check snapshot, record ID, and profile.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
