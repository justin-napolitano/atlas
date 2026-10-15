"""Per-request bounded PostgreSQL adapter for owner and public API modes."""
from __future__ import annotations

from . import database as db
from .graph_engine import registered_policy, traverse


class PostgreSQLStore:
    """Keep private queries and public projection reads separate."""

    def __init__(self, dsn: str):
        self.dsn = dsn

    def ready(self, mode: str) -> bool:
        with db.connect(self.dsn) as connection:
            if mode == "public":
                # Fail closed if a public runtime was given an owner/superuser DSN.
                row = connection.execute("""SELECT
                    has_schema_privilege(current_user,'research','USAGE') AS private_access,
                    has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
                    has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE') AS can_write
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='research_public' AND c.relname='snapshots'""").fetchone()
                return bool(row and not row["private_access"] and row["can_read"] and not row["can_write"])
            return connection.execute("SELECT to_regclass('research.records') IS NOT NULL AS ready").fetchone()["ready"]

    def projects(self) -> list[dict]:
        with db.connect(self.dsn) as connection:
            return connection.execute("SELECT * FROM research.projects ORDER BY id LIMIT 100").fetchall()

    def create_project(self, **values) -> dict:
        with db.connect(self.dsn) as connection:
            return db.create_project(connection, **values)

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
        if scope not in {"records", "notes", "all"} or not query.strip() or not 1 <= len(query) <= 500 or not 1 <= limit <= 100:
            raise ValueError("Invalid search scope, query, or limit")
        with db.connect(self.dsn) as connection:
            rows = connection.execute("""WITH query AS (
                    SELECT plainto_tsquery('simple', %s) AS terms
                ), candidates AS (
                    SELECT r.id,'record' AS channel,r.revision,
                        ts_rank_cd(setweight(to_tsvector('simple',r.title),'A') ||
                            setweight(to_tsvector('simple',r.summary),'B'),query.terms,32) AS score,
                        ts_headline('simple',r.title || ' ' || r.summary,query.terms,
                            'StartSel="",StopSel="",MaxWords=40,MinWords=10,MaxFragments=2') AS excerpt
                    FROM research.records r CROSS JOIN query
                    WHERE r.project_id=%s AND r.deleted_at IS NULL AND (%s::text IS NULL OR r.kind=%s)
                        AND %s::text IN ('records','all')
                        AND to_tsvector('simple',r.title || ' ' || r.summary) @@ query.terms
                    UNION ALL
                    SELECT r.id,'private_note',p.revision,
                        ts_rank_cd(to_tsvector('simple',p.note),query.terms,32) AS score,
                        ts_headline('simple',p.note,query.terms,
                            'StartSel="",StopSel="",MaxWords=40,MinWords=10,MaxFragments=2') AS excerpt
                    FROM research.personal_states p
                    JOIN research.records r ON r.project_id=p.project_id AND r.id=p.record_id CROSS JOIN query
                    WHERE r.project_id=%s AND r.deleted_at IS NULL AND (%s::text IS NULL OR r.kind=%s)
                        AND %s::text IN ('notes','all') AND to_tsvector('simple',p.note) @@ query.terms
                ), matches AS (
                    SELECT id,max(score) AS score,jsonb_agg(jsonb_build_object(
                        'channel',channel,'revision',revision,'score',score,'excerpt',excerpt) ORDER BY channel) AS matches
                    FROM candidates GROUP BY id
                ) SELECT r.id,r.project_id,r.kind,r.title,r.summary,r.revision,r.review_state,m.score,m.matches
                    FROM matches m JOIN research.records r ON r.id=m.id
                    ORDER BY m.score DESC,r.id LIMIT %s""",
                (query, project_id, kind, kind, scope, project_id, kind, kind, scope, limit+1)).fetchall()
        return {"items": rows[:limit], "truncated": len(rows) > limit, "scope": scope,
                "method": "postgresql_simple_lexical_v1", "query_semantics": "all_tokenized_terms",
                "score_meaning": "Normalized lexical cover-density rank, not quality or calibrated semantic relevance",
                "record_weights": {"title": "A (1.0)", "summary": "B (0.4)"},
                "note_weight": "D (0.1), separate private-note match channel",
                "excerpt_format": "plain_text_treat_as_untrusted_text_never_HTML",
                "limitations": ["No embeddings, synonym expansion, or historical entity disambiguation",
                    "No Arabic morphological analysis or transliteration equivalence",
                    "Top results are bounded; no complete-corpus claim"]}

    def published(self, snapshot_id: str) -> dict | None:
        # Enforce the public connection boundary on data requests, not just readiness.
        if not self.ready("public"):
            raise PermissionError("Public storage identity is not read-only")
        with db.connect(self.dsn) as connection:
            return connection.execute("SELECT id,project_id,payload,published_at FROM research_public.snapshots WHERE id=%s",
                                      (snapshot_id,)).fetchone()
