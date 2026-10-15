"""Located verse materials, explicit evidence types, and revision-safe corrections.

These are private owner assertions, never automatic scholarly review or RDF links.
"""
from __future__ import annotations

import uuid

from psycopg import sql

from . import database as db, lexicon as model, passage_store
from .quran_citations import PROFILE_ID, reference

KINDS = {"arabic_text", "translation", "tafsir", "linguistic_annotation", "scholarship"}
LINKS = {"representation", "explicit_citation", "discussion", "interpretive_claim"}
MUTABLE = ("attribution", "language_tag", "source_scope", "assertion_mode", "assertion_text",
           "reading_note", "period_note", "tradition_note", "context_basis", "rationale", "state")
# Literal joins and identifiers only. Project scoping precedes pagination.
SELECT = """SELECT m.*,a.exact AS selected_quote,a.start_pos AS quote_start,a.end_pos AS quote_end,
    d.source_record_id,d.edition,d.locator,d.representation_url,r.title AS source_title,
    c.revision AS current_citation_revision,c.decision AS current_citation_decision,
    c.chapter AS current_citation_chapter,c.ayah_start AS current_citation_start,c.ayah_end AS current_citation_end
    FROM research.verse_materials m
    JOIN research.reading_annotations a ON a.project_id=m.project_id AND a.id=m.annotation_id
    JOIN research.reading_documents d ON d.project_id=m.project_id AND d.id=m.document_id
    JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
    LEFT JOIN research.scripture_citations c ON c.project_id=m.project_id AND c.id=m.citation_id
    WHERE r.deleted_at IS NULL"""


def _decorate(row):
    if row is None:
        return None
    row = dict(row)
    row["reference"] = reference(row["chapter"], row["ayah_start"], row["ayah_end"])
    row["citation_changed_needs_review"] = row["citation_basis"] == "resolved_reference" and (
        row["current_citation_revision"] != row["citation_snapshot"]["revision"])
    row["metadata_status"] = "owner_declared_pending_review"
    return row


def get_material(connection, project_id, material_id):
    return _decorate(connection.execute(SELECT + " AND m.project_id=%s AND m.id=%s", (project_id, material_id)).fetchone())


def _annotation(connection, project_id, annotation_id):
    captured = passage_store.annotation(connection, project_id, annotation_id)
    if captured is None or not captured["anchor"]["anchored"]:
        raise ValueError("An active, anchored source passage is required")
    return captured["annotation"]


def _metadata(link_kind, selected_quote, values):
    if set(values) != set(MUTABLE):
        raise ValueError("Supply the complete mutable material metadata")
    limits = {"attribution":2000,"source_scope":10000,"assertion_text":5000,"reading_note":2000,
              "period_note":2000,"tradition_note":2000,"context_basis":2000,"rationale":2000}
    for key, limit in limits.items():
        db._text(values[key], key, limit, empty=key not in {"attribution", "source_scope", "rationale"})
    model.language_tag(values["language_tag"])
    if values["state"] not in {"active", "withdrawn"}:
        raise ValueError("Unsupported material state")
    mode, body = values["assertion_mode"], values["assertion_text"]
    if link_kind == "interpretive_claim":
        if mode not in {"quotation", "paraphrase"} or not body.strip():
            raise ValueError("Interpretive claims require attributed quotation or paraphrase")
        if mode == "quotation" and body != selected_quote:
            raise ValueError("Quotation must equal the exact source selection")
    elif mode != "none" or body:
        raise ValueError("Only an interpretive claim carries an asserted interpretation")
    if (values["period_note"] or values["tradition_note"]) and not values["context_basis"].strip():
        raise ValueError("Historical or school metadata needs a located context basis")


def _proof(connection, project_id, annotation, target, link_kind, citation_basis, citation_id, marker_start, marker_end):
    if citation_basis not in {"none", "resolved_reference", "owner_identified"}:
        raise ValueError("Unsupported citation evidence basis")
    if (link_kind == "explicit_citation") != (citation_basis != "none"):
        raise ValueError("Explicit citations require their own located marker evidence")
    snapshot = marker_text = None
    if citation_basis == "resolved_reference":
        if marker_start is not None or marker_end is not None:
            raise ValueError("Resolved citation markers are derived on the server")
        row = connection.execute("SELECT c.*,to_jsonb(c) AS evidence_snapshot FROM research.scripture_citations c WHERE project_id=%s AND id=%s FOR SHARE",
                                 (project_id, citation_id)).fetchone()
        if (not row or row["annotation_id"] != annotation["id"] or row["decision"] != "confirmed"
            or row["detector_kind"] == "owner_mapping" or row["profile_id"] != PROFILE_ID
            or any(row[key] != target[key] for key in ("chapter", "ayah_start", "ayah_end"))):
            raise ValueError("A confirmed exact citation to this target and source is required")
        snapshot = row["evidence_snapshot"]
        marker_start, marker_end, marker_text = row["match_start"], row["match_end"], row["matched_text"]
    elif citation_basis == "owner_identified":
        if citation_id is not None:
            raise ValueError("Owner-identified evidence cannot impersonate a detected citation")
        if type(marker_start) is not int or type(marker_end) is not int:
            raise ValueError("Select the exact owner-identified citation marker")
        marker_text = model.selected_term(annotation["exact"], marker_start, marker_end)
    elif any(value is not None for value in (citation_id, marker_start, marker_end)):
        raise ValueError("This material relation cannot carry citation marker evidence")
    return dict(citation_basis=citation_basis, citation_id=citation_id, citation_snapshot=snapshot,
                marker_start=marker_start, marker_end=marker_end, marker_text=marker_text)


def create(connection, *, request_uuid, project_id, annotation_id, chapter, ayah_start, ayah_end,
           material_kind, link_kind, citation_basis, citation_id, marker_start, marker_end, actor, **metadata):
    target = reference(chapter, ayah_start, ayah_end)
    request_id = model.request_identity(request_uuid)
    material_id = "urn:research:verse-material:" + str(uuid.uuid5(request_id, "verse-material"))
    db._text(actor, "actor", 500)
    if material_kind not in KINDS or link_kind not in LINKS:
        raise ValueError("Unsupported reading material classification")
    if (material_kind in {"arabic_text", "translation"}) != (link_kind == "representation"):
        raise ValueError("Text and translation representations are separate from commentary links")
    if metadata.get("state") != "active":
        raise ValueError("New material starts active")
    payload = dict(project_id=project_id, annotation_id=annotation_id, target=target, material_kind=material_kind,
        link_kind=link_kind, citation_basis=citation_basis, citation_id=citation_id,
        marker_start=marker_start, marker_end=marker_end, actor=actor, metadata=metadata)
    digest = model.fingerprint(payload)
    with connection.transaction():
        if connection.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"] != "read committed":
            raise ValueError("Verse material retries require READ COMMITTED isolation")
        connection.execute("SELECT pg_advisory_xact_lock(184514,hashtext(%s))", (str(request_id),))
        previous = connection.execute("SELECT project_id,creation_sha256,revision FROM research.verse_materials WHERE id=%s", (material_id,)).fetchone()
        if previous:
            if previous["project_id"] != project_id or previous["creation_sha256"] != digest:
                raise ValueError("Request ID was already used for different verse material")
            # Replay acknowledges identity only; never replaces later corrected metadata.
            return {"id":material_id,"project_id":project_id,"revision":previous["revision"]}
        annotation = _annotation(connection, project_id, annotation_id)
        _metadata(link_kind, annotation["exact"], metadata)
        proof = _proof(connection, project_id, annotation, target, link_kind, citation_basis, citation_id, marker_start, marker_end)
        values = dict(id=material_id, project_id=project_id, annotation_id=annotation_id,
            document_id=annotation["document_id"], text_sha256=annotation["text_sha256"], creation_sha256=digest,
            profile_id=PROFILE_ID, chapter=chapter, ayah_start=ayah_start, ayah_end=target["ayah_end"],
            material_kind=material_kind, link_kind=link_kind, **proof, **metadata, changed_by=actor)
        columns = list(values)
        inserted = connection.execute(sql.SQL("INSERT INTO research.verse_materials ({}) VALUES ({}) RETURNING id,project_id,revision").format(
            sql.SQL(",").join(map(sql.Identifier, columns)), sql.SQL(",").join(sql.Placeholder() for _ in columns)),
            tuple(db.Jsonb(value) if key == "citation_snapshot" and value is not None else value for key,value in values.items())).fetchone()
        return inserted


def update(connection, *, project_id, material_id, expected_revision, actor, **metadata):
    db._text(actor, "actor", 500)
    if type(expected_revision) is not int or expected_revision < 1:
        raise ValueError("Supply the last confirmed material revision")
    with connection.transaction():
        current = get_material(connection, project_id, material_id)
        if current is None:
            raise ValueError("Active source material not found in this project")
        _metadata(current["link_kind"], current["selected_quote"], metadata)
        values = {**metadata,"changed_by":actor}
        assignments = sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(key)) for key in values)
        row = connection.execute(sql.SQL("UPDATE research.verse_materials SET {},revision=revision+1 WHERE project_id=%s AND id=%s AND revision=%s RETURNING *").format(assignments),
            (*values.values(), project_id, material_id, expected_revision)).fetchone()
        if row:
            return get_material(connection, project_id, material_id)
        current = get_material(connection, project_id, material_id)
        if current and current["revision"] == expected_revision + 1 and all(current[key] == value for key,value in values.items()):
            return current
        raise db.RevisionConflict(current)


def for_verse(connection, project_id, chapter, ayah_start, ayah_end, material_kind, link_kind, cursor, limit):
    target = reference(chapter, ayah_start, ayah_end)
    if material_kind is not None and material_kind not in KINDS or link_kind is not None and link_kind not in LINKS:
        raise ValueError("Unsupported reading material filter")
    rows = connection.execute(SELECT + """ AND m.project_id=%s AND m.profile_id=%s AND m.state='active'
        AND m.chapter=%s AND m.ayah_start<=%s AND m.ayah_end>=%s
        AND (%s::text IS NULL OR m.material_kind=%s) AND (%s::text IS NULL OR m.link_kind=%s)
        AND m.id>%s ORDER BY m.id LIMIT %s""", (project_id, PROFILE_ID, chapter, target["ayah_end"], ayah_start,
            material_kind, material_kind, link_kind, link_kind, cursor, limit)).fetchall()
    return [_decorate(row) for row in rows]


def annotation_links(connection, project_id, annotation_id, cursor, limit):
    if passage_store.annotation(connection, project_id, annotation_id) is None:
        return None
    rows = connection.execute(SELECT + " AND m.project_id=%s AND m.annotation_id=%s AND m.state='active' AND m.id>%s ORDER BY m.id LIMIT %s",
                             (project_id, annotation_id, cursor, limit)).fetchall()
    return [_decorate(row) for row in rows]


def history(connection, project_id, material_id, before_revision, limit):
    if get_material(connection, project_id, material_id) is None:
        return None
    return connection.execute("""SELECT revision,snapshot FROM research.verse_material_revisions
        WHERE material_id=%s AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s""",
        (material_id, before_revision, before_revision, limit)).fetchall()
