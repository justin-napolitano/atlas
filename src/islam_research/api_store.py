"""Per-request bounded PostgreSQL adapter for owner and public API modes."""
from __future__ import annotations

from . import database as db
from .graph_engine import registered_policy, traverse
from . import passage_store
from . import publication
from . import citation_store
from . import lexicon_store
from . import verse_store
from . import source_intake
from . import reading_desk
from . import record_context
from . import notebook
from . import notebook_drafts
from . import private_trash
from . import reading_drafts
from . import collection_link
from . import research_search
from . import quran_workspace


class PostgreSQLStore:
    """Keep private queries and public projection reads separate."""

    def quran_binding(self, **values):
        with db.connect(self.dsn) as connection:return quran_workspace.binding(connection,**values)

    def quran_existing(self, **values):
        with db.connect(self.dsn) as connection:return quran_workspace.existing(connection,**values)

    def quran_note(self, **values):
        with db.connect(self.dsn) as connection:return quran_workspace.create_note(connection,**values)

    def quran_notes(self, **values):
        with db.connect(self.dsn) as connection:return quran_workspace.notes(connection,**values)

    def quran_place(self, project_id):
        with db.connect(self.dsn) as connection:return quran_workspace.place(connection,project_id)

    def save_quran_place(self, **values):
        with db.connect(self.dsn) as connection:return quran_workspace.save_place(connection,**values)

    def research_search(self, project_id, query, limit):
        with db.connect(self.dsn) as connection:
            return research_search.search(connection,project_id,query,limit)

    def reading_library(self, project_id, cursor, limit):
        with db.connect(self.dsn) as connection:
            return research_search.library(connection,project_id,cursor,limit)

    def link_collection_reading(self,**values):
        with db.connect(self.dsn) as connection:return collection_link.link(connection,**values)

    def record_context(self, project_id, record_id, cursor, limit):
        with db.connect(self.dsn) as connection:
            return record_context.neighborhood(connection,project_id,record_id,cursor,limit)

    def __init__(self, dsn: str):
        self.dsn = dsn

    def ready(self, mode: str) -> bool:
        with db.connect(self.dsn) as connection:
            if mode == "public":
                # Fail closed if a public runtime was given an owner/superuser DSN.
                row = connection.execute("""SELECT
                    has_schema_privilege(current_user,'research','USAGE') AS private_access,
                    has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
                    (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE')
                     OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')
                     OR has_schema_privilege(current_user,'research_public','CREATE')
                     OR has_table_privilege(current_user,h.oid,'INSERT,UPDATE,DELETE')
                     OR has_any_column_privilege(current_user,h.oid,'INSERT,UPDATE')) AS can_write,
                    has_table_privilege(current_user,h.oid,'SELECT') AS can_read_head
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    JOIN pg_class h ON h.relnamespace=n.oid AND h.relname='publication_heads'
                    WHERE n.nspname='research_public' AND c.relname='snapshots'""").fetchone()
                return bool(row and not row["private_access"] and row["can_read"] and row["can_read_head"] and not row["can_write"])
            return connection.execute("SELECT to_regclass('research.records') IS NOT NULL AS ready").fetchone()["ready"]

    def projects(self) -> list[dict]:
        with db.connect(self.dsn) as connection:
            return connection.execute("SELECT * FROM research.projects ORDER BY id LIMIT 100").fetchall()

    def create_project(self, **values) -> dict:
        with db.connect(self.dsn) as connection:
            return db.create_project(connection, **values)

    def reading_draft(self,project_id,draft_id):
        with db.connect(self.dsn) as connection: return reading_drafts.get(connection,project_id,draft_id)

    def save_reading_draft(self,**values):
        with db.connect(self.dsn) as connection: return reading_drafts.save(connection,**values)

    def reading_drafts(self,**values):
        with db.connect(self.dsn) as connection: return reading_drafts.listing(connection,**values)

    def reading_draft_history(self,project_id,draft_id,before_revision,limit):
        with db.connect(self.dsn) as connection: return reading_drafts.history(connection,project_id,draft_id,before_revision,limit)

    def reading_desk(self,project_id):
        with db.connect(self.dsn) as connection: return reading_desk.get(connection,project_id)

    def save_reading_desk(self,**values):
        with db.connect(self.dsn) as connection: return reading_desk.save(connection,**values)

    def reading_desk_history(self,project_id,before_revision,limit):
        with db.connect(self.dsn) as connection: return reading_desk.history(connection,project_id,before_revision,limit)

    def notebook_items(self,**values):
        with db.connect(self.dsn) as connection:return notebook.items(connection,**values)

    def notebook_entry(self,project_id,entry_id):
        with db.connect(self.dsn) as connection:return notebook.get(connection,project_id,entry_id)

    def notebook_draft(self,project_id,draft_id):
        with db.connect(self.dsn) as connection:return notebook_drafts.get(connection,project_id,draft_id)

    def private_trash(self,project_id,cursor,limit):
        with db.connect(self.dsn) as connection:return private_trash.listing(connection,project_id,cursor,limit)

    def change_private_trash(self,**values):
        with db.connect(self.dsn) as connection:return private_trash.change(connection,**values)

    def notebook_drafts(self,project_id,cursor,limit):
        with db.connect(self.dsn) as connection:return notebook_drafts.listing(connection,project_id,cursor,limit)

    def save_notebook_draft(self,**values):
        with db.connect(self.dsn) as connection:return notebook_drafts.save(connection,**values)

    def notebook_network(self,project_id,limit):
        with db.connect(self.dsn) as connection:return notebook.network(connection,project_id,limit)

    def notebook_create(self,**values):
        with db.connect(self.dsn) as connection:return notebook.create(connection,**values)

    def notebook_update(self,**values):
        with db.connect(self.dsn) as connection:return notebook.update(connection,**values)

    def notebook_history(self,**values):
        with db.connect(self.dsn) as connection:return notebook.history(connection,**values)

    def records(self, project_id: str, kind: str | None, cursor: str, limit: int) -> list[dict]:
        with db.connect(self.dsn) as connection:
            return connection.execute("""SELECT * FROM research.records
                WHERE project_id=%s AND (%s::text IS NULL OR kind=%s) AND id>%s AND deleted_at IS NULL
                ORDER BY id LIMIT %s""", (project_id, kind, kind, cursor, limit)).fetchall()

    def record(self, record_id: str) -> dict | None:
        with db.connect(self.dsn) as connection:
            return db.get_record(connection, record_id)

    def save_record(self, **values) -> dict:
        with db.connect(self.dsn) as connection:
            return db.save_record(connection, **values)

    def source_intake(self, **values) -> dict:
        with db.connect(self.dsn) as connection:
            return source_intake.create(connection, **values)

    def source_candidates(self, project_id, source_url, identifier, limit):
        with db.connect(self.dsn) as connection:
            return source_intake.candidates(connection,project_id,source_url,identifier,limit)

    def source_intake_history(self, project_id, source_record_id, cursor, limit):
        with db.connect(self.dsn) as connection:
            return source_intake.history(connection,project_id,source_record_id,cursor,limit)

    def states(self, project_id: str, cursor: str, limit: int) -> list[dict]:
        with db.connect(self.dsn) as connection:
            return connection.execute("""SELECT * FROM research.personal_states
                WHERE project_id=%s AND record_id>%s ORDER BY record_id LIMIT %s""",
                (project_id, cursor, limit)).fetchall()

    def save_state(self, **values) -> dict:
        with db.connect(self.dsn) as connection:
            return db.save_personal_state(connection, **values)

    def state(self, project_id: str, record_id: str) -> dict | None:
        with db.connect(self.dsn) as connection:
            return connection.execute("SELECT * FROM research.personal_states WHERE project_id=%s AND record_id=%s",
                                      (project_id, record_id)).fetchone()

    def evidence_path(self, project_id: str, record_id: str, profile_id: str) -> dict | None:
        policy, _ = registered_policy()
        if profile_id not in {p["id"] for p in policy["traversal_profiles"]}:
            raise ValueError("Unknown registered path")
        with db.connect(self.dsn) as connection:
            # One coherent graph view even if another session updates records.
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            start = connection.execute("""SELECT * FROM research.records
                WHERE project_id=%s AND id=%s AND deleted_at IS NULL""", (project_id, record_id)).fetchone()
            if start is None:
                return None
            def adjacent(frontier, step, predicate, limit):
                # Direction chooses one of two fixed query fragments, never caller SQL.
                match = "e.from_id" if step["direction"] == "out" else "e.to_id"
                return connection.execute("""SELECT e.*,to_jsonb(s) AS source,to_jsonb(t) AS target
                    FROM research.relations e
                    JOIN research.records s ON s.project_id=e.project_id AND s.id=e.from_id
                    JOIN research.records t ON t.project_id=e.project_id AND t.id=e.to_id
                    WHERE e.project_id=%s AND e.predicate=%s AND """ + match + """=ANY(%s)
                    AND s.deleted_at IS NULL AND t.deleted_at IS NULL
                    AND s.kind=ANY(%s) AND t.kind=ANY(%s)
                    ORDER BY e.id LIMIT %s""", (project_id, step["predicate"], frontier,
                    predicate["from_kinds"], predicate["to_kinds"], limit)).fetchall()
            return traverse(start, project_id, profile_id, adjacent)

    def search(self, project_id: str, query: str, scope: str, kind: str | None, limit: int) -> dict:
        """Bounded lexical search; private notes are a separately selected channel."""
        if scope not in {"records", "notes", "annotations", "all"} or not query.strip() or not 1 <= len(query) <= 500 or not 1 <= limit <= 100:
            raise ValueError("Invalid search scope, query, or limit")
        with db.connect(self.dsn) as connection:
            rows = connection.execute("""WITH query AS (
                    SELECT plainto_tsquery('simple', %s) AS terms
                ), candidates AS (
                    SELECT r.id,'record' AS channel,r.revision,
                        ts_rank_cd(setweight(to_tsvector('simple',r.title),'A') ||
                            setweight(to_tsvector('simple',r.summary),'B'),query.terms,32) AS score,
                        ts_headline('simple',r.title || ' ' || r.summary,query.terms,
                            'StartSel="",StopSel="",MaxWords=40,MinWords=10,MaxFragments=2') AS excerpt,
                        r.id AS target_id,NULL::text AS document_id,NULL::text AS capture_kind
                    FROM research.records r CROSS JOIN query
                    WHERE r.project_id=%s AND r.deleted_at IS NULL AND (%s::text IS NULL OR r.kind=%s)
                        AND %s::text IN ('records','all')
                        AND to_tsvector('simple',r.title || ' ' || r.summary) @@ query.terms
                    UNION ALL
                    SELECT r.id,'private_note',p.revision,
                        ts_rank_cd(to_tsvector('simple',p.note),query.terms,32) AS score,
                        ts_headline('simple',p.note,query.terms,
                            'StartSel="",StopSel="",MaxWords=40,MinWords=10,MaxFragments=2') AS excerpt,
                        r.id,NULL::text,NULL::text
                    FROM research.personal_states p
                    JOIN research.records r ON r.project_id=p.project_id AND r.id=p.record_id CROSS JOIN query
                    WHERE r.project_id=%s AND r.deleted_at IS NULL AND (%s::text IS NULL OR r.kind=%s)
                        AND %s::text IN ('notes','all') AND to_tsvector('simple',p.note) @@ query.terms
                    UNION ALL
                    SELECT r.id,'private_annotation',a.revision,
                        ts_rank_cd(to_tsvector('simple',a.exact || ' ' || a.body),query.terms,32),
                        ts_headline('simple',a.exact || ' — ' || a.body,query.terms,
                            'StartSel="",StopSel="",MaxWords=40,MinWords=10,MaxFragments=2'),
                        a.id,a.document_id,a.capture_kind
                    FROM research.reading_annotations a
                    JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
                    JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id CROSS JOIN query
                    WHERE r.project_id=%s AND r.deleted_at IS NULL AND (%s::text IS NULL OR r.kind=%s)
                        AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=a.project_id AND t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed') AND %s::text IN ('annotations','all')
                        AND to_tsvector('simple',a.exact || ' ' || a.body) @@ query.terms
                ), bounded AS (
                    SELECT *,row_number() OVER(PARTITION BY id,channel ORDER BY score DESC,target_id) AS match_number
                    FROM candidates
                ), matches AS (
                    SELECT id,max(score) AS score,bool_or(match_number>5) AS matches_truncated,
                        jsonb_agg(jsonb_build_object('channel',channel,'revision',revision,'score',score,'excerpt',excerpt,
                            'target_id',target_id,'document_id',document_id,'capture_kind',capture_kind,
                            'review_state',CASE WHEN channel='private_annotation' THEN 'captured_unreviewed' ELSE NULL END)
                            ORDER BY channel,score DESC,target_id) FILTER(WHERE match_number<=5) AS matches
                    FROM bounded GROUP BY id
                ) SELECT r.id,r.project_id,r.kind,r.title,left(r.summary,2000) AS summary,
                    length(r.summary)>2000 AS summary_truncated,r.revision,r.review_state,m.score,m.matches,m.matches_truncated
                    FROM matches m JOIN research.records r ON r.id=m.id
                    ORDER BY m.score DESC,r.id LIMIT %s""",
                (query, project_id, kind, kind, scope, project_id, kind, kind, scope,
                 project_id,kind,kind,scope,limit+1)).fetchall()
        return {"items": rows[:limit], "truncated": len(rows) > limit, "scope": scope,
                "method": "postgresql_simple_lexical_v1", "query_semantics": "all_tokenized_terms",
                "score_meaning": "Normalized lexical cover-density rank, not quality or calibrated semantic relevance",
                "record_weights": {"title": "A (1.0)", "summary": "B (0.4)"},
                "note_weight": "D (0.1), separate private-note match channel",
                "annotation_weight": "D (0.1), selected text and private comment; captured, unreviewed",
                "max_matches_per_channel": 5,
                "excerpt_format": "plain_text_treat_as_untrusted_text_never_HTML",
                "limitations": ["No embeddings, synonym expansion, or historical entity disambiguation",
                    "No Arabic morphological analysis or transliteration equivalence",
                    "Top results are bounded; no complete-corpus claim"]}

    def published(self, snapshot_id: str) -> dict | None:
        # Enforce the public connection boundary on data requests, not just readiness.
        if not self.ready("public"):
            raise PermissionError("Public storage identity is not read-only")
        with db.connect(self.dsn) as connection:
            return connection.execute("""SELECT s.id,s.project_id,s.payload,s.published_at FROM research_public.snapshots s
                JOIN research_public.publication_heads h ON h.project_id=s.project_id AND h.snapshot_id=s.id
                WHERE s.id=%s AND h.status='published'""",
                                      (snapshot_id,)).fetchone()

    def publication_head(self, project_id):
        with db.connect(self.dsn) as connection:
            return publication.head(connection,project_id)

    def publication_preview(self, **values):
        with db.connect(self.dsn) as connection:
            return publication.preview(connection,**values)

    def publication_relations(self, project_id, record_ids):
        if len(set(record_ids))!=len(record_ids):
            raise ValueError("Duplicate publication selection")
        with db.connect(self.dsn) as connection:
            rows=connection.execute("""SELECT e.id,e.from_id,e.to_id,e.predicate,e.review_state,
                s.title AS source_title,t.title AS target_title FROM research.relations e
                JOIN research.records s ON s.project_id=e.project_id AND s.id=e.from_id
                JOIN research.records t ON t.project_id=e.project_id AND t.id=e.to_id
                WHERE e.project_id=%s AND e.from_id=ANY(%s) AND e.to_id=ANY(%s)
                AND s.deleted_at IS NULL AND t.deleted_at IS NULL
                AND s.review_state<>'withdrawn' AND t.review_state<>'withdrawn' AND e.review_state<>'withdrawn'
                AND s.kind=ANY(%s) AND t.kind=ANY(%s)
                ORDER BY e.id LIMIT 301""",(project_id,record_ids,record_ids,sorted(publication.PUBLIC_KINDS),sorted(publication.PUBLIC_KINDS))).fetchall()
            return {"items":rows[:300],"truncated":len(rows)>300}

    def publication_approve(self, **values):
        with db.connect(self.dsn) as connection:
            return publication.approve(connection,**values)

    def publication_withdraw(self, **values):
        with db.connect(self.dsn) as connection:
            return publication.withdraw(connection,**values)

    def publication_preview_by_id(self, project_id, preview_id):
        with db.connect(self.dsn) as connection:
            return connection.execute("""SELECT id,project_id,payload,payload_sha256,created_at
                FROM research.publication_previews WHERE project_id=%s AND id=%s""",(project_id,preview_id)).fetchone()

    def reading_documents(self, project_id, source_record_id, cursor, limit):
        with db.connect(self.dsn) as connection:
            return passage_store.documents(connection,project_id,source_record_id,cursor,limit)

    def reading_document(self, project_id, document_id):
        with db.connect(self.dsn) as connection:
            return passage_store.get_document(connection,project_id,document_id)

    def create_reading_document(self, **values):
        with db.connect(self.dsn) as connection:
            return passage_store.create_document(connection,**values)

    def reading_annotations(self, project_id, document_id, cursor, limit):
        with db.connect(self.dsn) as connection:
            return passage_store.annotations(connection,project_id,document_id,cursor,limit)

    def reading_annotation(self, project_id, annotation_id):
        with db.connect(self.dsn) as connection:
            value = passage_store.annotation(connection,project_id,annotation_id)
            if value is not None:
                trash=private_trash.get(connection,project_id,'annotation',annotation_id)
                value['annotation']['trashed']=bool(trash and trash['state']=='trashed')
                value['annotation']['trash_revision']=trash['revision'] if trash else 0
                rows = citation_store.candidates(connection,project_id,annotation_id)["resolutions"]
                value["web_annotation"]["ir:scriptureReferences"] = [citation_store.export_resolution(row) for row in rows]
            return value

    def create_reading_annotation(self, **values):
        with db.connect(self.dsn) as connection:
            return passage_store.create_annotation(connection,**values)

    def update_reading_annotation(self, **values):
        with db.connect(self.dsn) as connection:
            return passage_store.update_annotation(connection,**values)

    def scripture_candidates(self, project_id, annotation_id):
        with db.connect(self.dsn) as connection:
            return citation_store.candidates(connection,project_id,annotation_id)

    def resolve_scripture_citation(self, **values):
        with db.connect(self.dsn) as connection:
            return citation_store.resolve(connection,**values)

    def scripture_citations(self, project_id, chapter, ayah_start, ayah_end, cursor, limit):
        with db.connect(self.dsn) as connection:
            return citation_store.for_verse(connection,project_id,chapter,ayah_start,ayah_end,cursor,limit)

    def verse_create(self, **values):
        with db.connect(self.dsn) as connection: return verse_store.create(connection,**values)

    def verse_import_pilot(self, **values):
        with db.connect(self.dsn) as connection: return verse_store.import_pilot(connection,**values)

    def verse_update(self, **values):
        with db.connect(self.dsn) as connection: return verse_store.update(connection,**values)

    def verse_material(self, project_id, material_id):
        with db.connect(self.dsn) as connection: return verse_store.get_material(connection,project_id,material_id)

    def verse_materials(self, project_id, chapter, ayah_start, ayah_end, material_kind, link_kind, cursor, limit):
        with db.connect(self.dsn) as connection: return verse_store.for_verse(connection,project_id,chapter,ayah_start,ayah_end,material_kind,link_kind,cursor,limit)

    def verse_annotation_links(self, project_id, annotation_id, cursor, limit):
        with db.connect(self.dsn) as connection: return verse_store.annotation_links(connection,project_id,annotation_id,cursor,limit)

    def verse_history(self, project_id, material_id, before_revision, limit):
        with db.connect(self.dsn) as connection: return verse_store.history(connection,project_id,material_id,before_revision,limit)

    def lexicon_capture(self, **values):
        with db.connect(self.dsn) as connection: return lexicon_store.capture(connection,**values)

    def lexicon_create_representation(self, **values):
        with db.connect(self.dsn) as connection: return lexicon_store.create_representation(connection,**values)

    def lexicon_create_definition(self, **values):
        with db.connect(self.dsn) as connection: return lexicon_store.create_definition(connection,**values)

    def lexicon_update_definition(self, **values):
        with db.connect(self.dsn) as connection: return lexicon_store.update_definition(connection,**values)

    def lexicon_update_connection(self, **values):
        with db.connect(self.dsn) as connection: return lexicon_store.update_connection(connection,**values)

    def lexicon_concept(self, project_id, concept_id):
        with db.connect(self.dsn) as connection: return lexicon_store.get_concept(connection,project_id,concept_id)

    def lexicon_senses(self, project_id, concept_id, cursor, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.senses(connection,project_id,concept_id,cursor,limit)

    def lexicon_representations(self, project_id, entry_id, cursor, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.representations(connection,project_id,entry_id,cursor,limit)

    def lexicon_definitions(self, project_id, concept_id, cursor, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.definitions(connection,project_id,concept_id,cursor,limit)

    def lexicon_occurrences(self, project_id, concept_id, cursor, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.occurrences(connection,project_id,concept_id,cursor,limit)

    def lexicon_search(self, project_id, query, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.search(connection,project_id,query,limit)

    def lexicon_entity(self, project_id, entity_kind, entity_id):
        with db.connect(self.dsn) as connection: return lexicon_store.get_entity(connection,project_id,entity_kind,entity_id)

    def lexicon_history(self, project_id, entity_kind, entity_id, before_revision, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.history(connection,project_id,entity_kind,entity_id,before_revision,limit)

    def lexicon_annotation_links(self, project_id, annotation_id, cursor, limit):
        with db.connect(self.dsn) as connection: return lexicon_store.annotation_links(connection,project_id,annotation_id,cursor,limit)
