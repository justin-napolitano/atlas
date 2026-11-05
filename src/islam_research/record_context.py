"""Bounded owner graph neighborhoods; explicit links retain direction and basis."""
from __future__ import annotations

from .graph_engine import registered_policy


def neighborhood(connection, project_id, record_id, cursor="", limit=25):
    """Read active neighbors in one snapshot without inferring semantic links."""
    policy, digest = registered_policy()
    meanings = {row["iri"]: row["meaning"] for row in policy["predicates"]}
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        start = connection.execute("""SELECT * FROM research.records
            WHERE project_id=%s AND id=%s AND deleted_at IS NULL""", (project_id, record_id)).fetchone()
        if start is None:
            return None
        rows = connection.execute("""SELECT e.*,to_jsonb(n) AS node
            FROM research.relations e JOIN research.records n
            ON n.project_id=e.project_id AND n.id=CASE WHEN e.from_id=%s THEN e.to_id ELSE e.from_id END
            WHERE e.project_id=%s AND (e.from_id=%s OR e.to_id=%s)
            AND n.deleted_at IS NULL AND e.id>%s ORDER BY e.id LIMIT %s""",
            (record_id, project_id, record_id, record_id, cursor, limit+1)).fetchall()
        items = []
        for row in rows[:limit]:
            node = row.pop("node")
            items.append({"edge": row, "node": node,
                "direction": "out" if row["from_id"] == record_id else "in",
                "meaning": meanings.get(row["predicate"], "Recorded relationship; inspect its provenance and scope.")})
        return {"project_id": project_id, "record": start, "items": items,
            "next_cursor": rows[limit-1]["id"] if len(rows)>limit else None,
            "policy_sha256": digest,
            "scope": "Explicit active-record neighbors only; connectivity does not establish support or consensus."}
