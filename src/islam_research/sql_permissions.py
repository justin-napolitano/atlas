"""Explicit post-migration grants for two existing, unprivileged login roles.

No passwords, role creation, migration ownership, or automatic privilege cleanup.
Run as the schema owner in a dedicated research database, never as a runtime.
"""
from __future__ import annotations

from psycopg import sql


READ_TABLES = (
    "projects", "records", "record_revisions", "relation_types", "relations",
    "personal_states", "personal_state_revisions", "import_snapshots",
    "reading_documents", "reading_annotations", "reading_annotation_revisions",
    "publication_previews", "publication_events",
    "scripture_citations", "scripture_citation_revisions",
)
PUBLIC_TABLES = ("snapshots", "publication_heads")
OWNER_FUNCTIONS = (
    "research.publication_inputs(text,text[],text[])",
    "research.publication_head(text)",
    "research.approve_publication(text,text,integer,text,text,boolean)",
    "research.withdraw_publication(text,integer,text,text)",
)
INSERT_COLUMNS = {
    "projects": "id title scope",
    "records": "id project_id kind title summary attributes changed_by",
    "personal_states": "record_id project_id reading read_at decision note changed_by",
    "reading_documents": "id project_id source_record_id edition locator representation_url text_body input_sha256 text_sha256 normalization content_key changed_by",
    "reading_annotations": "id project_id document_id text_sha256 start_pos end_pos exact prefix suffix capture_kind body changed_by",
    "scripture_citations": "id project_id annotation_id document_id text_sha256 candidate_key parser_version detector_kind match_start match_end matched_text proposal profile_id decision chapter ayah_start ayah_end rationale changed_by",
    "publication_previews": "id project_id record_ids relation_ids inputs payload payload_sha256 created_by",
}
UPDATE_COLUMNS = {
    "records": "title summary attributes changed_by revision",
    "personal_states": "reading read_at decision note changed_by revision",
    "reading_annotations": "body revision changed_by",
    "scripture_citations": "decision chapter ayah_start ayah_end rationale revision changed_by",
}


def grant_plan(owner: str, publisher: str):
    """Identifiers are quoted even when they contain IAM email punctuation."""
    if (not all(isinstance(r, str) and r and len(r.encode()) <= 63 and "\x00" not in r
                for r in (owner, publisher)) or owner == publisher):
        raise ValueError("Supply two distinct existing PostgreSQL login names (at most 63 bytes)")
    statements = []
    for role, schema in ((owner, "research"), (publisher, "research_public")):
        statements.append(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
    for table in READ_TABLES:
        statements.append(sql.SQL("GRANT SELECT ON TABLE research.{} TO {}").format(sql.Identifier(table), sql.Identifier(owner)))
    for table in PUBLIC_TABLES:
        statements.append(sql.SQL("GRANT SELECT ON TABLE research_public.{} TO {}").format(sql.Identifier(table),sql.Identifier(publisher)))
    for function in OWNER_FUNCTIONS:
        # Closed registry of migration-defined signatures; no caller SQL enters it.
        statements.append(sql.SQL("GRANT EXECUTE ON FUNCTION {} TO {}").format(sql.SQL(function),sql.Identifier(owner)))
    for privilege, tables in (("INSERT", INSERT_COLUMNS), ("UPDATE", UPDATE_COLUMNS)):
        for table, columns in tables.items():
            statements.append(sql.SQL("GRANT {} ({}) ON TABLE research.{} TO {}").format(
                sql.SQL(privilege), sql.SQL(", ").join(map(sql.Identifier, columns.split())),
                sql.Identifier(table), sql.Identifier(owner)))
    return statements


def audit(connection, role: str, *, publisher: bool, require_complete: bool = True) -> list[str]:
    """Check effective access, including inherited and column-level privileges.

    Memberships fail closed: Cloud SQL's real IAM role topology must be reviewed
    before live setup. This is a contract for this database, not a cluster audit.
    """
    problems = []
    row = connection.execute("""SELECT oid,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
        rolreplication,rolbypassrls FROM pg_roles WHERE rolname=%s""", (role,)).fetchone()
    if not row:
        return ["login role is missing"]
    if not row["rolcanlogin"] or any(row[k] for k in ("rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls")):
        problems.append("login role has elevated attributes or cannot log in")
    if connection.execute("SELECT 1 FROM pg_auth_members WHERE member=%s LIMIT 1", (row["oid"],)).fetchone():
        problems.append("role memberships require explicit review")
    database = connection.execute("""SELECT has_database_privilege(%s,current_database(),'CREATE') AS ddl,
        datdba=%s AS owns FROM pg_database WHERE datname=current_database()""", (role, row["oid"])).fetchone()
    if database["ddl"] or database["owns"]:
        problems.append("role can create schemas or owns this database")
    expected_schema = "research_public" if publisher else "research"
    schemas = connection.execute("""SELECT oid,nspname,nspowner FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'""").fetchall()
    for schema in schemas:
        name = schema["nspname"]
        privileges = connection.execute("""SELECT has_schema_privilege(%s,%s,'USAGE') AS usage,
            has_schema_privilege(%s,%s,'CREATE') AS ddl""", (role, schema["oid"], role, schema["oid"])).fetchone()
        if privileges["ddl"] or schema["nspowner"] == row["oid"]:
            problems.append(f"unexpected schema ownership/CREATE: {name}")
        if name in {"research", "research_public"}:
            if privileges["usage"] != (name == expected_schema) and (privileges["usage"] or require_complete):
                problems.append(f"schema USAGE mismatch: {name}")
        elif name != "public" and privileges["usage"]:
            problems.append(f"unexpected schema USAGE: {name}")
    tables = connection.execute("""SELECT c.oid,c.relname,c.relowner,n.nspname FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relkind IN ('r','p','v','m','f')""").fetchall()
    found = set()
    for table in tables:
        schema, name, oid = table["nspname"], table["relname"], table["oid"]
        readable = (schema == "research_public" and name in PUBLIC_TABLES) if publisher else (schema == "research" and name in READ_TABLES)
        found.add((schema, name))
        if table["relowner"] == row["oid"]:
            problems.append(f"unexpected table ownership: {schema}.{name}")
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"):
            expected = readable and privilege == "SELECT"
            actual = connection.execute("SELECT has_table_privilege(%s,%s,%s) AS allowed", (role, oid, privilege)).fetchone()["allowed"]
            grantable = connection.execute("SELECT has_table_privilege(%s,%s,%s) AS allowed", (role, oid, privilege + " WITH GRANT OPTION")).fetchone()["allowed"]
            if grantable or actual != expected and (actual or require_complete):
                problems.append(f"table privilege mismatch: {schema}.{name} {privilege}")
        columns = connection.execute("SELECT attname FROM pg_attribute WHERE attrelid=%s AND attnum>0 AND NOT attisdropped", (oid,)).fetchall()
        for column in columns:
            for privilege in ("SELECT", "INSERT", "UPDATE", "REFERENCES"):
                allowed_columns = (INSERT_COLUMNS if privilege == "INSERT" else UPDATE_COLUMNS if privilege == "UPDATE" else {}).get(name, "").split()
                expected = readable and (privilege == "SELECT" or not publisher and column["attname"] in allowed_columns)
                actual = connection.execute("SELECT has_column_privilege(%s,%s,%s,%s) AS allowed", (role, oid, column["attname"], privilege)).fetchone()["allowed"]
                grantable = connection.execute("SELECT has_column_privilege(%s,%s,%s,%s) AS allowed", (role, oid, column["attname"], privilege + " WITH GRANT OPTION")).fetchone()["allowed"]
                if grantable or actual != expected and (actual or require_complete):
                    problems.append(f"column privilege mismatch: {schema}.{name}.{column['attname']} {privilege}")
    required = {("research_public", t) for t in PUBLIC_TABLES} if publisher else {("research", t) for t in READ_TABLES}
    if not required <= found:
        problems.append("required migrated tables are missing")
    allowed_functions = set() if publisher else {connection.execute("SELECT to_regprocedure(%s)::oid AS oid",(name,)).fetchone()["oid"] for name in OWNER_FUNCTIONS}
    if None in allowed_functions:
        problems.append("required publication functions are missing")
    functions = connection.execute("""SELECT p.oid,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('research','research_public')""").fetchall()
    for function in functions:
        actual = connection.execute("SELECT has_function_privilege(%s,%s,'EXECUTE') AS allowed", (role, function["oid"])).fetchone()["allowed"]
        grantable = connection.execute("SELECT has_function_privilege(%s,%s,'EXECUTE WITH GRANT OPTION') AS allowed", (role, function["oid"])).fetchone()["allowed"]
        expected = function["oid"] in allowed_functions
        if function["proowner"] == row["oid"] or grantable or actual!=expected and (actual or require_complete):
            problems.append("unexpected application function ownership/EXECUTE")
    return problems


def configure(connection, owner: str, publisher: str, *, apply: bool = False) -> list[str]:
    statements = grant_plan(owner, publisher)
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(184510, 2)")
        for role, is_publisher in ((owner, False), (publisher, True)):
            problems = audit(connection, role, publisher=is_publisher, require_complete=False)
            if problems:
                raise ValueError("Unsafe existing runtime role: " + "; ".join(problems))
        if apply:
            for statement in statements:
                connection.execute(statement)
            for role, is_publisher in ((owner, False), (publisher, True)):
                problems = audit(connection, role, publisher=is_publisher)
                if problems:
                    raise ValueError("Runtime grant verification failed: " + "; ".join(problems))
    return [statement.as_string(connection) for statement in statements]
