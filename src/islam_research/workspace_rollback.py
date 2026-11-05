"""Migration-owner rollback gate for the additive native-workspace foundation."""
from hashlib import sha256
from importlib.resources import files
from psycopg import sql

MIGRATION='0025_owner_workspace.sql'
CORE=('records','reading_documents','reading_annotations','notebook_entries','notebook_drafts')


def rollback(connection,*,apply=False):
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(729117421)')
        owns=connection.execute("SELECT nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owns FROM pg_namespace WHERE nspname='research'").fetchone()
        if not owns or not owns['owns']:raise PermissionError('Migration/schema owner required')
        latest=connection.execute('SELECT name,sha256 FROM research.schema_migrations ORDER BY name DESC LIMIT 1').fetchone()
        artifact=files('islam_research').joinpath('migrations/'+MIGRATION).read_bytes()
        if not latest or latest['name']!=MIGRATION or latest['sha256']!=sha256(artifact).hexdigest():raise ValueError('Exact latest migration artifact required')
        for table in (*CORE,'notebook_revisions','workspace_note_trash','workspace_note_trash_history'):
            connection.execute(sql.SQL('LOCK TABLE research.{} IN ACCESS EXCLUSIVE MODE').format(sql.Identifier(table)))
        for table in CORE:
            if connection.execute(sql.SQL('SELECT 1 FROM research.{} WHERE project_id IS NULL LIMIT 1').format(sql.Identifier(table))).fetchone():raise ValueError('Native workspace activity exists; plan an export/restore instead')
        if connection.execute("SELECT 1 FROM research.notebook_entries WHERE title_mode<>'manual' OR thought_type IN ('decision','principle','skill') LIMIT 1").fetchone():raise ValueError('New workspace metadata exists; plan an export/restore instead')
        if connection.execute('SELECT 1 FROM research.workspace_note_trash LIMIT 1').fetchone():raise ValueError('Native tombstone activity exists')
        result=dict(migration=MIGRATION,eligible=True,applied=apply)
        if not apply:return result
        for table in CORE:
            connection.execute(sql.SQL('DROP TRIGGER workspace_origin_guard ON research.{}').format(sql.Identifier(table)))
        connection.execute('DROP TRIGGER workspace_native_trash_guard ON research.notebook_entries')
        connection.execute('DROP TABLE research.workspace_note_trash_history,research.workspace_note_trash')
        for name in ('guard_workspace_origin','prepare_workspace_trash','log_workspace_trash','guard_native_trashed_note'):
            connection.execute(sql.SQL('DROP FUNCTION research.{}()').format(sql.Identifier(name)))
        for table in CORE:
            connection.execute(sql.SQL('ALTER TABLE research.{} DROP COLUMN workspace_id').format(sql.Identifier(table)))
            connection.execute(sql.SQL('ALTER TABLE research.{} ALTER COLUMN project_id SET NOT NULL').format(sql.Identifier(table)))
        connection.execute('ALTER TABLE research.notebook_revisions ALTER COLUMN project_id SET NOT NULL')
        connection.execute('ALTER TABLE research.notebook_entries DROP COLUMN title_mode')
        connection.execute('ALTER TABLE research.notebook_entries DROP CONSTRAINT notebook_entries_thought_type_check')
        connection.execute("ALTER TABLE research.notebook_entries ADD CONSTRAINT notebook_entries_thought_type_check CHECK(thought_type IN ('note','question','source_claim','interpretation','objection'))")
        # Resource SQL is the immutable prior implementation, not caller-supplied DDL.
        prior=files('islam_research').joinpath('migrations/0019_free_margin_writing.sql').read_text()
        connection.execute(prior[prior.index('CREATE OR REPLACE FUNCTION'):])
        pub=files('islam_research').joinpath('migrations/0005_publication_approval.sql').read_text()
        start=pub.index('CREATE FUNCTION research.publication_inputs(');end=pub.index('CREATE FUNCTION research.publication_head(',start)
        connection.execute(pub[start:end].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1))
        connection.execute('DROP INDEX research.workspace_documents_content')
        connection.execute('DROP INDEX research.workspace_notes_text')
        connection.execute('DROP TABLE research.owner_workspaces')
        connection.execute('DELETE FROM research.schema_migrations WHERE name=%s',(MIGRATION,))
        return result
