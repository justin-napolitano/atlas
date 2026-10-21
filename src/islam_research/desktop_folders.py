"""Private local folders organize note identities, never copied Markdown."""
from . import database as db
from .desktop_sources import _receipt,_commit
from .desktop_pages import ACTIVE,_cursor


def active(c,id):
    return c.execute("SELECT * FROM research.desktop_folders WHERE id=%s AND state='active'",(id,)).fetchone()


def change(c,*,request_uuid,folder_id=None,title=None,parent_id=None,expected_revision=0,action='create',actor):
    if action not in ('create','rename','move','remove'):raise ValueError('Unknown folder action')
    if action in ('create','rename'):db._text(title,'folder name',300)
    if type(expected_revision) is not int or expected_revision<0:raise ValueError('Supply the saved folder revision')
    value=dict(folder_id=folder_id,title=title,parent_id=parent_id,expected_revision=expected_revision,action=action)
    with c.transaction():
        request,digest,old=_receipt(c,request_uuid,actor,value,'folder-v1')
        if old:return {**old['result'],'replayed':True}
        c.execute('SELECT pg_advisory_xact_lock(184514,173121)')
        if parent_id and not active(c,parent_id):raise ValueError('Choose an active folder')
        if action=='create':
            if folder_id is not None or expected_revision:raise ValueError('New folders have no previous revision')
            row=c.execute('INSERT INTO research.desktop_folders(id,title,parent_id,changed_by) VALUES(%s,%s,%s,%s) RETURNING *',
                ('urn:research:folder:'+str(request),title.strip(),parent_id,actor)).fetchone()
        else:
            current=c.execute('SELECT * FROM research.desktop_folders WHERE id=%s FOR UPDATE',(folder_id,)).fetchone()
            if not current or current['state']!='active':raise ValueError('Folder unavailable')
            if current['revision']!=expected_revision:raise db.RevisionConflict(current)
            row=c.execute('''UPDATE research.desktop_folders SET title=%s,parent_id=%s,state=%s,revision=revision+1,changed_by=%s
                WHERE id=%s RETURNING *''',(title.strip() if action=='rename' else current['title'],parent_id if action=='move' else current['parent_id'],
                'removed' if action=='remove' else 'active',actor,folder_id)).fetchone()
        return _commit(c,request,digest,dict(id=row['id'],title=row['title'],parent_id=row['parent_id'],revision=row['revision'],state=row['state']),actor)


def ancestors(c,folder_id):
    result=[];seen=set()
    while folder_id and folder_id not in seen and len(result)<16:
        seen.add(folder_id);row=active(c,folder_id)
        if not row:break
        result.append(dict(id=row['id'],title=row['title'],kind='folder',unavailable=False,placement_revision=row['revision']))
        folder_id=row['parent_id']
    return list(reversed(result))


def tree(c,*,folder_id=None,parent_id=None,q='',cursor='',limit=30,all_items=False):
    db._text(q,'tree query',300,empty=True)
    if folder_id and parent_id or type(all_items) is not bool or type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid tree query')
    title,id=_cursor(cursor)
    rows=c.execute(ACTIVE+''', nodes AS (
      SELECT f.id,f.title,'folder' AS kind,f.parent_id,NULL::text AS folder_id,f.revision AS placement_revision,
       EXISTS(SELECT 1 FROM research.desktop_folders child WHERE child.parent_id=f.id AND child.state='active') OR
       EXISTS(SELECT 1 FROM research.desktop_page_positions p JOIN active n ON n.id=p.entry_id WHERE p.folder_id=f.id) AS has_children,
       (SELECT title FROM research.desktop_folders WHERE id=f.parent_id) AS parent_title
      FROM research.desktop_folders f WHERE f.state='active' AND (%s OR (%s::text IS NULL AND f.parent_id IS NOT DISTINCT FROM %s::text))
      UNION ALL
      SELECT n.id,n.title,'page',p.parent_id,p.folder_id,coalesce(p.revision,0),
       EXISTS(SELECT 1 FROM research.desktop_page_positions child JOIN active a ON a.id=child.entry_id WHERE child.parent_id=n.id),
       coalesce((SELECT title FROM active WHERE id=p.parent_id),(SELECT title FROM research.desktop_folders WHERE id=p.folder_id))
      FROM active n LEFT JOIN research.desktop_page_positions p ON p.entry_id=n.id
      WHERE %s OR (%s::text IS NOT NULL AND p.parent_id=%s) OR (%s::text IS NULL AND p.folder_id IS NOT DISTINCT FROM %s::text
        AND (p.parent_id IS NULL OR NOT EXISTS(SELECT 1 FROM active a WHERE a.id=p.parent_id)))
    ) SELECT *,lower(title) AS sort_title FROM nodes WHERE (strpos(lower(title),lower(%s))>0 OR id=%s)
      AND (%s='' OR (lower(title),id)>(%s,%s)) ORDER BY lower(title),id LIMIT %s''',
      (all_items,parent_id,folder_id,all_items,parent_id,parent_id,parent_id,folder_id,q,q,id,title,id,limit+1)).fetchall()
    import base64,json
    next_cursor=None
    if len(rows)>limit:
        last=rows[limit-1];next_cursor=base64.urlsafe_b64encode(json.dumps([last['sort_title'],last['id']]).encode()).decode().rstrip('=')
    return dict(items=rows[:limit],next_cursor=next_cursor)
