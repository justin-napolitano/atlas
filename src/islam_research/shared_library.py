"""Owner-only additive library identities; legacy writing remains authoritative."""
from __future__ import annotations

import hashlib
import json
import uuid
from . import database as db

STATUSES={'needs_review','want_to_read','reading','finished'}

# Each virtual note points at its existing save authority. Never materialize a
# second Markdown body or count an annotation again as a notebook projection.
NOTES_SQL="""
WITH source_scope AS (
 SELECT b.work_id,b.item_id,b.source_record_id,b.project_id
 FROM research.library_source_bindings b JOIN research.records r
 ON r.id=b.source_record_id AND r.project_id=b.project_id
 WHERE b.item_id=ANY(%s) AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
), notes AS (
 SELECT 'entry:'||n.id AS note_key,'entry' AS item_kind,n.id,n.project_id,
  n.record_id,n.document_id,n.annotation_id,n.reading_position,n.title,n.body,
  n.thought_type,n.revision,n.updated_at,s.work_id,s.item_id
 FROM research.notebook_entries n JOIN source_scope s
 ON s.project_id=n.project_id AND s.source_record_id=n.record_id
 WHERE n.state='active' AND length(btrim(n.body))>0
 AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id
  AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed')
 UNION ALL
 SELECT 'annotation:'||a.id,'annotation',a.id,a.project_id,d.source_record_id,
  a.document_id,a.id,a.start_pos,a.exact,a.body,'passage_note',a.revision,a.updated_at,s.work_id,s.item_id
 FROM research.reading_annotations a JOIN research.reading_documents d
 ON d.project_id=a.project_id AND d.id=a.document_id JOIN source_scope s
 ON s.project_id=d.project_id AND s.source_record_id=d.source_record_id
 WHERE length(btrim(a.body))>0
 AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=a.project_id
  AND t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed')
 UNION ALL
 SELECT 'record:'||p.record_id,'record_note',p.record_id,p.project_id,p.record_id,
  NULL::text,NULL::text,NULL::integer,'Legacy source note',p.note,'record_note',p.revision,p.updated_at,s.work_id,s.item_id
 FROM research.personal_states p JOIN source_scope s
 ON s.project_id=p.project_id AND s.source_record_id=p.record_id WHERE length(btrim(p.note))>0
)
"""


def _context(connection,item_id,project_id=''):
    db._text(item_id,'library item',500)
    if project_id:
        db._text(project_id,'project context',500)
        if not connection.execute("SELECT 1 FROM research.library_project_items WHERE item_id=%s AND project_id=%s AND state<>'removed'",(item_id,project_id)).fetchone():
            return False
    return connection.execute('SELECT 1 FROM research.library_items WHERE id=%s',(item_id,)).fetchone() is not None


def get(connection,item_id,project_id=''):
    if not _context(connection,item_id,project_id):return None
    row=connection.execute(NOTES_SQL+"""SELECT i.*,r.title,w.title AS identity_title,w.identity_basis,w.legacy_source_id,
        (r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available,
        (SELECT count(DISTINCT note_key) FROM notes WHERE item_id=i.id) AS note_count,
        (SELECT count(*) FROM research.library_editions e WHERE e.work_id=i.work_id) AS edition_count
        FROM research.library_items i JOIN research.library_works w ON w.id=i.work_id
        JOIN research.records r ON r.id=w.legacy_source_id WHERE i.id=%s""",([item_id],item_id)).fetchone()
    if row:
        row['project_associations']=connection.execute('SELECT project_id,state,revision FROM research.library_project_items WHERE item_id=%s ORDER BY project_id',(item_id,)).fetchall()
        row['legacy_reading_states']=connection.execute('''SELECT p.project_id,p.record_id,p.reading,p.read_at,p.revision
            FROM research.personal_states p JOIN research.library_source_bindings b
            ON b.source_record_id=p.record_id AND b.project_id=p.project_id WHERE b.item_id=%s ORDER BY p.project_id,p.record_id''',(item_id,)).fetchall()
        row['legacy_scope']='Original project-scoped notes and reading state are retained; no automatic consolidation.'
    return row


def listing(connection,*,project_id='',retained=True,cursor='',limit=30):
    if type(retained) is not bool or type(limit) is not int or not 1<=limit<=51:raise ValueError('Invalid library page')
    db._text(cursor,'cursor',500,empty=True);db._text(project_id,'project context',500,empty=True)
    # Identity inventory is ID-ordered. Shelf recency/search is #195, not inferred here.
    rows=connection.execute("""SELECT i.*,r.title,w.title AS identity_title,w.identity_basis,w.legacy_source_id,
        (r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available
        FROM research.library_items i JOIN research.library_works w ON w.id=i.work_id
        JOIN research.records r ON r.id=w.legacy_source_id
        WHERE i.id>%s AND i.on_shelf=%s AND (%s='' OR EXISTS(
          SELECT 1 FROM research.library_project_items p WHERE p.item_id=i.id AND p.project_id=%s AND p.state<>'removed'))
        ORDER BY i.id LIMIT %s""",(cursor,retained,project_id,project_id,limit)).fetchall()
    counts=connection.execute(NOTES_SQL+'SELECT item_id,count(DISTINCT note_key) AS n FROM notes GROUP BY item_id',([row['id'] for row in rows],)).fetchall() if rows else []
    by_id={row['item_id']:row['n'] for row in counts}
    for row in rows:row['note_count']=by_id.get(row['id'],0)
    return rows


def source_identity(connection,project_id,source_record_id):
    return connection.execute('''SELECT b.*,i.revision AS item_revision,i.on_shelf,i.reading_status,
        r.revision AS current_source_revision,(r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available
        FROM research.library_source_bindings b JOIN research.library_items i ON i.id=b.item_id
        JOIN research.records r ON r.id=b.source_record_id AND r.project_id=b.project_id
        WHERE b.project_id=%s AND b.source_record_id=%s''',(project_id,source_record_id)).fetchone()


def index_source(connection,*,request_uuid,project_id,source_record_id,expected_source_revision,actor):
    request=uuid.UUID(request_uuid)
    if request.version!=4:raise ValueError('Retain a UUIDv4 indexing ID for retries')
    for text,name in [(project_id,'project'),(source_record_id,'source'),(actor,'actor')]:db._text(text,name,500)
    if type(expected_source_revision) is not int or expected_source_revision<1:raise ValueError('Invalid source revision')
    payload=dict(project_id=project_id,source_record_id=source_record_id,expected_source_revision=expected_source_revision,actor=actor)
    digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('library-index:'+str(request),))
        old=connection.execute('SELECT * FROM research.library_requests WHERE request_uuid=%s',(request,)).fetchone()
        if old:
            if old['input_sha256']!=digest:raise db.RevisionConflict(None)
            return {**old['result'],'replayed':True}
        source=connection.execute("SELECT * FROM research.records WHERE id=%s AND project_id=%s AND kind IN ('source','work','edition') AND deleted_at IS NULL AND review_state<>'withdrawn' FOR SHARE",(source_record_id,project_id)).fetchone()
        if not source:raise ValueError('Active source not found in this project')
        if source['revision']!=expected_source_revision:raise db.RevisionConflict(source)
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('library-source:'+source_record_id,))
        item_id=connection.execute('SELECT research.index_library_source(%s) AS id',(source_record_id,)).fetchone()['id']
        result=dict(item_id=item_id,project_id=project_id,source_record_id=source_record_id)
        connection.execute('INSERT INTO research.library_requests(request_uuid,input_sha256,result,changed_by) VALUES(%s,%s,%s,%s)',(request,digest,db.Jsonb(result),actor))
        return {**result,'replayed':False}


def update_item(connection,*,item_id,expected_revision,on_shelf,reading_status,preferred_edition_id,actor):
    if type(expected_revision) is not int or expected_revision<1 or type(on_shelf) is not bool or reading_status not in STATUSES:
        raise ValueError('Invalid library state')
    db._text(actor,'actor',500)
    with connection.transaction():
        old=connection.execute('SELECT * FROM research.library_items WHERE id=%s FOR UPDATE',(item_id,)).fetchone()
        if not old:raise ValueError('Library item not found')
        if preferred_edition_id and not connection.execute('SELECT 1 FROM research.library_editions WHERE id=%s AND work_id=%s',(preferred_edition_id,old['work_id'])).fetchone():
            raise ValueError('The edition belongs to another work')
        desired=dict(on_shelf=on_shelf,reading_status=reading_status,preferred_edition_id=preferred_edition_id)
        if old['revision']==expected_revision+1 and all(old[k]==v for k,v in desired.items()):return old
        if old['revision']!=expected_revision:raise db.RevisionConflict(old)
        return connection.execute('''UPDATE research.library_items SET on_shelf=%s,reading_status=%s,preferred_edition_id=%s,
            revision=revision+1,changed_by=%s WHERE id=%s RETURNING *''',(on_shelf,reading_status,preferred_edition_id,actor,item_id)).fetchone()


def membership(connection,*,item_id,project_id,state,expected_revision,actor):
    if state not in {'active','removed'} or type(expected_revision) is not int or expected_revision<0:raise ValueError('Invalid project membership')
    for text,name in [(item_id,'library item'),(project_id,'project'),(actor,'actor')]:db._text(text,name,500)
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('library-membership:'+json.dumps([item_id,project_id]),))
        if not _context(connection,item_id):raise ValueError('Library item not found')
        if not connection.execute('SELECT 1 FROM research.projects WHERE id=%s',(project_id,)).fetchone():raise ValueError('Project not found')
        old=connection.execute('SELECT * FROM research.library_project_items WHERE item_id=%s AND project_id=%s FOR UPDATE',(item_id,project_id)).fetchone()
        if old and old['revision']==expected_revision+1 and old['state']==state:return old
        if (old['revision'] if old else 0)!=expected_revision:raise db.RevisionConflict(old)
        if old:
            return connection.execute('''UPDATE research.library_project_items SET state=%s,revision=revision+1,changed_by=%s
                WHERE item_id=%s AND project_id=%s RETURNING *''',(state,actor,item_id,project_id)).fetchone()
        return connection.execute('''INSERT INTO research.library_project_items(item_id,project_id,state,changed_by)
            VALUES(%s,%s,%s,%s) RETURNING *''',(item_id,project_id,state,actor)).fetchone()


def editions(connection,item_id,project_id='',cursor='',limit=30):
    if not _context(connection,item_id,project_id):return []
    return connection.execute('''SELECT e.* FROM research.library_editions e JOIN research.library_items i ON i.work_id=e.work_id
        WHERE i.id=%s AND e.id>%s ORDER BY e.id LIMIT %s''',(item_id,cursor,limit)).fetchall()


def documents(connection,item_id,project_id='',edition_id='',cursor='',limit=30):
    if not _context(connection,item_id,project_id):return []
    return connection.execute('''SELECT b.document_id,b.project_id,b.source_record_id,b.representation_id,
        r.edition_id,r.text_sha256,r.locator,r.normalization,d.edition,d.representation_url,
        (s.deleted_at IS NULL AND s.review_state<>'withdrawn') AS source_available
        FROM research.library_document_bindings b JOIN research.library_representations r ON r.id=b.representation_id
        JOIN research.library_items i ON i.work_id=b.work_id JOIN research.reading_documents d ON d.id=b.document_id AND d.project_id=b.project_id
        JOIN research.records s ON s.id=b.source_record_id AND s.project_id=b.project_id
        WHERE i.id=%s AND (%s='' OR r.edition_id=%s) AND b.document_id>%s ORDER BY b.document_id LIMIT %s''',
        (item_id,edition_id,edition_id,cursor,limit)).fetchall()


def resolve(connection,*,item_id,document_id,project_id=''):
    if not _context(connection,item_id,project_id):return None
    target=connection.execute('''SELECT b.project_id,b.source_record_id AS record_id,b.document_id,
        b.representation_id,r.edition_id,r.locator,r.text_sha256,r.notice_sha256,
        (s.deleted_at IS NULL AND s.review_state<>'withdrawn') AS source_available
        FROM research.library_document_bindings b JOIN research.library_representations r ON r.id=b.representation_id
        JOIN research.library_items i ON i.work_id=b.work_id JOIN research.records s
        ON s.id=b.source_record_id AND s.project_id=b.project_id WHERE i.id=%s AND b.document_id=%s''',(item_id,document_id)).fetchone()
    if target:target['target_status']='available' if target['source_available'] else 'source_unavailable'
    return target


def notes(connection,item_id,project_id='',cursor='',limit=30):
    if not _context(connection,item_id,project_id):return []
    return connection.execute(NOTES_SQL+'''SELECT notes.*,project_id AS origin_project_id FROM notes
        WHERE item_id=%s AND note_key>%s ORDER BY note_key LIMIT %s''',([item_id],item_id,cursor,limit)).fetchall()
