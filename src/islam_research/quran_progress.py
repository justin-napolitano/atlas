"""Revisioned, owner-declared reading completion, never scholarly verification."""
from . import database as db
from .quran_citations import reference


def listing(connection, project_id):
    if project_id is None:return connection.execute("SELECT *,NULL::text AS project_id FROM research.workspace_quran_reading_progress WHERE workspace_id='owner' ORDER BY chapter,ayah LIMIT 6236").fetchall()
    return connection.execute('SELECT * FROM research.quran_reading_progress WHERE project_id=%s ORDER BY chapter,ayah LIMIT 6236', (project_id,)).fetchall()


def save(connection, *, project_id, chapter, ayah, is_read, expected_revision, actor):
    reference(chapter, ayah)
    if type(is_read) is not bool or type(expected_revision) is not int or expected_revision < 0:
        raise ValueError('Declare read or unread with a valid revision.')
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))', (f'quran-progress:{project_id}:{chapter}:{ayah}',))
        table='workspace_quran_reading_progress' if project_id is None else 'quran_reading_progress'
        column='workspace_id' if project_id is None else 'project_id'
        key=project_id or 'owner'
        old = connection.execute(f'SELECT * FROM research.{table} WHERE {column}=%s AND chapter=%s AND ayah=%s', (key, chapter, ayah)).fetchone()
        if old and project_id is None:old['project_id']=None
        # Lost acknowledgement: retrying the exact old CAS is one operation.
        if old and old['revision'] == expected_revision + 1 and old['is_read'] == is_read and old['changed_by'] == actor:
            return old
        if (old['revision'] if old else 0) != expected_revision:
            raise db.RevisionConflict(old)
        row=connection.execute(f'''INSERT INTO research.{table}({column},chapter,ayah,is_read,changed_by)
            VALUES(%s,%s,%s,%s,%s) ON CONFLICT({column},chapter,ayah) DO UPDATE SET
            is_read=EXCLUDED.is_read,changed_by=EXCLUDED.changed_by,revision=research.{table}.revision+1
            RETURNING *''', (key, chapter, ayah, is_read, actor)).fetchone()
        if project_id is None:row['project_id']=None
        return row
