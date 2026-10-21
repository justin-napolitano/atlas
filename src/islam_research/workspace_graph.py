"""Bounded private organization, explicit connections and research trails."""
import hashlib
import json
import uuid
from psycopg import sql
from . import database as db,workspace_store as workspace,passage_store

KINDS={'entry','record','annotation'}
RELATIONS={'personal_association','comments_on','asks_about','defines','supports','challenges','qualifies','interprets','historical_influence'}
TABLES={'collection':'workspace_collections','view':'workspace_saved_views','connection':'workspace_connections'}

def target(c,kind,id):
    if kind=='entry':
        row=workspace.note(c,id)
        if row and not row['trashed'] and row['state']=='active':return dict(kind=kind,id=id,title=row['title'],revision=row['revision'],origin_project_id=row['project_id'],thought_type=row['thought_type'])
    elif kind=='record':
        row=db.get_record(c,id)
        if row and not row['deleted_at'] and row['review_state']!='withdrawn':return dict(kind=kind,id=id,title=row['title'],revision=row['revision'],origin_project_id=row['project_id'],record_kind=row['kind'])
    elif kind=='annotation':
        row=passage_store.annotation(c,None,id)
        if row and row['anchor']['anchored']:
            from .private_trash import get
            mark=row['annotation'];trash=get(c,mark['project_id'],'annotation',id)
            if not trash or trash['state']!='trashed':return dict(kind=kind,id=id,title=mark['exact'],revision=mark['revision'],origin_project_id=mark['project_id'],document_id=mark['document_id'])
    elif kind not in KINDS:raise ValueError('Unknown research object kind')
    return None

def require_target(c,kind,id):
    row=target(c,kind,id)
    if row is None:raise ValueError('Research target unavailable; original identity is retained')
    return row

def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def identifier(entity,request_uuid):
    request=uuid.UUID(request_uuid)
    if request.version!=4:raise ValueError('Retain a UUIDv4 request identity')
    return 'urn:research:'+entity+':'+str(request)

def query_definition(value):
    allowed={'version','scope','q','thought_type','collection_id','reading_status','investigation_state','source_link'}
    if not isinstance(value,dict) or set(value)-allowed or type(value.get('version')) is not int or value['version']!=1 or value.get('scope') not in {'notes','sources','questions','reading'}:raise ValueError('Unsupported saved search definition')
    db._text(value.get('q',''),'query',300,empty=True);db._text(value.get('collection_id',''),'collection reference',500,empty=True)
    if value.get('thought_type','') not in {'','note','question','source_claim','interpretation','objection','decision','principle','skill'}:raise ValueError('Unsupported thought filter')
    if value.get('reading_status','') not in {'','needs_review','want_to_read','reading','finished'} or value.get('investigation_state','') not in {'','open','investigating','provisional','resolved','revisiting','unanswered'} or value.get('source_link','') not in {'','none','present'}:raise ValueError('Unsupported saved view state')
    scope=value['scope']
    if scope in {'sources','reading'} and any(value.get(key) for key in ['thought_type','investigation_state','source_link']):raise ValueError('Source views do not have thought roles or question states')
    if scope in {'notes','questions'} and value.get('reading_status'):raise ValueError('Writing views do not declare reading completion')
    if scope=='questions' and (value.get('thought_type') not in {'',None,'question'} or value.get('source_link')):raise ValueError('Choose supported question filters')
    if scope=='notes' and value.get('investigation_state') and value.get('thought_type')!='question':raise ValueError('Question state applies to question writing only')
    return value


def create(c,*,entity,request_uuid,actor,**fields):
    if entity not in TABLES:raise ValueError('Unsupported organization object')
    id=identifier(entity,request_uuid);table=TABLES[entity];digest=fingerprint(dict(actor=actor,**fields))
    with c.transaction():
        c.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(id,))
        old=c.execute(sql.SQL('SELECT * FROM research.{} WHERE id=%s').format(sql.Identifier(table)),(id,)).fetchone()
        if old:
            if old['creation_sha256']!=digest:raise db.RevisionConflict(old)
            return old
        if entity=='view':fields['query']=query_definition(fields['query'])
        if entity=='connection':
            require_target(c,fields['from_kind'],fields['from_id']);require_target(c,fields['to_kind'],fields['to_id'])
            validate_connection(c,fields)
            if fields['relation']=='comments_on' and fields['from_kind']=='entry' and fields['to_kind']=='record':
                source=db.get_record(c,fields['to_id'])
                if source['kind'] in {'source','work','edition'}:workspace.retain_source(c,source['id'],actor)
        columns=['id','creation_sha256','changed_by',*fields]
        values=[id,digest,actor,*[db.Jsonb(v) if isinstance(v,dict) else v for v in fields.values()]]
        return c.execute(sql.SQL('INSERT INTO research.{} ({}) VALUES ({}) RETURNING *').format(sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,columns)),sql.SQL(',').join(sql.Placeholder() for _ in columns)),values).fetchone()

def validate_connection(c,fields):
    if fields['relation'] not in RELATIONS or fields['state'] not in {'tentative','accepted','withdrawn'}:raise ValueError('Unknown relation state')
    db._text(fields['rationale'],'connection rationale',2000)
    if fields.get('evidence_annotation_id'):require_target(c,'annotation',fields['evidence_annotation_id'])
    if fields['state']=='accepted' and fields['relation'] not in {'personal_association','comments_on','asks_about'}:
        if not fields.get('evidence_annotation_id') or not fields.get('attribution','').strip():raise ValueError('Accepted scholarly relations require attribution and an exact source annotation')

def listing(c,*,entity,cursor='',limit=30):
    if entity not in {'collection','view'} or type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid organization page')
    rows=c.execute(sql.SQL("SELECT * FROM research.{} WHERE state='active' AND id>%s ORDER BY id LIMIT %s").format(sql.Identifier(TABLES[entity])),(cursor,limit+1)).fetchall()
    return dict(items=rows[:limit],next_cursor=rows[limit-1]['id'] if len(rows)>limit else None)

def update(c,*,entity,id,expected_revision,actor,**fields):
    allowed={'collection':{'title','state'},'view':{'title','query','state'},'connection':{'relation','rationale','attribution','evidence_annotation_id','state'}}
    if entity not in allowed or set(fields)!=allowed[entity]:raise ValueError('Supply the complete supported change')
    if entity=='view':query_definition(fields['query'])
    if entity=='connection':validate_connection(c,fields)
    with c.transaction():
        old=c.execute(sql.SQL('SELECT * FROM research.{} WHERE id=%s FOR UPDATE').format(sql.Identifier(TABLES[entity])),(id,)).fetchone()
        if not old:raise ValueError('Organization item not found')
        if old['revision']==expected_revision+1 and all(old[k]==v for k,v in fields.items()) and old['changed_by']==actor:return old
        if old['revision']!=expected_revision:raise db.RevisionConflict(old)
        return c.execute(sql.SQL('UPDATE research.{} SET {},revision=revision+1,changed_by=%s WHERE id=%s RETURNING *').format(sql.Identifier(TABLES[entity]),sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in fields)),(*[db.Jsonb(v) if isinstance(v,dict) else v for v in fields.values()],actor,id)).fetchone()

def membership(c,*,collection_id,target_kind,target_id,state,expected_revision,actor):
    if state not in {'active','removed'}:raise ValueError('Invalid membership state')
    with c.transaction():
        c.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(json.dumps([collection_id,target_kind,target_id]),))
        require_target(c,target_kind,target_id) if state=='active' else None
        if not c.execute("SELECT 1 FROM research.workspace_collections WHERE id=%s AND state='active'",(collection_id,)).fetchone():raise ValueError('Collection unavailable')
        key=(collection_id,target_kind,target_id)
        old=c.execute('SELECT * FROM research.workspace_collection_items WHERE collection_id=%s AND target_kind=%s AND target_id=%s FOR UPDATE',key).fetchone()
        if old and old['revision']==expected_revision+1 and old['state']==state and old['changed_by']==actor:return old
        if (old['revision'] if old else 0)!=expected_revision:raise db.RevisionConflict(old)
        if old:return c.execute('UPDATE research.workspace_collection_items SET state=%s,revision=revision+1,changed_by=%s WHERE collection_id=%s AND target_kind=%s AND target_id=%s RETURNING *',(state,actor,*key)).fetchone()
        return c.execute('INSERT INTO research.workspace_collection_items(collection_id,target_kind,target_id,state,changed_by) VALUES(%s,%s,%s,%s,%s) RETURNING *',(*key,state,actor)).fetchone()

def members(c,*,collection_id,cursor='',limit=30):
    rows=c.execute("SELECT * FROM research.workspace_collection_items WHERE collection_id=%s AND state='active' AND target_kind||':'||target_id>%s ORDER BY target_kind||':'||target_id LIMIT %s",(collection_id,cursor,limit+1)).fetchall()
    return dict(items=[dict(**row,target=target(c,row['target_kind'],row['target_id'])) for row in rows[:limit]],next_cursor=rows[limit-1]['target_kind']+':'+rows[limit-1]['target_id'] if len(rows)>limit else None)

def investigation(c,*,target_kind,target_id):
    require_target(c,target_kind,target_id)
    return c.execute('SELECT * FROM research.workspace_investigations WHERE target_kind=%s AND target_id=%s',(target_kind,target_id)).fetchone()

def investigate(c,*,target_kind,target_id,target_revision,state,reason,expected_revision,actor):
    current=require_target(c,target_kind,target_id)
    if current.get('thought_type',current.get('record_kind'))!='question':raise ValueError('Choose a question to investigate')
    if current['revision']!=target_revision:raise db.RevisionConflict(current)
    if state not in {'open','investigating','provisional','resolved','revisiting'}:raise ValueError('Invalid question state')
    db._text(reason,'question state rationale',2000)
    with c.transaction():
        c.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(json.dumps([target_kind,target_id]),))
        old=investigation(c,target_kind=target_kind,target_id=target_id)
        values=dict(target_revision=target_revision,state=state,reason=reason,changed_by=actor)
        if old and old['revision']==expected_revision+1 and all(old[k]==v for k,v in values.items()):return old
        if (old['revision'] if old else 0)!=expected_revision:raise db.RevisionConflict(old)
        if old:return c.execute('UPDATE research.workspace_investigations SET target_revision=%s,state=%s,reason=%s,revision=revision+1,changed_by=%s WHERE target_kind=%s AND target_id=%s RETURNING *',(target_revision,state,reason,actor,target_kind,target_id)).fetchone()
        return c.execute('INSERT INTO research.workspace_investigations(target_kind,target_id,target_revision,state,reason,changed_by) VALUES(%s,%s,%s,%s,%s,%s) RETURNING *',(target_kind,target_id,target_revision,state,reason,actor)).fetchone()

def reflect(c,*,request_uuid,entry_id,entry_revision,reason,uncertainty,evidence_annotation_id,actor):
    id=identifier('reflection',request_uuid);values=dict(entry_id=entry_id,entry_revision=entry_revision,reason=reason,uncertainty=uncertainty,evidence_annotation_id=evidence_annotation_id,changed_by=actor);digest=fingerprint(values)
    with c.transaction():
        c.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(id,))
        old=c.execute('SELECT * FROM research.workspace_reflections WHERE id=%s',(id,)).fetchone()
        if old:
            if old['creation_sha256']!=digest:raise db.RevisionConflict(old)
            return old
        require_target(c,'entry',entry_id)
        if not c.execute('SELECT 1 FROM research.notebook_revisions WHERE entry_id=%s AND revision=%s',(entry_id,entry_revision)).fetchone():raise ValueError('Original note revision unavailable')
        if evidence_annotation_id:require_target(c,'annotation',evidence_annotation_id)
        return c.execute('INSERT INTO research.workspace_reflections(id,entry_id,entry_revision,reason,uncertainty,evidence_annotation_id,changed_by,creation_sha256) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',(id,*values.values(),digest)).fetchone()

def reflections(c,*,entry_id,cursor='',limit=30):
    require_target(c,'entry',entry_id)
    rows=c.execute('SELECT * FROM research.workspace_reflections WHERE entry_id=%s AND id>%s ORDER BY id LIMIT %s',(entry_id,cursor,limit+1)).fetchall()
    return dict(items=rows[:limit],next_cursor=rows[limit-1]['id'] if len(rows)>limit else None)

def object_edges(c,kind,id,limit):
    rows=c.execute("SELECT * FROM research.workspace_connections WHERE state<>'withdrawn' AND ((from_kind=%s AND from_id=%s) OR (to_kind=%s AND to_id=%s)) ORDER BY id LIMIT %s",(kind,id,kind,id,limit+1)).fetchall()
    def edge(key,left,right,relation,rationale,provenance):
        return dict(id=key,from_kind=left[0],from_id=left[1],to_kind=right[0],to_id=right[1],relation=relation,rationale=rationale,provenance=provenance,state='existing_reference',evidence_annotation_id=None,read_only=True)
    def note_edges(note):
        result=[];origin=('entry',note['id']);provenance=dict(authority='notebook_entries',revision=note['revision'])
        for link in note['links']:
            result.append(edge('notebook-link:'+note['id']+':'+link['kind']+':'+link['id'],origin,(link['kind'],link['id']),'linked_to',link['rationale'],provenance))
        if note['annotation_id']:result.append(edge('note-annotation:'+note['id'],origin,('annotation',note['annotation_id']),'annotates','Original exact passage anchor.',provenance))
        if note['record_id']:result.append(edge('note-source:'+note['id'],origin,('record',note['record_id']),'comments_on','Original source context; no support claim is inferred.',provenance))
        return result
    if kind=='entry':
        row=workspace.note(c,id)
        if row:rows.extend(note_edges(row))
    if kind=='record':
        old=c.execute("SELECT * FROM research.relations WHERE (from_id=%s OR to_id=%s) AND review_state<>'withdrawn' ORDER BY id LIMIT %s",(id,id,limit+1)).fetchall()
        for row in old:
            provenance=row['provenance'];rationale=provenance.get('basis') or provenance.get('rationale') or 'Original curated relation; inspect its source provenance.'
            rows.append(edge('record-relation:'+row['id'],('record',row['from_id']),('record',row['to_id']),row['predicate'].rsplit('/',1)[-1],str(rationale),dict(authority='research.relations',project_id=row['project_id'],original=provenance,review_state=row['review_state'])))
    linked=c.execute("""SELECT id FROM research.notebook_entries WHERE state='active' AND
      (links @> %s OR (%s='record' AND record_id=%s) OR (%s='annotation' AND annotation_id=%s)) ORDER BY id LIMIT %s""",(db.Jsonb([dict(kind=kind,id=id)]),kind,id,kind,id,limit+1)).fetchall()
    for row in linked:
        note=workspace.note(c,row['id'])
        if note and not note['trashed']:rows.extend(e for e in note_edges(note) if (e['from_kind'],e['from_id'])==(kind,id) or (e['to_kind'],e['to_id'])==(kind,id))
    if kind=='annotation':
        row=passage_store.annotation(c,None,id)
        if row:
            mark=row['annotation'];doc=passage_store.get_document(c,None,mark['document_id'])
            rows.append(edge('annotation-source:'+id,('annotation',id),('record',doc['source_record_id']),'located_in',doc['edition']+' · '+doc['locator'],dict(authority='reading_annotations',document_id=doc['id'],text_sha256=doc['text_sha256'],start=mark['start_pos'],end=mark['end_pos'])))
    return rows

def neighborhood(c,*,kind,id,depth=1,limit=40):
    if type(depth) is not int or not 1<=depth<=2 or type(limit) is not int or not 1<=limit<=100:raise ValueError('Choose a bounded neighborhood')
    root=require_target(c,kind,id);nodes={(kind,id):root};edges={};front=[(kind,id)];truncated=False
    for _ in range(depth):
        following=[]
        for k,i in front:
            rows=object_edges(c,k,i,limit)
            if len(rows)>limit:truncated=True
            for row in rows[:limit]:
                key=(row['to_kind'],row['to_id']) if (row['from_kind'],row['from_id'])==(k,i) else (row['from_kind'],row['from_id'])
                if key not in nodes:
                    if len(nodes)>=limit:truncated=True;continue
                    resolved=target(c,*key);nodes[key]=resolved or dict(kind=key[0],id=key[1],title='Original target unavailable',unavailable=True)
                    if resolved:following.append(key)
                if len(edges)>=limit:truncated=True;continue
                edges[row['id']]=row
        front=following
    return dict(root=root,nodes=list(nodes.values()),edges=list(edges.values()),truncated=truncated,coverage='Explicit private connections and original note/source/curated references; no inferred similarity or scholarly consensus.')


def item(c,*,entity,id):
    if entity not in {'collection','view'}:raise ValueError('Unsupported organization item')
    return c.execute(sql.SQL('SELECT * FROM research.{} WHERE id=%s').format(sql.Identifier(TABLES[entity])),(id,)).fetchone()
