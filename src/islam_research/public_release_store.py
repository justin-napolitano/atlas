"""Capture approved public heads using a SELECT-only publisher login.

The shared transaction lock coordinates with migration 0006. READ COMMITTED is
intentional: the head query gets a fresh snapshot *after* acquiring that lock.
No private tables or application SECURITY DEFINER functions are read here.
"""
from __future__ import annotations

from .database import connect
from .sql_permissions import audit
from .public_release import ActivationUncertain, MAX_PAYLOAD_BYTES, MAX_PROJECTS, make_bundle, write_bundle


def approved_rows(connection):
    role = connection.execute("SELECT current_user AS name").fetchone()["name"]
    if audit(connection, role, publisher=True):
        raise ValueError("Publisher login does not satisfy the restricted SQL contract")
    guard = connection.execute("""SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid='research_public.publication_heads'::regclass
        AND t.tgname='public_head_export_guard' AND t.tgenabled='O'
        AND NOT t.tgisinternal""").fetchone()
    if not guard:
        raise ValueError("Publication export guard migration is required")
    connection.execute("SELECT pg_advisory_xact_lock_shared(184512,1)")
    # A named cursor bounds transfer to one payload at a time. The SQL byte limit
    # prevents an unexpectedly large value from reaching Python in the first place.
    with connection.cursor(name="approved_release_heads") as cursor:
        cursor.execute("""SELECT h.project_id,h.revision,h.status,h.snapshot_id,
            h.changed_at::text,s.published_at::text,
            CASE WHEN octet_length(s.payload::text)<=%s THEN s.payload::text END AS payload_text,
            encode(sha256(convert_to(s.payload::text,'UTF8')),'hex') AS payload_sha256,
            s.project_id AS snapshot_project_id
            FROM research_public.publication_heads h
            LEFT JOIN research_public.snapshots s ON h.status='published' AND s.id=h.snapshot_id
            ORDER BY h.project_id LIMIT %s""", (MAX_PAYLOAD_BYTES, MAX_PROJECTS+1))
        for row in cursor:
            if row["status"] == "published" and row["snapshot_project_id"] != row["project_id"]:
                raise ValueError("Publication snapshot belongs to a different project")
            yield row


def export_approved(dsn, root, semantic_root):
    """Activate a bounded local bundle while publication heads cannot change.

Filesystem activation and database transaction completion are separate commit
points. An acknowledgement/connection failure after activation is uncertain,
never reported as a guarantee that the old pointer survived.
"""
    activated = False
    try:
        with connect(dsn) as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY")
                identifier, files = make_bundle(approved_rows(connection), semantic_root)
                # write_bundle's atomic pointer replacement is its final operation.
                # Conservatively classify any filesystem write failure as uncertain;
                # callers can inspect current.json using the offline verifier.
                try:
                    directory = write_bundle(root, identifier, files)
                except OSError:
                    raise ActivationUncertain("Verify the current release before retrying") from None
                activated = True
        return directory, identifier
    except ActivationUncertain:
        raise
    except Exception:
        if activated:
            raise ActivationUncertain("Verify the current release before retrying") from None
        raise
