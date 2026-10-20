"""Revisioned, owner-declared reading completion, never scholarly verification."""
from . import database as db
from .quran_citations import reference


def listing(connection, project_id):
    return connection.execute('SELECT * FROM research.quran_reading_progress WHERE project_id=%s ORDER BY chapter,ayah LIMIT 6236', (project_id,)).fetchall()


def save(connection, *, project_id, chapter, ayah, is_read, expected_revision, actor):
    reference(chapter, ayah)
    if type(is_read) is not bool or type(expected_revision) is not int or expected_revision < 0:
        raise ValueError('Declare read or unread with a valid revision.')
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))', (f'quran-progress:{project_id}:{chapter}:{ayah}',))
        old = connection.execute('SELECT * FROM research.quran_reading_progress WHERE project_id=%s AND chapter=%s AND ayah=%s', (project_id, chapter, ayah)).fetchone()
        # Lost acknowledgement: retrying the exact old CAS is one operation.
        if old and old['revision'] == expected_revision + 1 and old['is_read'] == is_read and old['changed_by'] == actor:
            return old
        if (old['revision'] if old else 0) != expected_revision:
            raise db.RevisionConflict(old)
        return connection.execute('''INSERT INTO research.quran_reading_progress(project_id,chapter,ayah,is_read,changed_by)
            VALUES(%s,%s,%s,%s,%s) ON CONFLICT(project_id,chapter,ayah) DO UPDATE SET
            is_read=EXCLUDED.is_read,changed_by=EXCLUDED.changed_by,revision=research.quran_reading_progress.revision+1
            RETURNING *''', (project_id, chapter, ayah, is_read, actor)).fetchone()
