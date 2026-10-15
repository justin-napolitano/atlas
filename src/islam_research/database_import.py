"""Idempotent, lossless snapshot intake into a derived PostgreSQL graph index.

The original Turtle stays available for exact export. Imported nodes cannot be
edited through the repository while the project retains canonical RDF authority.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from rdflib import Graph, Namespace, RDF, RDFS
from rdflib.namespace import DCTERMS, SKOS, PROV
from psycopg.types.json import Jsonb

from .database import get_record

LOCAL = "https://islam-research.local/id/"
IR = Namespace("https://islam-research.local/vocab/")
TYPE_PRIORITY = [(IR.SourceRecord, "source"), (IR.Claim, "claim"),
                 (IR.EvidenceRecord, "evidence"), (IR.ResearchQuestion, "question"),
                 (IR.ResearcherPosition, "hypothesis"), (SKOS.Concept, "concept"),
                 (PROV.Agent, "person")]


def plan_turtle(path: Path) -> dict:
    """Read one bounded local Turtle file without acquiring remote resources."""
    if path.stat().st_size > 5_000_000:
        raise ValueError("Import exceeds the five-megabyte snapshot limit")
    text = path.read_text(encoding="utf-8")
    graph = Graph().parse(data=text, format="turtle")
    subjects = {s for s in graph.subjects() if str(s).startswith(LOCAL)}
    records = []
    for subject in sorted(subjects, key=str):
        properties = {str(p): sorted(v.n3() for v in graph.objects(subject, p))
                      for p in sorted(set(graph.predicates(subject)), key=str)}
        summary = "; ".join(str(v) for predicate in (IR.claimText, IR.paraphrase, DCTERMS.description)
                            for v in graph.objects(subject, predicate))
        records.append({"id": str(subject), "kind": next((kind for rdf_type, kind in TYPE_PRIORITY
                        if (subject, RDF.type, rdf_type) in graph), "record"),
                        "title": str(graph.value(subject, RDFS.label) or graph.value(subject, SKOS.prefLabel) or subject),
                        "summary": summary, "attributes": {"rdf_properties": properties,
                        "recorded_review_status": [str(v) for v in graph.objects(subject, IR.reviewStatus)],
                        "review_scope": "Imported assertions, not a new scholarly review"}})
    excluded = {RDF.type, RDFS.label, RDFS.comment, SKOS.prefLabel, SKOS.definition}
    relations = [{"from": str(s), "predicate": str(p), "to": str(o)} for s,p,o in graph
                 if s in subjects and o in subjects and p not in excluded]
    return {"sha256": hashlib.sha256(text.encode()).hexdigest(), "original_text": text,
            "records": records, "relations": sorted(relations, key=lambda r: (r["from"],r["predicate"],r["to"]))}


def import_turtle(connection, path: Path, project_id: str, *, actor: str, dry_run: bool = True) -> dict:
    """Preview or atomically index a canonical snapshot; changed imports require reconciliation.

    Repeated identical input is a no-op. A changed snapshot is rejected rather than
    overwriting graph authoring state or creating a competing source of truth.
    """
    plan = plan_turtle(path)
    result = {"sha256": plan["sha256"], "records": len(plan["records"]),
              "relations": len(plan["relations"]), "dry_run": dry_run, "already_imported": False}
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(729117422)")
        project = connection.execute("SELECT * FROM research.projects WHERE id=%s FOR UPDATE", (project_id,)).fetchone()
        if not project or project["graph_authority"] != "canonical_rdf":
            raise ValueError("Import requires an existing project with canonical RDF authority")
        existing = connection.execute("SELECT sha256 FROM research.import_snapshots WHERE project_id=%s AND format='turtle'", (project_id,)).fetchall()
        if any(row["sha256"] == plan["sha256"] for row in existing):
            return {**result, "already_imported": True}
        if existing:
            raise ValueError("A changed canonical snapshot requires explicit reconciliation; nothing was overwritten")
        if any(get_record(connection, row["id"]) is not None for row in plan["records"]):
            raise ValueError("Existing stable IDs require reconciliation before this import")
        if dry_run:
            return result
        for row in plan["records"]:
            connection.execute("""INSERT INTO research.records
                (id,project_id,kind,title,summary,attributes,origin,changed_by)
                VALUES (%s,%s,%s,%s,%s,%s,'canonical_rdf',%s)""",
                (row["id"], project_id, row["kind"], row["title"], row["summary"], Jsonb(row["attributes"]), actor))
        for row in plan["relations"]:
            connection.execute("""INSERT INTO research.relation_types(predicate,description)
                VALUES (%s,%s) ON CONFLICT(predicate) DO NOTHING""",
                (row["predicate"], "Existing canonical predicate; scoped execution rules require a reviewed profile"))
            triple = "\n".join((project_id, row["from"], row["predicate"], row["to"]))
            relation_id = "urn:research:relation:" + hashlib.sha256(triple.encode()).hexdigest()
            connection.execute("""INSERT INTO research.relations
                (id,project_id,from_id,predicate,to_id,provenance)
                VALUES (%s,%s,%s,%s,%s,%s)""", (relation_id, project_id, row["from"], row["predicate"], row["to"],
                Jsonb({"activity": "canonical_rdf_import", "snapshot_sha256": plan["sha256"], "actor": actor,
                       "review_scope": "Preserved triple, not a new assertion of scholarly verification"})))
        connection.execute("""INSERT INTO research.import_snapshots
            (project_id,sha256,format,original_text,record_count,relation_count)
            VALUES (%s,%s,'turtle',%s,%s,%s)""", (project_id, plan["sha256"], plan["original_text"], result["records"], result["relations"]))
    return result
