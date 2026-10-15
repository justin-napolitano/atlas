"""Offline validation for pinned Ossie metadata and research-specific policies.

Model SQL is interchange metadata only. This module never evaluates it, opens a
database, retrieves remote schemas, or grants access based on model annotations.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from importlib.resources import files
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry

TABLES = {
    "projects": {"id", "title", "scope", "graph_authority"},
    "records": {"id", "project_id", "kind", "title", "summary", "review_state", "origin", "revision", "updated_at"},
    "relations": {"id", "project_id", "from_id", "predicate", "to_id", "provenance", "review_state"},
    "personal_states": {"record_id", "project_id", "reading", "read_at", "decision", "note", "revision"},
    "reading_documents": {"id", "project_id", "source_record_id", "edition", "locator", "representation_url", "text_sha256", "review_scope"},
    "reading_annotations": {"id", "project_id", "document_id", "text_sha256", "start_pos", "end_pos", "exact", "capture_kind", "body", "revision"},
    "scripture_citations": {"id", "project_id", "annotation_id", "document_id", "text_sha256", "candidate_key", "detector_kind", "profile_id", "decision", "chapter", "ayah_start", "ayah_end", "rationale", "revision"},
    "verse_materials": {"id","project_id","annotation_id","document_id","text_sha256","profile_id","chapter","ayah_start","ayah_end",
        "material_kind","link_kind","citation_basis","citation_id","citation_snapshot","attribution","language_tag","source_scope",
        "assertion_mode","assertion_text","reading_note","period_note","tradition_note","context_basis","rationale","state","review_state","revision"},
    "lexicon_entries": {"id","project_id","entry_type","scope","revision"},
    "lexicon_forms": {"id","project_id","entry_id","form_kind","rationale","revision"},
    "lexicon_representations": {"id","project_id","form_id","origin_annotation_id","origin_start","origin_end","written_rep","language_tag","script_tag","transliteration_scheme","rationale","revision"},
    "lexicon_senses": {"id","project_id","entry_id","concept_id","scope","rationale","state","review_state","revision"},
    "lexicon_definitions": {"id","project_id","concept_id","sense_id","annotation_id","definition_kind","wording_mode","body","attribution","attribution_person_id","scope","dating_note","rationale","proposal_tool","proposal_version","proposal_activity","state","review_state","revision"},
    "lexicon_occurrences": {"id","project_id","representation_id","sense_id","annotation_id","document_id","text_sha256","term_start","term_end","exact","rationale","state","review_state","revision"},
}
FEATURES = {"query_match", "scope_match", "owner_priority", "question_relevance", "terminology_load",
            "historical_context_load", "argument_load", "language_load", "unfamiliar_concepts",
            "unfamiliar_people_context", "normalized_degree"}


def _reject_constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path):
    """Load bounded strict JSON without duplicate keys or NaN/Infinity."""
    if path.stat().st_size > 1_000_000:
        raise ValueError("Semantic document exceeds one megabyte")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_pairs, parse_constant=_reject_constant)


def _unique(values, name):
    if len(values) != len(set(values)):
        raise ValueError(f"Duplicate {name}")


def validate_model(model: dict, schema: dict) -> None:
    """Check schema, declared grain, unique names and composite join references."""
    def deny_remote(uri):
        raise ValueError("Remote schema retrieval is disabled")
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, registry=Registry(retrieve=deny_remote)).validate(model)
    if len(model["semantic_model"]) != 1:
        raise ValueError("This adapter supports exactly one research model")
    content = model["semantic_model"][0]
    datasets = content["datasets"]
    _unique([d["name"] for d in datasets], "dataset names")
    by_name = {d["name"]: d for d in datasets}
    for dataset in datasets:
        name = dataset["name"]
        if name not in TABLES or dataset["source"] != "research." + name:
            raise ValueError("Unsupported dataset/source binding")
        columns = [f["name"] for f in dataset.get("fields", [])]
        _unique(columns, "field names")
        if set(columns) != TABLES[name]:
            raise ValueError(f"Dataset fields do not match the research contract: {name}")
        for key in [dataset.get("primary_key", [])] + dataset.get("unique_keys", []):
            if not key or not set(key) <= set(columns) or len(set(key)) != len(key):
                raise ValueError(f"Invalid declared key for {name}")
    relationships = content.get("relationships", [])
    _unique([r["name"] for r in relationships], "relationship names")
    for relation in relationships:
        source, target = by_name.get(relation["from"]), by_name.get(relation["to"])
        if not source or not target:
            raise ValueError("Relationship references an unknown dataset")
        left, right = relation["from_columns"], relation["to_columns"]
        if len(left) != len(right) or not set(left) <= TABLES[source["name"]] or not set(right) <= TABLES[target["name"]]:
            raise ValueError("Invalid relationship column mapping")
        keys = [target.get("primary_key", [])] + target.get("unique_keys", [])
        if right not in keys:
            raise ValueError("Relationship target does not declare that unique grain")
    _unique([m["name"] for m in content.get("metrics", [])], "metric names")
    for entity in [content, *datasets, *relationships, *content.get("metrics", []),
                   *(f for dataset in datasets for f in dataset.get("fields", []))]:
        for extension in entity.get("custom_extensions", []):
            # Extensions are structured metadata, not executable instructions/SQL.
            json.loads(extension["data"], object_pairs_hook=_pairs, parse_constant=_reject_constant)


def validate_policy(policy: dict) -> None:
    """Validate the supported bounded execution definitions, without running them."""
    if type(policy.get("version")) is not int or policy.get("version") != 1 or policy.get("execution_status") != "definition_only":
        raise ValueError("Unsupported research policy version/status")
    kinds = policy["kind_mappings"]
    _unique([k["kind"] for k in kinds], "record kinds")
    for mapping in kinds:
        if mapping["status"] not in {"mapped", "reserved"}:
            raise ValueError("Invalid mapping status")
        if (mapping["status"] == "mapped") != bool(mapping["rdf_class"]):
            raise ValueError("A reserved kind cannot claim an implemented RDF class")
    kind_names = {k["kind"] for k in kinds}
    predicates = policy["predicates"]
    _unique([p["iri"] for p in predicates], "predicates")
    predicate_map = {p["iri"]: p for p in predicates}
    for predicate in predicates:
        if not predicate["iri"].startswith(("https://", "http://")) or not predicate["meaning"]:
            raise ValueError("A predicate needs an IRI and meaning")
        if not predicate["from_kinds"] or not predicate["to_kinds"] or not set(predicate["from_kinds"] + predicate["to_kinds"]) <= kind_names:
            raise ValueError("Predicate endpoint kinds must be declared")
    traversals = policy["traversal_profiles"]
    _unique([p["id"] for p in traversals], "traversal profiles")
    for profile in traversals:
        if type(profile["version"]) is not int or profile["version"] < 1:
            raise ValueError("Invalid traversal version")
        if profile["cycle_policy"] != "simple_paths" or profile["authorization"] != "filter_before_traversal":
            raise ValueError("Unsafe traversal policy")
        for key, maximum in [("max_depth", 10), ("max_nodes", 5000), ("max_edges", 10000)]:
            if type(profile[key]) is not int or not 1 <= profile[key] <= maximum:
                raise ValueError("Unbounded or invalid traversal limits")
        steps = profile["steps"]
        if len(steps) != profile["max_depth"]:
            raise ValueError("A path profile must declare one typed predicate per step")
        current = set(profile["start_kinds"])
        if not current or not current <= kind_names:
            raise ValueError("Invalid start kinds")
        for step in steps:
            predicate = predicate_map.get(step["predicate"])
            if predicate is None or step["direction"] not in {"in", "out"}:
                raise ValueError("Unknown predicate or direction")
            start, end = (predicate["from_kinds"], predicate["to_kinds"]) if step["direction"] == "out" else (predicate["to_kinds"], predicate["from_kinds"])
            if not current <= set(start):
                raise ValueError("Traversal endpoint types do not compose")
            current = set(end)
        if not current <= set(profile["end_kinds"]):
            raise ValueError("Traversal does not reach its declared end kinds")
    rankings = policy["ranking_profiles"]
    _unique([p["id"] for p in rankings], "ranking profiles")
    for profile in rankings:
        if profile["status"] != "definition_only" or profile["scope"] != "owner" or type(profile["version"]) is not int or profile["version"] != 1:
            raise ValueError("Unsupported ranking definition")
        if profile["missing_policy"] != "propagate_unknown" or profile["tie_breaker"] != "stable_id":
            raise ValueError("Unknown or ambiguous ranking policy")
        names = [f["name"] for f in profile["features"]]
        if not names or not set(names) <= FEATURES:
            raise ValueError("Unknown ranking feature")
        _unique(names, "ranking features")
        for feature in profile["features"]:
            value = feature["weight"]
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 1:
                raise ValueError("Invalid ranking weight")
        if not math.isclose(sum(f["weight"] for f in profile["features"]), 1, abs_tol=1e-9):
            raise ValueError("Ranking weights must sum to one")


def validate_directory(root: Path) -> dict:
    """Verify vendored checksums and contracts completely offline."""
    manifest = load_json(root / "upstream.lock.json")
    expected_files = {"osi-schema.json", "LICENSE", "LICENSE-Docs", "NOTICE"}
    if set(manifest["files"]) != expected_files or not re.fullmatch(r"[0-9a-f]{40}", manifest["commit"]):
        raise ValueError("Invalid pinned upstream manifest")
    for name, digest in manifest["files"].items():
        if hashlib.sha256((root / "vendor/apache-ossie" / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Vendored upstream content drift: {name}")
    schema = load_json(root / "vendor/apache-ossie/osi-schema.json")
    model = load_json(root / "research.ossie.json")
    policy = load_json(Path(str(files("islam_research").joinpath("policies/research-policy.json"))))
    validate_model(model, schema)
    validate_policy(policy)
    return {"upstream_commit": manifest["commit"], "release_status": manifest["release_status"],
            "datasets": len(model["semantic_model"][0]["datasets"]),
            "ranking_definitions": len(policy["ranking_profiles"]),
            "traversal_definitions": len(policy["traversal_profiles"]), "execution": "not implemented by this validator"}
