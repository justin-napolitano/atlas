"""Migration-owner-only rollback rehearsal; refuses to discard library activity."""
from hashlib import sha256
from importlib.resources import files
from psycopg import sql

MIGRATION='0024_shared_library_identity.sql'
TABLES=('library_requests','library_document_bindings','library_project_items','library_source_bindings',
        'library_representations','library_items','library_editions','library_works','library_events')


def rollback(connection,*,apply=False):
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(729117421)')
        owns=connection.execute("SELECT nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owns FROM pg_namespace WHERE nspname='research'").fetchone()
        if not owns or not owns['owns']:raise PermissionError('Use the migration/schema owner, never runtime credentials')
        latest=connection.execute('SELECT name,sha256 FROM research.schema_migrations ORDER BY name DESC LIMIT 1').fetchone()
        if not latest or latest['name']!=MIGRATION:raise ValueError('Rollback requires this exact migration to be latest')
        expected=sha256(files('islam_research').joinpath('migrations/'+MIGRATION).read_bytes()).hexdigest()
        if latest['sha256']!=expected:raise ValueError('Migration artifact changed')
        # Block concurrent runtime writes/indexing while checking the cutover boundary.
        for table in sorted(TABLES):
            connection.execute(sql.SQL('LOCK TABLE research.{} IN ACCESS EXCLUSIVE MODE').format(sql.Identifier(table)))
        used=connection.execute("""SELECT EXISTS(SELECT 1 FROM research.library_requests) OR
            EXISTS(SELECT 1 FROM research.library_items WHERE revision<>1 OR on_shelf OR preferred_edition_id IS NOT NULL OR reading_status<>'needs_review') OR
            EXISTS(SELECT 1 FROM research.library_project_items WHERE revision<>1 OR state<>'legacy') OR
            EXISTS(SELECT 1 FROM research.library_events WHERE revision<>1) AS used""").fetchone()['used']
        if used:raise ValueError('Library activity exists; retain/export it and plan a restore instead of discarding it')
        result=dict(migration=MIGRATION,eligible=True,applied=apply,legacy_rows_unchanged=True)
        if not apply:return result
        # No CASCADE: an unexpected dependency must fail and leave everything intact.
        for table in TABLES:connection.execute(sql.SQL('DROP TABLE research.{}').format(sql.Identifier(table)))
        for signature in ('research.index_library_source(text)','research.library_id(text,jsonb)',
            'research.prepare_library_item()','research.prepare_library_membership()','research.log_library_event()'):
            connection.execute(sql.SQL('DROP FUNCTION {}').format(sql.SQL(signature)))
        connection.execute('DELETE FROM research.schema_migrations WHERE name=%s',(MIGRATION,))
        return result
