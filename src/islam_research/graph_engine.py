"""Registered, bounded research operations. No model-supplied SQL is executed."""
from __future__ import annotations

import hashlib
import math
from importlib.resources import files

from .semantic import _pairs, _reject_constant, validate_policy
import json


def registered_policy():
    text = files("islam_research").joinpath("policies/research-policy.json").read_text(encoding="utf-8")
    policy = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    validate_policy(policy)
    return policy, hashlib.sha256(text.encode()).hexdigest()


def _profile(policy, group, name):
    profile = next((value for value in policy[group] if value["id"] == name), None)
    if profile is None:
        raise ValueError("Unknown registered research operation")
    return profile


def traverse(start, project_id, profile_id, adjacent, *, policy=None):
    """Walk typed paths using an already-authorized, project-filtered provider.

    adjacent(frontier, step, predicate, limit) returns ordered edge dictionaries
    containing source/target records. The provider MUST filter project access and
    tombstones before applying the limit. These operations are owner-only; a
    public snapshot needs its own explicitly published provider.
    """
    registered, digest = registered_policy()
    policy = policy or registered
    validate_policy(policy)
    profile = _profile(policy, "traversal_profiles", profile_id)
    if start["project_id"] != project_id or start.get("deleted_at") is not None:
        raise ValueError("Start record is outside the selected graph")
    if start["kind"] not in profile["start_kinds"]:
        raise ValueError("Start record kind does not match the path profile")
    predicates = {p["iri"]: p for p in policy["predicates"]}
    nodes, edges = {start["id"]: start}, {}
    paths = [{"records": [start["id"]], "edges": []}]
    truncated = False
    for step in profile["steps"]:
        if not paths:
            break
        frontier = sorted({p["records"][-1] for p in paths})
        remaining = profile["max_edges"] - len(edges)
        rows = adjacent(frontier, step, predicates[step["predicate"]], remaining + 1)
        if len(rows) > remaining:
            truncated = True
        indexed = {}
        for row in rows[:remaining]:
            source, target = row["source"], row["target"]
            predicate = predicates[step["predicate"]]
            if (row["project_id"] != project_id or row["predicate"] != step["predicate"]
                or any(n["project_id"] != project_id or n.get("deleted_at") is not None for n in (source, target))
                or source["kind"] not in predicate["from_kinds"] or target["kind"] not in predicate["to_kinds"]
                or row["from_id"] != source["id"] or row["to_id"] != target["id"]
                or not row.get("provenance")):
                raise ValueError("Provider returned an invalid or unauthorized edge")
            origin, destination = (source, target) if step["direction"] == "out" else (target, source)
            if origin["id"] not in frontier:
                raise ValueError("Provider returned an unrelated edge")
            additions = {source["id"], target["id"]} - nodes.keys()
            if len(nodes) + len(additions) > profile["max_nodes"]:
                truncated = True
                continue
            nodes.update({source["id"]: source, target["id"]: target})
            edges[row["id"]] = {k: v for k, v in row.items() if k not in {"source", "target"}}
            indexed.setdefault(origin["id"], []).append((destination["id"], row["id"]))
        expanded = []
        for path in paths:
            for destination, edge_id in indexed.get(path["records"][-1], []):
                if destination in path["records"]:
                    continue
                if len(expanded) >= 500:
                    truncated = True
                    break
                expanded.append({"records": [*path["records"], destination], "edges": [*path["edges"], edge_id]})
        paths = expanded
    complete = [p for p in paths if len(p["edges"]) == len(profile["steps"])]
    return {"profile": profile_id, "profile_version": profile["version"],
            "policy_sha256": digest if policy == registered else None,
            "project_id": project_id, "start_id": start["id"], "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
            "edges": sorted(edges.values(), key=lambda e: e["id"]), "paths": complete,
            "truncated": truncated, "status": "paths_found" if complete else "no_complete_path_in_selected_graph",
            "meaning": "Recorded links and review scope; neither proof nor scholarly consensus."}


def rank(profile_id, candidates):
    """Explain normalized owner-supplied observations; never fabricate missing data."""
    policy, digest = registered_policy()
    profile = _profile(policy, "ranking_profiles", profile_id)
    if len(candidates) > 100 or len({c["id"] for c in candidates}) != len(candidates):
        raise ValueError("Ranking requires at most 100 unique candidate IDs")
    results = []
    expected = {f["name"] for f in profile["features"]}
    for candidate in candidates:
        supplied = candidate["features"]
        if not set(supplied) <= expected:
            raise ValueError("Unknown feature for this ranking profile")
        terms, missing = [], []
        for feature in profile["features"]:
            observation = supplied.get(feature["name"])
            value = observation.get("value") if observation else None
            if value is not None:
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                    raise ValueError("Feature values must be finite numbers between zero and one")
                if not isinstance(observation.get("basis"), str) or not 1 <= len(observation["basis"].strip()) <= 2000:
                    raise ValueError("Observed features require an explicit basis")
            else:
                missing.append(feature["name"])
            terms.append({**feature, "value": value, "basis": observation.get("basis") if observation else None,
                          "contribution": value * feature["weight"] if value is not None else None})
        results.append({"id": candidate["id"], "score": None if missing else sum(t["contribution"] for t in terms),
                        "missing": missing, "terms": terms})
    results.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["id"]))
    return {"profile": profile_id, "profile_version": profile["version"], "policy_sha256": digest,
            "meaning": profile["meaning"], "input_origin": "owner_supplied_observations_not_verified_extraction",
            "order": "descending_score_then_stable_id_unknown_last", "items": results}
