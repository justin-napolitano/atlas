"""Owner-only, project-scoped discovery across existing research authorities.

This is literal retrieval, not an embedding service or a scholarly evaluation.
No search result creates, reviews, or publishes research state.
"""
from . import database as db


# All fragments below are application constants. User values are bound parameters.
_DEFAULTS = {
    "record_id": "NULL::text", "document_id": "NULL::text", "annotation_id": "NULL::text",
    "entry_id": "NULL::text", "concept_id": "NULL::text", "source_record_id": "NULL::text",
    "revision": "NULL::integer", "edition": "NULL::text", "locator": "NULL::text",
    "record_kind": "NULL::text", "thought_type": "NULL::text", "text_sha256": "NULL::text",
    "selected_quote": "NULL::text", "review_state": "NULL::text", "wording_mode": "NULL::text",
}


def _branch(identifier, kind, title, text, channel, tables, where, **values):
    columns = dict(id=identifier, project_id="p.project_id", kind=kind, title=title,
                   search_text=text, channel=channel, **{**_DEFAULTS, **values})
    return "SELECT " + ",".join(f"{value} AS {name}" for name, value in columns.items()) + "\nFROM " + tables + "\nWHERE " + where


_LIVE_RECORD = "r.deleted_at IS NULL AND r.review_state<>'withdrawn'"
_LIVE_CONCEPT = "c.deleted_at IS NULL AND c.review_state<>'withdrawn'"
_SOURCE_JOINS = """research.reading_documents d
    JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id CROSS JOIN params p"""
_ANNOTATION_JOINS = """research.reading_annotations a
    JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
    JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id CROSS JOIN params p"""
_DOCUMENT_FIELDS = dict(record_id="r.id", source_record_id="r.id", document_id="d.id", edition="d.edition",
                        locator="d.locator", record_kind="r.kind", text_sha256="d.text_sha256")

_CANDIDATES = "\nUNION ALL\n".join([
    _branch("r.id", "CASE WHEN r.kind='concept' THEN 'concept' ELSE 'record' END", "r.title",
            "r.title||' '||r.summary", "CASE WHEN r.kind='concept' THEN 'concept_text' ELSE 'record_text' END",
            "research.records r CROSS JOIN params p", "r.project_id=p.project_id AND " + _LIVE_RECORD,
            record_id="r.id", concept_id="CASE WHEN r.kind='concept' THEN r.id ELSE NULL END",
            revision="r.revision", record_kind="r.kind", review_state="r.review_state"),
    _branch("d.id", "'document'", "r.title", "d.text_body", "'document_text'", _SOURCE_JOINS,
            "d.project_id=p.project_id AND " + _LIVE_RECORD, **_DOCUMENT_FIELDS, review_state="r.review_state"),
    _branch("a.id", "'passage_note'", "r.title", "a.exact||' '||a.body", "'passage_note'", _ANNOTATION_JOINS,
            "a.project_id=p.project_id AND " + _LIVE_RECORD,
            **_DOCUMENT_FIELDS, annotation_id="a.id", revision="a.revision", selected_quote="a.exact",
            review_state="'captured_unreviewed'"),
    _branch("s.record_id", "'record_note'", "r.title", "s.note", "'record_note'",
            "research.personal_states s JOIN research.records r ON r.project_id=s.project_id AND r.id=s.record_id CROSS JOIN params p",
            "s.project_id=p.project_id AND btrim(s.note)<>'' AND " + _LIVE_RECORD,
            record_id="r.id", source_record_id="r.id", revision="s.revision", record_kind="r.kind"),
    _branch("n.id", "'thought'", "n.title", "n.title||' '||n.body", "'notebook_thought'",
            """research.notebook_entries n LEFT JOIN research.records r ON r.project_id=n.project_id AND r.id=n.record_id
            LEFT JOIN research.reading_documents d ON d.project_id=n.project_id AND d.id=n.document_id
            LEFT JOIN research.reading_annotations a ON a.project_id=n.project_id AND a.id=n.annotation_id CROSS JOIN params p""",
            "n.project_id=p.project_id AND n.state='active' AND (n.record_id IS NULL OR (" + _LIVE_RECORD + "))",
            record_id="n.record_id", source_record_id="n.record_id", document_id="n.document_id",
            annotation_id="n.annotation_id", entry_id="n.id", revision="n.revision", edition="d.edition", locator="d.locator",
            thought_type="n.thought_type", record_kind="r.kind", text_sha256="d.text_sha256", selected_quote="a.exact",
            review_state="n.review_state", wording_mode="'owner_thought'"),
    _branch("l.id", "'definition'", "c.title", "l.body||' '||l.scope", "'definition_text'",
            """research.lexicon_definitions l
            JOIN research.records c ON c.project_id=l.project_id AND c.id=l.concept_id
            JOIN research.reading_annotations a ON a.project_id=l.project_id AND a.id=l.annotation_id
            JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
            JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
            LEFT JOIN research.lexicon_senses s ON s.project_id=l.project_id AND s.id=l.sense_id CROSS JOIN params p""",
            "l.project_id=p.project_id AND l.state='active' AND (l.sense_id IS NULL OR s.state='active') AND " + _LIVE_RECORD + " AND " + _LIVE_CONCEPT,
            **_DOCUMENT_FIELDS, concept_id="c.id", annotation_id="a.id", revision="l.revision", selected_quote="a.exact",
            review_state="l.review_state", wording_mode="l.wording_mode"),
    _branch("x.id||':'||s.id", "'concept'", "c.title", "x.written_rep", "'lexicon_spelling'",
            """research.lexicon_representations x
            JOIN research.lexicon_forms f ON f.project_id=x.project_id AND f.id=x.form_id
            JOIN research.lexicon_senses s ON s.project_id=f.project_id AND s.entry_id=f.entry_id
            JOIN research.records c ON c.project_id=s.project_id AND c.id=s.concept_id
            JOIN research.reading_annotations a ON a.project_id=x.project_id AND a.id=x.origin_annotation_id
            JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
            JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id CROSS JOIN params p""",
            "x.project_id=p.project_id AND s.state='active' AND " + _LIVE_RECORD + " AND " + _LIVE_CONCEPT,
            **{**_DOCUMENT_FIELDS, "record_id": "c.id", "record_kind": "c.kind"}, concept_id="c.id", annotation_id="a.id",
            revision="x.revision", selected_quote="a.exact", review_state="s.review_state"),
])

SEARCH_SQL = """WITH params AS (SELECT %s::text AS project_id,lower(%s::text) AS query), candidates AS (
""" + _CANDIDATES + """
), matches AS (
    SELECT c.*,CASE WHEN lower(title)=p.query THEN 0 WHEN strpos(lower(title),p.query)=1 THEN 1 ELSE 2 END AS tier
    FROM candidates c CROSS JOIN params p WHERE strpos(lower(c.search_text),p.query)>0
) SELECT * FROM matches ORDER BY tier,kind COLLATE "C",id COLLATE "C",channel COLLATE "C" LIMIT %s"""

_CHANNEL_LABELS = {
    "record_text": "record title or summary", "concept_text": "concept title or scope summary",
    "document_text": "immutable saved document text", "passage_note": "selected quotation or passage note",
    "record_note": "private record note", "notebook_thought": "notebook title or thought body",
    "definition_text": "scoped definition body or scope", "lexicon_spelling": "explicitly linked lexical spelling",
}


def validate_query(project_id, query, limit):
    db._text(project_id, "project id", 500)
    db._text(query, "query", 300)
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("Supply a search limit between 1 and 50")
    return query.strip()


def _result(row, query):
    item = dict(row)
    text, tier = item.pop("search_text"), item.pop("tier")
    position = text.lower().find(query.lower())
    # Keep even a maximum-length literal query visible inside the bounded excerpt.
    context = min(100, (360 - len(query)) // 2)
    start = max(0, position - context)
    end = min(len(text), start + 360)
    item.update(excerpt=text[start:end], excerpt_start=start, excerpt_truncated=start > 0 or end < len(text),
                match_basis=("Exact title; " if tier == 0 else "Title prefix; " if tier == 1 else "") +
                "case-insensitive literal match in " + _CHANNEL_LABELS[item["channel"]])
    return item


def search(connection, project_id, query, limit=30):
    query = validate_query(project_id, query, limit)
    rows = connection.execute(SEARCH_SQL, (project_id, query, limit + 1)).fetchall()
    return dict(items=[_result(row, query) for row in rows[:limit]], truncated=len(rows) > limit,
                query=query, ranking="exact_title_then_title_prefix_then_literal_match",
                method="project_literal_search_v1", excerpt_format="plain_text_not_HTML",
                limitations=["Literal matches, not semantic similarity or scholarly quality",
                             "No spelling expansion, Arabic morphology, or transliteration equivalence",
                             "Bounded results; refine the query when truncated"])


def library(connection, project_id, cursor="", limit=30):
    db._text(project_id, "project id", 500)
    db._text(cursor, "cursor", 500, empty=True)
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("Supply a library limit between 1 and 50")
    rows = connection.execute("""SELECT d.id,d.id AS document_id,d.project_id,r.id AS record_id,r.id AS source_record_id,
        r.title,r.kind,d.edition,d.locator,d.text_sha256,NULL::integer AS revision,r.review_state,
        coalesce(s.reading,'unread') AS reading,coalesce(s.decision,'unreviewed') AS decision,
        coalesce(s.revision,0) AS state_revision
        FROM research.reading_documents d JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        LEFT JOIN research.personal_states s ON s.project_id=r.project_id AND s.record_id=r.id
        WHERE d.project_id=%s AND d.id COLLATE "C">%s COLLATE "C" AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
        ORDER BY d.id COLLATE "C" LIMIT %s""", (project_id, cursor, limit + 1)).fetchall()
    return dict(items=rows[:limit], next_cursor=rows[limit - 1]["id"] if len(rows) > limit else None)
