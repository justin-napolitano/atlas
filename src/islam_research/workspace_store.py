"""One private owner workspace. Project values returned here are legacy origins."""
import base64
from datetime import datetime
import json
import re
import uuid

from . import database as db,notebook,notebook_drafts,private_trash

WORKSPACE='owner'


def derived_title(body):
    for line in body.splitlines():
        if line.strip():return re.sub(r'^\s{0,3}#{1,6}\s+','',line).strip()[:300] or 'Untitled note'
    return 'Untitled note'


def note(connection,entry_id):
    return notebook.get(connection,None,entry_id)


def create_note(connection,*,request_uuid,body,actor,title='',thought_type='note',links=None,record_id=None,document_id=None,annotation_id=None,reading_position=None):
    # Legacy uncertain creates retain their stored creation scope; new writing has none.
    identifier='urn:research:notebook:'+str(uuid.UUID(request_uuid))
    old=note(connection,identifier)
    origin=old['project_id'] if old else None
    mode='manual' if title.strip() else 'automatic'
    with connection.transaction():
        result=notebook.create(connection,request_uuid=request_uuid,project_id=origin,body=body,actor=actor,
          title=title if mode=='manual' else derived_title(body),title_mode=mode,thought_type=thought_type,links=links or [],
          record_id=record_id,document_id=document_id,annotation_id=annotation_id,reading_position=reading_position)
        return note(connection,result['id'])


def update_note(connection,*,entry_id,expected_revision,body,actor,title=None,title_mode=None,thought_type=None,links=None,state='active'):
    old=note(connection,entry_id)
    if not old:raise ValueError('Note not found')
    mode=title_mode or ('manual' if title is not None and title.strip() else old['title_mode'])
    label=derived_title(body) if mode=='automatic' else title if title is not None else old['title']
    return notebook.update(connection,project_id=old['project_id'],entry_id=entry_id,expected_revision=expected_revision,
      body=body,title=label,title_mode=mode,thought_type=thought_type or old['thought_type'],links=old['links'] if links is None else links,
      state=state,actor=actor)


def _cursor(value):
    if not value:return None
    try:
        row=json.loads(base64.urlsafe_b64decode(value+'='*(-len(value)%4)))
        if not isinstance(row,list) or len(row)!=2:raise ValueError()
        time=datetime.fromisoformat(row[0]);db._text(row[1],'cursor ID',500)
        if time.tzinfo is None:raise ValueError()
        return time,row[1]
    except (ValueError,TypeError,UnicodeError) as error:raise ValueError('Invalid workspace cursor') from error


def notes(connection,*,q='',thought_type='',cursor='',limit=30,trashed=False):
    db._text(q,'query',300,empty=True);db._text(cursor,'cursor',1200,empty=True)
    if thought_type not in notebook.TYPES|{''} or type(limit) is not int or not 1<=limit<=50 or type(trashed) is not bool:raise ValueError('Invalid note filter')
    after=_cursor(cursor)
    rows=connection.execute('''WITH candidates AS (
      SELECT n.*,r.title AS source_title,d.edition,d.locator,
       (r.id IS NULL AND n.record_id IS NULL OR r.id IS NOT NULL AND r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available,
       (EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed') OR
        EXISTS(SELECT 1 FROM research.workspace_note_trash t WHERE t.entry_id=n.id AND t.state='trashed')) AS trashed
      FROM research.notebook_entries n LEFT JOIN research.records r ON r.id=n.record_id
      LEFT JOIN research.reading_documents d ON d.id=n.document_id
      WHERE n.workspace_id='owner' AND n.state='active' AND (%s='' OR n.thought_type=%s)
        AND strpos(lower(n.title||' '||n.body),lower(%s))>0
    ) SELECT * FROM candidates WHERE trashed=%s
      AND (%s::timestamptz IS NULL OR (updated_at,id)<(%s::timestamptz,%s))
      ORDER BY updated_at DESC,id DESC LIMIT %s''',
      (thought_type,thought_type,q.strip(),trashed,after[0] if after else None,after[0] if after else None,after[1] if after else '',limit+1)).fetchall()
    next_cursor=None
    if len(rows)>limit:
        last=rows[limit-1];next_cursor=base64.urlsafe_b64encode(json.dumps([last['updated_at'].isoformat(),last['id']]).encode()).decode().rstrip('=')
    return dict(items=rows[:limit],next_cursor=next_cursor,workspace_id=WORKSPACE)


def history(connection,*,entry_id,before_revision=None,limit=30):
    if not note(connection,entry_id):return None
    return connection.execute('''SELECT revision,snapshot FROM research.notebook_revisions WHERE entry_id=%s
      AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s''',(entry_id,before_revision,before_revision,limit)).fetchall()


def trash(connection,*,entry_id,target_revision,expected_revision,state,actor):
    if type(expected_revision) is not int or expected_revision<0 or type(target_revision) is not int or target_revision<1 or state not in {'active','trashed'}:raise ValueError('Invalid trash change')
    with connection.transaction():
        target=connection.execute('SELECT project_id,revision FROM research.notebook_entries WHERE id=%s FOR UPDATE',(entry_id,)).fetchone()
        if not target:raise ValueError('Note not found')
        if target['project_id'] is not None:return private_trash.change(connection,project_id=target['project_id'],target_kind='entry',target_id=entry_id,target_revision=target_revision,expected_revision=expected_revision,state=state,actor=actor)
        if target['revision']!=target_revision:raise db.RevisionConflict(note(connection,entry_id))
        old=connection.execute('SELECT * FROM research.workspace_note_trash WHERE entry_id=%s',(entry_id,)).fetchone()
        if old and old['revision']==expected_revision+1 and old['state']==state and old['target_revision']==target_revision and old['changed_by']==actor:return old
        if (old['revision'] if old else 0)!=expected_revision:raise db.RevisionConflict(old)
        if old:return connection.execute('''UPDATE research.workspace_note_trash SET target_revision=%s,state=%s,
          changed_by=%s,revision=revision+1 WHERE entry_id=%s RETURNING *''',(target_revision,state,actor,entry_id)).fetchone()
        return connection.execute('INSERT INTO research.workspace_note_trash(entry_id,target_revision,state,changed_by) VALUES(%s,%s,%s,%s) RETURNING *',(entry_id,target_revision,state,actor)).fetchone()


def draft(connection,*,draft_id):
    return connection.execute('SELECT * FROM research.notebook_drafts WHERE id=%s',(draft_id,)).fetchone()


def save_draft(connection,**fields):
    key=notebook_drafts.identifier(fields['draft_uuid']);old=draft(connection,draft_id=key)
    origin=old['project_id'] if old else None
    if fields['entry_id']:
        target=note(connection,fields['entry_id'])
        if not target:raise ValueError('Recovery note is unavailable')
        origin=target['project_id']
    return notebook_drafts.save(connection,project_id=origin,**fields)


def drafts(connection,*,cursor='',limit=30):
    return connection.execute("SELECT * FROM research.notebook_drafts WHERE workspace_id='owner' AND state='active' AND id>%s ORDER BY id LIMIT %s",(cursor,limit)).fetchall()


def sources(connection,*,q='',cursor='',limit=30):
    db._text(q,'query',300,empty=True);db._text(cursor,'cursor',500,empty=True)
    if type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid source page')
    rows=connection.execute("""SELECT id,project_id,kind,title,summary,attributes,revision,updated_at
      FROM research.records WHERE workspace_id='owner' AND kind IN ('source','work','edition')
      AND deleted_at IS NULL AND review_state<>'withdrawn' AND id>%s
      AND strpos(lower(title||' '||summary),lower(%s))>0 ORDER BY id LIMIT %s""",(cursor,q,limit+1)).fetchall()
    return dict(items=rows[:limit],next_cursor=rows[limit-1]['id'] if len(rows)>limit else None)


def source(connection,*,record_id):
    row=db.get_record(connection,record_id)
    if not row or row['kind'] not in {'source','work','edition'} or row['deleted_at'] or row['review_state']=='withdrawn':return None
    from . import passage_store,shared_library
    return dict(record=row,documents=passage_store.documents(connection,row['project_id'],record_id,cursor='',limit=50),
      library=shared_library.source_identity(connection,row['project_id'],record_id))


def intake_candidates(connection,*,source_url='',identifier=''):
    from . import source_intake
    return dict(items=source_intake.candidates(connection,None,source_url,identifier))


def intake(connection,**fields):
    from . import source_intake,shared_library
    origin=None
    if fields.get('existing_source_record_id'):
        current=source(connection,record_id=fields['existing_source_record_id'])
        if not current:raise ValueError('Source unavailable')
        origin=current['record']['project_id']
    with connection.transaction():
        result=source_intake.create(connection,project_id=origin,owner_confirmed=True,**fields)
        row=db.get_record(connection,result['record_id'])
        if not result['replayed']:
            shared_library.index_source(connection,request_uuid=fields['intake_uuid'],project_id=origin,
              source_record_id=row['id'],expected_source_revision=row['revision'],actor=fields['actor'])
        return result
