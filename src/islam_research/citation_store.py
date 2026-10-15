"""Private, revisioned owner resolution of located Qur’an references."""
from __future__ import annotations

import hashlib
import json

from . import database as db, passage_store
from .quran_citations import PARSER_VERSION, PROFILE_ID, detect, reference


def export_resolution(row):
    """Namespaced JSON-LD extension; original annotation retains source selectors."""
    result = {"id": row["id"], "type": "ir:ScriptureReferenceResolution",
              "ir:capturedAnnotation": {"id": row["annotation_id"]},
              "ir:document": {"id": row["document_id"]},
              "ir:reviewStatus": "owner_reference_decision_interpretation_unreviewed"}
    names = {"project_id": "projectId", "text_sha256": "textSha256", "candidate_key": "candidateKey",
             "parser_version": "parserVersion", "detector_kind": "detectorKind", "match_start": "markerStart",
             "match_end": "markerEnd", "matched_text": "matchedText", "profile_id": "structureProfile",
             "decision": "decision", "rationale": "rationale", "revision": "revision"}
    result.update({"ir:" + target: row[source] for source, target in names.items()})
    if row["proposal"]:
        result["ir:proposedReference"] = {"ir:" + key: value for key, value in row["proposal"].items()}
    if row["decision"] == "confirmed":
        resolved = reference(row["chapter"], row["ayah_start"], row["ayah_end"])
        result["ir:resolvedReference"] = {"id": resolved["id"], "type": "ir:QuranReference",
            "ir:structureProfile": resolved["profile_id"], "ir:chapter": row["chapter"],
            "ir:ayahStart": row["ayah_start"], "ir:ayahEnd": row["ayah_end"]}
    return result


def candidates(connection, project_id, annotation_id):
    captured = passage_store.annotation(connection, project_id, annotation_id)
    if captured is None:
        return None
    result = detect(captured["annotation"]["exact"])
    result["resolutions"] = connection.execute("""SELECT * FROM research.scripture_citations
        WHERE project_id=%s AND annotation_id=%s ORDER BY id""", (project_id, annotation_id)).fetchall()
    result["annotation_id"] = annotation_id
    return result


def resolve(connection, *, project_id, annotation_id, candidate_key, decision,
            chapter, ayah_start, ayah_end, rationale, expected_revision, actor):
    """Server rederives source anchors; clients supply only owner decisions."""
    if decision not in {"confirmed", "dismissed"}:
        raise ValueError("Unsupported reference decision")
    db._text(rationale, "reference rationale", 2000)
    db._text(actor, "actor", 500)
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError("Supply the last confirmed reference revision")
    if decision == "confirmed":
        target = reference(chapter, ayah_start, ayah_end)
        chapter, ayah_start, ayah_end = (target[key] for key in ("chapter", "ayah_start", "ayah_end"))
    elif any(value is not None for value in (chapter, ayah_start, ayah_end)):
        raise ValueError("Dismissed references cannot have a resolved target")
    with connection.transaction():
        captured = passage_store.annotation(connection, project_id, annotation_id)
        if captured is None or not captured["anchor"]["anchored"]:
            raise ValueError("Active, anchored annotation not found")
        annotation = captured["annotation"]
        if candidate_key == "manual":
            proposal = {"parser_version": PARSER_VERSION, "detector_kind": "owner_mapping",
                        "match_start": 0, "match_end": len(annotation["exact"]),
                        "matched_text": annotation["exact"], "proposed": None}
        else:
            proposal = next((row for row in detect(annotation["exact"])["candidates"] if row["key"] == candidate_key), None)
            if proposal is None:
                raise ValueError("Candidate changed or is unknown; reload before resolving")
        citation_id = "urn:research:scripture-citation:" + hashlib.sha256(
            json.dumps([annotation_id, candidate_key], separators=(",", ":")).encode()).hexdigest()
        values = {"decision": decision, "chapter": chapter, "ayah_start": ayah_start,
                  "ayah_end": ayah_end, "rationale": rationale, "changed_by": actor}
        if expected_revision == 0:
            row = connection.execute("""INSERT INTO research.scripture_citations
                (id,project_id,annotation_id,document_id,text_sha256,candidate_key,parser_version,
                 detector_kind,match_start,match_end,matched_text,proposal,profile_id,
                 decision,chapter,ayah_start,ayah_end,rationale,changed_by)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(id) DO NOTHING RETURNING *""",
                (citation_id, project_id, annotation_id, annotation["document_id"], annotation["text_sha256"],
                 candidate_key, proposal["parser_version"], proposal["detector_kind"], proposal["match_start"],
                 proposal["match_end"], proposal["matched_text"], db.Jsonb(proposal["proposed"]), PROFILE_ID,
                 decision, chapter, ayah_start, ayah_end, rationale, actor)).fetchone()
        else:
            row = connection.execute("""UPDATE research.scripture_citations SET decision=%s,chapter=%s,
                ayah_start=%s,ayah_end=%s,rationale=%s,changed_by=%s,revision=revision+1
                WHERE project_id=%s AND id=%s AND revision=%s RETURNING *""",
                (decision, chapter, ayah_start, ayah_end, rationale, actor, project_id, citation_id, expected_revision)).fetchone()
        if row is not None:
            return row
        current = connection.execute("SELECT * FROM research.scripture_citations WHERE project_id=%s AND id=%s",
                                     (project_id, citation_id)).fetchone()
        # A repeated acknowledged-or-lost request must not add another revision.
        if current and current["revision"] == expected_revision + 1 and all(current[key] == value for key, value in values.items()):
            return current
        raise db.RevisionConflict(current)


def for_verse(connection, project_id, chapter, ayah_start, ayah_end, cursor, limit):
    reference(chapter, ayah_start, ayah_end)
    return connection.execute("""SELECT c.*,a.exact AS selected_quote,d.source_record_id,d.edition,
        d.locator,d.representation_url,r.title AS source_title FROM research.scripture_citations c
        JOIN research.reading_annotations a ON a.project_id=c.project_id AND a.id=c.annotation_id
        JOIN research.reading_documents d ON d.project_id=c.project_id AND d.id=c.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE c.project_id=%s AND c.profile_id=%s AND c.decision='confirmed' AND c.chapter=%s
        AND c.ayah_start<=%s AND c.ayah_end>=%s AND c.id>%s AND r.deleted_at IS NULL
        ORDER BY c.id LIMIT %s""", (project_id, PROFILE_ID, chapter, ayah_end, ayah_start, cursor, limit)).fetchall()
