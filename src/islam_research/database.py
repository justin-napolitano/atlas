"""PostgreSQL migrations and revision-safe private research state.

Transport authentication belongs to the API. This module receives an already
authorized actor and uses a distinct migration connection for schema changes.
It never reads connection configuration or logs SQL payloads implicitly.
"""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class RevisionConflict(Exception):
    """A stale write failed; its current record is available for a conflict UI."""

    def __init__(self, current: dict[str, Any] | None):
        super().__init__("The record changed; reload or resolve the conflicting revision")
        self.current = current


def connect(dsn: str) -> psycopg.Connection:
    """Open a bounded connection; callers must close it and handle transactions."""
    return psycopg.connect(dsn, connect_timeout=10, row_factory=dict_row,
                           options="-c statement_timeout=10000 -c lock_timeout=5000")


def migrate(connection: psycopg.Connection) -> list[str]:
    """Apply immutable, checksummed migrations under one transaction/advisory lock."""
    applied = []
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(729117421)")
        connection.execute("CREATE SCHEMA IF NOT EXISTS research")
        connection.execute("REVOKE ALL ON SCHEMA research FROM PUBLIC")
        connection.execute("""CREATE TABLE IF NOT EXISTS research.schema_migrations (
            name text PRIMARY KEY, sha256 text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
        existing = {row["name"]: row["sha256"] for row in connection.execute(
            "SELECT name, sha256 FROM research.schema_migrations")}
        paths = sorted(files("islam_research").joinpath("migrations").iterdir(), key=lambda p: p.name)
        known = {path.name for path in paths if path.name.endswith(".sql")}
        if set(existing) - known:
            raise ValueError("Database contains migrations unknown to this application")
        for path in paths:
            if not path.name.endswith(".sql"):
                continue
            content = path.read_text(encoding="utf-8")
            digest = hashlib.sha256(content.encode()).hexdigest()
            if path.name in existing:
                if existing[path.name] != digest:
                    raise ValueError(f"Migration checksum changed: {path.name}")
                continue
            connection.execute(content)
            connection.execute("INSERT INTO research.schema_migrations(name, sha256) VALUES (%s,%s)",
                               (path.name, digest))
            applied.append(path.name)
    return applied


def _text(value: str, name: str, limit: int, *, empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()) or "\x00" in value:
        raise ValueError(f"Invalid {name}")
    return value


def create_project(connection: psycopg.Connection, project_id: str, title: str, scope: str = "") -> dict:
    """Create a project with RDF authority retained until explicit migration."""
    with connection.transaction():
        return connection.execute("""INSERT INTO research.projects(id,title,scope)
            VALUES (%s,%s,%s) RETURNING *""", (
            _text(project_id, "project id", 500), _text(title, "title", 2000),
            _text(scope, "scope", 10000, empty=True))).fetchone()


def get_record(connection: psycopg.Connection, record_id: str) -> dict | None:
    """Read private state through an owner connection, never a public reader."""
    return connection.execute("SELECT * FROM research.records WHERE id=%s", (record_id,)).fetchone()


def save_record(connection: psycopg.Connection, *, record_id: str, project_id: str,
                kind: str, title: str, actor: str, expected_revision: int = 0,
                summary: str = "", attributes: dict | None = None) -> dict:
    """Create or compare-and-swap an owner record, preserving every revision.

    Canonical RDF imports are read-only while their project retains RDF authority.
    A stale update raises RevisionConflict with the current record, not a silent overwrite.
    """
    _text(record_id, "record id", 500)
    _text(title, "title", 2000)
    _text(summary, "summary", 50000, empty=True)
    _text(actor, "actor", 500)
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError("Invalid expected revision")
    if attributes is None:
        attributes = {}
    if not isinstance(attributes, dict) or len(json.dumps(attributes, allow_nan=False)) > 100000:
        raise ValueError("Invalid attributes")
    with connection.transaction():
        if expected_revision == 0:
            result = connection.execute("""INSERT INTO research.records
                (id,project_id,kind,title,summary,attributes,changed_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING *""",
                (record_id, project_id, kind, title, summary, Jsonb(attributes), actor)).fetchone()
        else:
            result = connection.execute("""UPDATE research.records SET
                title=%s,summary=%s,attributes=%s,changed_by=%s,revision=revision+1
                WHERE id=%s AND project_id IS NOT DISTINCT FROM %s AND kind=%s AND revision=%s
                AND (origin <> 'canonical_rdf' OR EXISTS (
                    SELECT 1 FROM research.projects p WHERE p.id=project_id AND p.graph_authority='hosted'))
                RETURNING *""", (title, summary, Jsonb(attributes), actor, record_id,
                                 project_id, kind, expected_revision)).fetchone()
        if result is None:
            raise RevisionConflict(get_record(connection, record_id))
        return result


def save_personal_state(connection: psycopg.Connection, *, record_id: str, project_id: str,
                        actor: str, expected_revision: int = 0, reading: str = "unread",
                        decision: str = "unreviewed", note: str = "") -> dict:
    """Save full personal state with optimistic concurrency and server-side read time."""
    _text(actor, "actor", 500)
    _text(note, "note", 10000, empty=True)
    if reading not in {"unread", "reading", "read"}:
        raise ValueError("Invalid reading state")
    if decision not in {"unreviewed", "relevant", "not_relevant", "read_later"}:
        raise ValueError("Invalid screening decision")
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError("Invalid expected revision")
    with connection.transaction():
        if expected_revision == 0:
            row = connection.execute("""INSERT INTO research.personal_states
                (record_id,project_id,reading,read_at,decision,note,changed_by)
                VALUES (%s,%s,%s,CASE WHEN %s='read' THEN clock_timestamp() END,%s,%s,%s)
                ON CONFLICT(record_id) DO NOTHING RETURNING *""",
                (record_id, project_id, reading, reading, decision, note, actor)).fetchone()
        else:
            row = connection.execute("""UPDATE research.personal_states SET
                reading=%s,read_at=CASE WHEN %s='read' THEN COALESCE(read_at,clock_timestamp()) END,
                decision=%s,note=%s,changed_by=%s,revision=revision+1
                WHERE record_id=%s AND project_id=%s AND revision=%s RETURNING *""",
                (reading, reading, decision, note, actor, record_id, project_id, expected_revision)).fetchone()
        if row is None:
            current = connection.execute("SELECT * FROM research.personal_states WHERE record_id=%s",
                                         (record_id,)).fetchone()
            raise RevisionConflict(current)
        return row
