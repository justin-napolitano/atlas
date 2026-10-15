"""Owner-selected projections. Private reading tables are never publication inputs."""
from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
import re
from urllib.parse import urlsplit
import uuid

from psycopg.errors import SerializationFailure
from psycopg.types.json import Jsonb

from .database import RevisionConflict

PUBLIC_KINDS = frozenset("source work edition claim evidence question hypothesis concept lexical_form sense definition occurrence person place period tradition school event article".split())
PUBLICATION_POLICY = {"policy": "explicit_owner_selection_v1", "review": "Visibility approval is not a new scholarly review"}
IR = "https://islam-research.local/vocab/"
DCT = "http://purl.org/dc/terms/"


def _metadata(record):
    """Parse only selected RDF bibliography predicates; never fetch remote data."""
    from rdflib import Literal
    from rdflib.util import from_n3
    properties = record.get("attributes", {}).get("rdf_properties", {})
    if not isinstance(properties,dict):
        raise ValueError("Publication bibliography must be a predicate mapping")
    def values(predicate):
        raw = properties.get(predicate, [])
        if not isinstance(raw, list) or len(raw)>20:
            raise ValueError("Publication metadata needs review")
        result = []
        for value in raw:
            if not isinstance(value, str) or len(value)>4000:
                raise ValueError("Publication metadata exceeds its reviewed bounds")
            try:
                if value.startswith('<') and value.endswith('>'):
                    # Decode only N3 Unicode escapes; constructing an invalid URIRef
                    # can log the private draft URI before the owner approves it.
                    iri=re.sub(r'\\(?:u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})',lambda m:chr(int(m[0][2:],16)),value[1:-1])
                    result.append(iri)
                elif value.startswith('"'):
                    delimiter='"""' if value.startswith('"""') else '"'
                    end=value.rfind(delimiter)
                    if end<len(delimiter):
                        raise ValueError("Unclosed bibliography literal")
                    # Publish the lexical text. Datatype conversion may log an
                    # invalid private literal, and is unnecessary for bibliography.
                    term=from_n3(value[:end+len(delimiter)])
                    if not isinstance(term,Literal):
                        raise ValueError("Bibliography value is not a literal")
                    result.append(str(term))
                else:
                    raise ValueError("Bibliography requires explicit literals or IRIs")
            except (ValueError,KeyError,TypeError,AssertionError):
                raise ValueError("Publication bibliography needs lexical review") from None
        return result
    links = []
    for value in values(DCT + "source"):
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query:
            continue
        host = url.hostname.lower()
        if host=="localhost" or host.endswith((".localhost", ".local", ".internal")):
            continue
        try:
            if not ipaddress.ip_address(host).is_global:
                continue
        except ValueError:
            pass
        if any(ord(c)<33 for c in value):
            continue
        links.append({"url": value, "label": host})
    return {"scope": "; ".join(values(IR + "scope")), "locator": "; ".join(values(IR + "locator")),
            "citation": "; ".join(values(DCT + "bibliographicCitation")),
            "role": "; ".join(values(IR + "sourceRole")),
            "people": [v for v in values(DCT + "creator") if not v.startswith("https://islam-research.local/id/")],
            "links": links, "review_limits": ["Imported review labels describe their original scope; no new scholarly review", *values(IR + "reviewStatus")]}


def project_payload(inputs: dict, selections: list[dict], relation_ids: list[str], *, snapshot_id: str, generated_at: str) -> dict:
    """Explicit options, fixed output shape, no attributes or personal-state passthrough."""
    if not inputs.get("project") or not 1<=len(selections)<=100 or len(relation_ids)>300:
        raise ValueError("Choose an existing project and a bounded publication selection")
    ids = [s["record_id"] for s in selections]
    if len(set(ids))!=len(ids) or len(set(relation_ids))!=len(relation_ids):
        raise ValueError("Duplicate publication selection")
    records = {r["id"]: r for r in inputs["records"]}
    edges = {r["id"]: r for r in inputs["relations"]}
    if set(ids)!=set(records) or set(relation_ids)!=set(edges):
        raise ValueError("Missing, deleted, or cross-project publication inputs")
    nodes = []
    options = {s["record_id"]: s for s in selections}
    for identifier in sorted(ids):
        row, selection = records[identifier], options[identifier]
        if row["kind"] not in PUBLIC_KINDS or row["review_state"]=="withdrawn":
            raise ValueError("Private-only kinds and withdrawn research cannot be published")
        node = {"id": identifier, "label": row["title"], "type": row["kind"], "status": row["review_state"],
                "origin": row["origin"], "source_revision": row["revision"],
                "summary": row["summary"] if selection.get("include_summary", False) else "",
                "scope": "", "locator": "", "citation": "", "role": "", "people": [], "links": [],
                "review_limits": ["Owner-selected publication; publication is not a new scholarly review"]}
        if selection.get("include_bibliography", False):
            node.update(_metadata(row))
        nodes.append(node)
    relations = []
    for identifier in sorted(relation_ids):
        row = edges[identifier]
        if row["from_id"] not in records or row["to_id"] not in records or row["review_state"]=="withdrawn":
            raise ValueError("Publish both endpoints of a selected, non-withdrawn relation")
        relations.append({"id": identifier, "from": row["from_id"], "to": row["to_id"],
                          "predicate": row["predicate"], "label": row["predicate"].rsplit("/",1)[-1].rsplit("#",1)[-1],
                          "status": row["review_state"]})
    project = inputs["project"]
    payload = {"format_version": 1, "snapshot_id": snapshot_id, "generated_at": generated_at,
               "curated_graph": project["graph_authority"], "project": {"id": project["id"], "title": project["title"]},
               "canonical_snapshot_sha256": inputs.get("canonical_snapshot_sha256",[]),
               "nodes": nodes, "edges": relations, "candidates": [], "publication": PUBLICATION_POLICY.copy()}
    if len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode())>1_000_000:
        raise ValueError("Public projection exceeds one megabyte; select a smaller release")
    return payload


def head(connection, project_id):
    # Owner reads through a private fixed-function boundary, without public schema access.
    return connection.execute("SELECT research.publication_head(%s) AS head", (project_id,)).fetchone()["head"]


def preview(connection, *, project_id, selections, relation_ids, actor):
    ids = [s["record_id"] for s in selections]
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        inputs = connection.execute("SELECT research.publication_inputs(%s,%s,%s) AS inputs", (project_id, ids, relation_ids)).fetchone()["inputs"]
        identifier = "publication-" + uuid.uuid4().hex
        payload = project_payload(inputs, selections, relation_ids, snapshot_id=identifier,
                                  generated_at=datetime.now(timezone.utc).isoformat())
        return connection.execute("""INSERT INTO research.publication_previews
            (id,project_id,record_ids,relation_ids,inputs,payload,payload_sha256,created_by)
            VALUES(%s,%s,%s,%s,%s,%s,encode(sha256(convert_to(%s::jsonb::text,'UTF8')),'hex'),%s)
            RETURNING id,project_id,payload,payload_sha256,created_at""",
            (identifier, project_id, ids, relation_ids, Jsonb(inputs), Jsonb(payload), Jsonb(payload), actor)).fetchone()


def approve(connection, *, preview_id, expected_sha256, expected_revision, rationale, actor, rights_checked):
    try:
        with connection.transaction():
            return connection.execute("SELECT research.approve_publication(%s,%s,%s,%s,%s,%s) AS head",
                (preview_id, expected_sha256, expected_revision, rationale, actor, rights_checked)).fetchone()["head"]
    except SerializationFailure:
        # The caller can reload the head and build a fresh preview; don't echo SQL or payloads.
        raise RevisionConflict({"publication_changed": True, "preview_may_be_stale": True}) from None


def withdraw(connection, *, project_id, expected_revision, rationale, actor):
    try:
        with connection.transaction():
            return connection.execute("SELECT research.withdraw_publication(%s,%s,%s,%s) AS head",
                (project_id, expected_revision, rationale, actor)).fetchone()["head"]
    except SerializationFailure:
        raise RevisionConflict({"publication_changed": True}) from None
