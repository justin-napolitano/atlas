"""Optional page organization and explicit page references; never a second body store."""
import base64
import json
import uuid
from . import database as db,workspace_store as workspace
from .desktop_sources import _receipt,_commit

ACTIVE="""WITH active AS (
 SELECT n.id,n.title,n.thought_type,n.revision,n.updated_at,n.links,n.body FROM research.notebook_entries n
 WHERE n.state='active'
 AND NOT EXISTS(SELECT 1 FROM research.workspace_note_trash t WHERE t.entry_id=n.id AND t.state='trashed')
 AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed')
) """


def _active(c,id):
    return c.execute(ACTIVE+'SELECT id,title,thought_type,revision FROM active WHERE id=%s',(id,)).fetchone()


def _cursor(value):
    if not value:return '', ''
    try:
        row=json.loads(base64.urlsafe_b64decode(value+'='*(-len(value)%4)))
        if not isinstance(row,list) or len(row)!=2:raise ValueError()
        db._text(row[0],'cursor title',300,empty=True);db._text(row[1],'cursor ID',500)
        return row
    except (ValueError,TypeError,UnicodeError):raise ValueError('Invalid page cursor') from None


def listing(c,*,parent_id=None,q='',cursor='',limit=30,all_pages=False):
    db._text(q,'page query',300,empty=True)
    if type(limit) is not int or not 1<=limit<=50 or type(all_pages) is not bool:raise ValueError('Invalid page query')
    title,id=_cursor(cursor)
    rows=c.execute(ACTIVE+'''SELECT n.id,n.title,n.thought_type,n.revision,lower(n.title) AS sort_title,p.parent_id,coalesce(p.revision,0) AS placement_revision,
      (SELECT a.title FROM active a WHERE a.id=p.parent_id) AS parent_title,
      EXISTS(SELECT 1 FROM research.desktop_page_positions child JOIN active a ON a.id=child.entry_id WHERE child.parent_id=n.id) AS has_children
      FROM active n LEFT JOIN research.desktop_page_positions p ON p.entry_id=n.id
      WHERE (%s OR (%s::text IS NOT NULL AND p.parent_id=%s) OR (%s::text IS NULL AND
        (p.parent_id IS NULL OR NOT EXISTS(SELECT 1 FROM active a WHERE a.id=p.parent_id))))
      AND (strpos(lower(n.title),lower(%s))>0 OR n.id=%s)
      AND (%s='' OR (lower(n.title),n.id)>(%s,%s))
      ORDER BY lower(n.title),n.id LIMIT %s''',(all_pages,parent_id,parent_id,parent_id,q,q,id,title,id,limit+1)).fetchall()
    next_cursor=None
    if len(rows)>limit:
        row=rows[limit-1];next_cursor=base64.urlsafe_b64encode(json.dumps([row['sort_title'],row['id']]).encode()).decode().rstrip('=')
    return dict(items=rows[:limit],next_cursor=next_cursor)


def prepare_child(c,*,request_uuid,parent_id,actor):
    with c.transaction():
        request,digest,old=_receipt(c,request_uuid,actor,dict(parent_id=parent_id),'page-child-v1')
        if old:return {**old['result'],'replayed':True}
        if not _active(c,parent_id):raise ValueError('Choose an active saved parent page')
        entry_id='urn:research:notebook:'+str(request)
        if workspace.note(c,entry_id):raise ValueError('This creation ID already belongs to a saved note')
        result=_commit(c,request,digest,dict(entry_id=entry_id,parent_id=parent_id,request_uuid=str(request)),actor)
        c.execute('INSERT INTO research.desktop_page_intents(request_uuid,parent_id,changed_by) VALUES(%s,%s,%s)',(request,parent_id,actor))
        return result


def apply_prepared_parent(c,*,request_uuid,entry_id,actor):
    intent=c.execute('SELECT * FROM research.desktop_page_intents WHERE request_uuid=%s',(request_uuid,)).fetchone()
    if intent:
        if intent['changed_by']!=actor:raise ValueError('Page intent belongs to another actor')
        # The parent may have entered Trash after preparation. Preserve intent;
        # active children remain discoverable at root until restored or moved.
        c.execute('INSERT INTO research.desktop_page_positions(entry_id,parent_id,changed_by) VALUES(%s,%s,%s)',(entry_id,intent['parent_id'],actor))


def move(c,*,request_uuid,entry_id,parent_id,expected_revision,actor):
    if type(expected_revision) is not int or expected_revision<0:raise ValueError('Supply the saved placement revision')
    value=dict(entry_id=entry_id,parent_id=parent_id,expected_revision=expected_revision)
    with c.transaction():
        request,digest,old=_receipt(c,request_uuid,actor,value,'page-move-v1')
        if old:return {**old['result'],'replayed':True}
        c.execute('SELECT pg_advisory_xact_lock(184514,173121)')
        if not _active(c,entry_id) or parent_id and not _active(c,parent_id):raise ValueError('Choose active saved pages')
        current=c.execute('SELECT * FROM research.desktop_page_positions WHERE entry_id=%s FOR UPDATE',(entry_id,)).fetchone()
        if (current['revision'] if current else 0)!=expected_revision:raise db.RevisionConflict(current)
        if current:
            row=c.execute('UPDATE research.desktop_page_positions SET parent_id=%s,revision=revision+1,changed_by=%s WHERE entry_id=%s RETURNING *',(parent_id,actor,entry_id)).fetchone()
        else:row=c.execute('INSERT INTO research.desktop_page_positions(entry_id,parent_id,changed_by) VALUES(%s,%s,%s) RETURNING *',(entry_id,parent_id,actor)).fetchone()
        return _commit(c,request,digest,dict(entry_id=entry_id,parent_id=parent_id,revision=row['revision']),actor)


def context(c,*,entry_id):
    current=_active(c,entry_id);pending=False
    row=c.execute('SELECT parent_id,revision FROM research.desktop_page_positions WHERE entry_id=%s',(entry_id,)).fetchone()
    if not current:
        try:
            request=uuid.UUID(entry_id.removeprefix('urn:research:notebook:'))
            if entry_id!='urn:research:notebook:'+str(request):raise ValueError()
        except (ValueError,AttributeError):raise ValueError('Page unavailable') from None
        intent=c.execute('SELECT parent_id FROM research.desktop_page_intents WHERE request_uuid=%s',(request,)).fetchone()
        if not intent or workspace.note(c,entry_id):raise ValueError('Page unavailable')
        pending=True;row=dict(parent_id=intent['parent_id'],revision=0)
    ancestors=[];parent=row['parent_id'] if row else None;seen={entry_id}
    while parent and parent not in seen and len(ancestors)<32:
        seen.add(parent);ancestor=_active(c,parent)
        ancestors.append(dict(id=parent,title=ancestor['title'] if ancestor else 'Parent unavailable',unavailable=ancestor is None))
        placement=c.execute('SELECT parent_id FROM research.desktop_page_positions WHERE entry_id=%s',(parent,)).fetchone()
        parent=placement['parent_id'] if placement else None
    return dict(entry_id=entry_id,current=current,parent_id=row['parent_id'] if row else None,placement_revision=row['revision'] if row else 0,
        ancestors=list(reversed(ancestors)),pending=pending,children=listing(c,parent_id=entry_id,limit=20) if not pending else dict(items=[],next_cursor=None))


def backlinks(c,*,entry_id,cursor='',limit=30):
    if not _active(c,entry_id):raise ValueError('Page unavailable')
    if type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid backlink page')
    db._text(cursor,'backlink cursor',500,empty=True)
    rows=c.execute(ACTIVE+'''SELECT n.id,n.title,n.thought_type,n.revision FROM active n WHERE n.id>%s
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(n.links) l WHERE l->>'kind'='entry' AND l->>'id'=%s)
      ORDER BY n.id LIMIT %s''',(cursor,entry_id,limit+1)).fetchall()
    return dict(items=rows[:limit],next_cursor=rows[limit-1]['id'] if len(rows)>limit else None)


def resolve(c,*,target):
    db._text(target,'page link',500)
    exact=_active(c,target)
    if exact:return dict(state='resolved',items=[exact])
    if target.startswith('urn:research:notebook:'):return dict(state='unavailable',items=[])
    rows=c.execute(ACTIVE+'SELECT id,title,thought_type,revision FROM active WHERE title=%s ORDER BY id LIMIT 21',(target,)).fetchall()
    return dict(state='resolved' if len(rows)==1 else 'ambiguous' if rows else 'unresolved',items=rows[:20],truncated=len(rows)>20)
