"""Revision-aware recovery copies; these never create or update actual thoughts."""
import uuid

from . import database as db, notebook


def identifier(value):
    parsed = uuid.UUID(value)
    if parsed.version != 4 or str(parsed) != value:
        raise ValueError('Supply a canonical UUID4 recovery identity')
    return 'urn:research:writing-draft:' + value


def get(connection, project_id, draft_id):
    return connection.execute('SELECT * FROM research.notebook_drafts WHERE project_id=%s AND id=%s',
                              (project_id, draft_id)).fetchone()


def listing(connection, project_id, cursor='', limit=26):
    return connection.execute('''SELECT * FROM research.notebook_drafts
        WHERE project_id=%s AND state='active' AND id>%s ORDER BY id LIMIT %s''',
        (project_id, cursor, limit)).fetchall()


def save(connection, *, draft_uuid, project_id, entry_id, request_uuid, record_id, document_id,
         annotation_id, base_revision, expected_revision, value, state, actor):
    draft_id = identifier(draft_uuid)
    db._text(actor, 'actor', 500)
    if type(base_revision) is not int or base_revision < 0 or type(expected_revision) is not int or expected_revision < 0:
        raise ValueError('Supply confirmed baseline and recovery revisions')
    if state not in {'active', 'discarded'} or not isinstance(value, dict) or set(value) != {'thought_type', 'title', 'body', 'links', 'state'}:
        raise ValueError('Supply a complete private notebook recovery value')
    # Recovery accepts untitled and empty writing; actual notebook saves do not.
    title = db._text(value['title'], 'title', 300, empty=True)
    body = db._text(value['body'], 'body', 20000, empty=True)
    clean = notebook.metadata(value['thought_type'], title if title.strip() else 'Untitled', body if body.strip() else 'Empty', value['links'], value['state'])
    clean.update(title=title, body=body)
    with connection.transaction():
        baseline = None
        if entry_id:
            if base_revision < 1 or request_uuid is not None:
                raise ValueError('Saved thoughts need a historical baseline, not a creation identity')
            historical = connection.execute('''SELECT snapshot FROM research.notebook_revisions
                WHERE project_id=%s AND entry_id=%s AND revision=%s''', (project_id, entry_id, base_revision)).fetchone()
            if not historical:
                raise ValueError('Notebook baseline is unavailable in this project')
            baseline = historical['snapshot']
            if any(baseline[key] != val for key, val in [('record_id', record_id), ('document_id', document_id), ('annotation_id', annotation_id)]):
                raise ValueError('Recovery cannot relocate an existing thought')
        elif base_revision != 0 or request_uuid is None:
            raise ValueError('New writing needs its original creation identity and zero baseline')
        else:
            identifier(request_uuid)
        for key, val in [('record id', record_id), ('document id', document_id), ('annotation id', annotation_id)]:
            if val is not None:
                db._text(val, key, 500)
        if (document_id and not record_id) or (annotation_id and not document_id) or (clean['thought_type'] == 'source_claim' and not annotation_id):
            raise ValueError('Retain the complete original source anchor')
        notebook._targets(connection, project_id, record_id, document_id, annotation_id, clean['links'])
        identity = dict(entry_id=entry_id, request_uuid=request_uuid, record_id=record_id,
                        document_id=document_id, annotation_id=annotation_id, base_revision=base_revision)
        current = get(connection, project_id, draft_id)
        if current and any(current[key] != val for key, val in identity.items()):
            raise ValueError('Recovery identity and original baseline are immutable')
        if expected_revision == 0:
            row = connection.execute('''INSERT INTO research.notebook_drafts
                (id,project_id,entry_id,request_uuid,record_id,document_id,annotation_id,base_revision,base_snapshot,value,state,changed_by)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING id''',
                (draft_id, project_id, entry_id, request_uuid, record_id, document_id, annotation_id,
                 base_revision, db.Jsonb(baseline), db.Jsonb(clean), state, actor)).fetchone()
        else:
            row = connection.execute('''UPDATE research.notebook_drafts SET value=%s,state=%s,
                changed_by=%s,revision=revision+1 WHERE project_id=%s AND id=%s AND revision=%s RETURNING id''',
                (db.Jsonb(clean), state, actor, project_id, draft_id, expected_revision)).fetchone()
        current = get(connection, project_id, draft_id)
        if row or (current and current['revision'] == expected_revision + 1 and current['value'] == clean
                   and current['state'] == state and current['changed_by'] == actor):
            return current
        raise db.RevisionConflict(current)
