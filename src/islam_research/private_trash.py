"""Reversible visibility for personal writing; target content/history is preserved."""
from psycopg import sql
from . import database as db

TARGETS = {'entry': ('notebook_entries', 'id'), 'annotation': ('reading_annotations', 'id')}


def target(connection, project_id, kind, target_id):
    if kind not in TARGETS:
        raise ValueError('Only notebook thoughts and margin writing can be trashed')
    table, column = TARGETS[kind]
    return connection.execute(sql.SQL('SELECT * FROM research.{} WHERE project_id IS NOT DISTINCT FROM %s AND {}=%s FOR UPDATE').format(
        sql.Identifier(table), sql.Identifier(column)), (project_id, target_id)).fetchone()


def get(connection, project_id, kind, target_id):
    if project_id is None:
        table,column=('workspace_note_trash','entry_id') if kind=='entry' else ('workspace_annotation_trash','annotation_id')
        return connection.execute(sql.SQL('SELECT *,NULL::text AS project_id FROM research.{} WHERE {}=%s').format(sql.Identifier(table),sql.Identifier(column)),(target_id,)).fetchone()
    return connection.execute('SELECT * FROM research.note_trash WHERE project_id=%s AND target_kind=%s AND target_id=%s',
                              (project_id, kind, target_id)).fetchone()


def assert_active(connection, project_id, kind, target_id):
    # All edit/trash/restore paths lock the same target first, closing the race
    # where a late editor could update an item concurrently with trashing it.
    target(connection, project_id, kind, target_id)
    if project_id is None and kind=='entry':
        current=connection.execute("SELECT state FROM research.workspace_note_trash WHERE entry_id=%s",(target_id,)).fetchone()
        if current and current['state']=='trashed':raise ValueError('Restore this writing before editing')
    current = get(connection, project_id, kind, target_id)
    if current and current['state'] == 'trashed':
        raise ValueError('This writing is in Trash. Restore it before editing.')


def change(connection, *, project_id, target_kind, target_id, target_revision, expected_revision, state, actor):
    db._text(actor, 'actor', 500)
    if state not in {'trashed', 'active'} or type(expected_revision) is not int or expected_revision < 0 or type(target_revision) is not int or target_revision < 1:
        raise ValueError('Supply confirmed writing and trash revisions')
    with connection.transaction():
        writing = target(connection, project_id, target_kind, target_id)
        if not writing:
            raise ValueError('Writing not found in this project')
        if writing['revision'] != target_revision:
            raise db.RevisionConflict(writing)
        current = get(connection, project_id, target_kind, target_id)
        if current and current['revision'] == expected_revision + 1 and current['state'] == state and current['target_revision'] == target_revision and current['changed_by'] == actor:
            return current
        if (current['revision'] if current else 0) != expected_revision:
            raise db.RevisionConflict(current)
        if project_id is None:
            if target_kind=='entry':
                from .workspace_store import trash
                return trash(connection,entry_id=target_id,target_revision=target_revision,expected_revision=expected_revision,state=state,actor=actor)
            if current:
                return connection.execute('UPDATE research.workspace_annotation_trash SET state=%s,target_revision=%s,changed_by=%s,revision=revision+1 WHERE annotation_id=%s RETURNING *',(state,target_revision,actor,target_id)).fetchone()
            return connection.execute('INSERT INTO research.workspace_annotation_trash(annotation_id,target_revision,state,changed_by) VALUES(%s,%s,%s,%s) RETURNING *',(target_id,target_revision,state,actor)).fetchone()
        if current:
            return connection.execute('''UPDATE research.note_trash SET state=%s,target_revision=%s,
                changed_by=%s,revision=revision+1 WHERE project_id=%s AND target_kind=%s AND target_id=%s RETURNING *''',
                (state, target_revision, actor, project_id, target_kind, target_id)).fetchone()
        return connection.execute('''INSERT INTO research.note_trash(project_id,target_kind,target_id,target_revision,state,changed_by)
            VALUES(%s,%s,%s,%s,%s,%s) RETURNING *''', (project_id, target_kind, target_id, target_revision, state, actor)).fetchone()


def listing(connection, project_id, cursor='', limit=26):
    return connection.execute('''SELECT t.*,coalesce(n.title,'Margin note') AS title,
        coalesce(n.body,a.body) AS body,coalesce(n.record_id,d.source_record_id) AS record_id,
        coalesce(n.document_id,a.document_id) AS document_id,
        coalesce(n.annotation_id,a.id) AS annotation_id
        FROM research.note_trash t
        LEFT JOIN research.notebook_entries n ON t.target_kind='entry' AND n.project_id=t.project_id AND n.id=t.target_id
        LEFT JOIN research.reading_annotations a ON t.target_kind='annotation' AND a.project_id=t.project_id AND a.id=t.target_id
        LEFT JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
        WHERE t.project_id=%s AND t.state='trashed' AND t.target_kind||':'||t.target_id>%s
        ORDER BY t.target_kind||':'||t.target_id LIMIT %s''', (project_id, cursor, limit)).fetchall()
