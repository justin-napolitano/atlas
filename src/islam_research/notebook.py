"""Private running thoughts plus a live projection of existing passage notes.

Thoughts are Markdown source, rendered as inert text by the initial reader. A
source_claim is an owner-attributed claim to investigate, never reviewed evidence.
"""
import hashlib
import json
import uuid

from . import database as db, passage_store

TYPES = {'note','question','source_claim','interpretation','objection'}


def _optional(value,name):
    return None if value is None else db._text(value,name,500)


def metadata(thought_type,title,body,links,state):
    if thought_type not in TYPES or state not in {'active','withdrawn'}: raise ValueError('Unknown thought type or state')
    title=db._text(title,'title',300);body=db._text(body,'body',20000)
    if not isinstance(links,list) or len(links)>25: raise ValueError('Supply at most 25 explicit links')
    seen=set();clean=[]
    for link in links:
        if not isinstance(link,dict) or set(link)!={'kind','id','rationale'} or link['kind'] not in {'record','annotation','entry'}:
            raise ValueError('Explicit connection kind, target and rationale required')
        identifier=db._text(link['id'],'link id',500);reason=db._text(link['rationale'],'link rationale',2000)
        key=(link['kind'],identifier)
        if key in seen: raise ValueError('Duplicate notebook connection')
        seen.add(key);clean.append(dict(kind=key[0],id=identifier,rationale=reason))
    return dict(thought_type=thought_type,title=title,body=body,links=clean,state=state)


def get(connection,project_id,entry_id):
    return connection.execute('''SELECT n.*,r.title AS source_title,r.deleted_at IS NULL AS source_active,
        d.edition,d.locator,d.text_sha256,a.exact AS selected_quote,a.start_pos,a.end_pos
        FROM research.notebook_entries n LEFT JOIN research.records r ON r.project_id=n.project_id AND r.id=n.record_id
        LEFT JOIN research.reading_documents d ON d.project_id=n.project_id AND d.id=n.document_id
        LEFT JOIN research.reading_annotations a ON a.project_id=n.project_id AND a.id=n.annotation_id
        WHERE n.project_id=%s AND n.id=%s''',(project_id,entry_id)).fetchone()


def create(connection,*,request_uuid,project_id,thought_type,title,body,links,actor,record_id=None,document_id=None,annotation_id=None):
    try:
        identifier=uuid.UUID(request_uuid)
        if identifier.version!=4 or str(identifier)!=request_uuid: raise ValueError()
    except (ValueError,TypeError,AttributeError): raise ValueError('Supply a new canonical UUID4 request identity') from None
    entry_id='urn:research:notebook:'+str(identifier)
    values=metadata(thought_type,title,body,links,'active');db._text(actor,'actor',500)
    record_id=_optional(record_id,'record id');document_id=_optional(document_id,'document id');annotation_id=_optional(annotation_id,'annotation id')
    if (document_id and not record_id) or (annotation_id and not document_id) or (thought_type=='source_claim' and not annotation_id):
        raise ValueError('A source claim needs its exact saved passage; document/annotation anchors need their source')
    payload=dict(**values,project_id=project_id,record_id=record_id,document_id=document_id,annotation_id=annotation_id,actor=actor)
    fingerprint=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    with connection.transaction():
        row=connection.execute('''INSERT INTO research.notebook_entries(id,project_id,creation_sha256,record_id,document_id,annotation_id,
            thought_type,title,body,links,changed_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO NOTHING RETURNING id''',
            (entry_id,project_id,fingerprint,record_id,document_id,annotation_id,thought_type,values['title'],values['body'],db.Jsonb(values['links']),actor)).fetchone()
        current=get(connection,project_id,entry_id)
        if current is None or current['creation_sha256']!=fingerprint: raise db.RevisionConflict(None)
        return dict(id=entry_id,project_id=project_id,revision=current['revision'],replayed=row is None)


def update(connection,*,project_id,entry_id,expected_revision,thought_type,title,body,links,state,actor):
    values=metadata(thought_type,title,body,links,state);db._text(actor,'actor',500)
    if type(expected_revision) is not int or expected_revision<1: raise ValueError('Supply the last confirmed notebook revision')
    with connection.transaction():
        row=connection.execute('''UPDATE research.notebook_entries SET thought_type=%s,title=%s,body=%s,links=%s,state=%s,
            changed_by=%s,revision=revision+1 WHERE project_id=%s AND id=%s AND revision=%s RETURNING id''',
            (thought_type,values['title'],values['body'],db.Jsonb(values['links']),state,actor,project_id,entry_id,expected_revision)).fetchone()
        current=get(connection,project_id,entry_id)
        if row: return current
        if current and current['revision']==expected_revision+1 and current['changed_by']==actor and all(current[k]==v for k,v in values.items()): return current
        raise db.RevisionConflict(current)


def history(connection,project_id,entry_id,before_revision,limit):
    if get(connection,project_id,entry_id) is None:return None
    return connection.execute('''SELECT revision,snapshot FROM research.notebook_revisions WHERE project_id=%s AND entry_id=%s
        AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s''',(project_id,entry_id,before_revision,before_revision,limit)).fetchall()


def items(connection,project_id,q,thought_type,state,cursor,limit):
    if thought_type not in TYPES|{'','passage_note'} or state not in {'active','withdrawn'}:raise ValueError('Unknown notebook filter')
    db._text(q,'query',300,empty=True);db._text(cursor,'cursor',1100,empty=True)
    # Existing passage bodies are projected from their sole existing authority.
    return connection.execute('''WITH thoughts AS (
        SELECT 'entry' AS item_kind,n.id,n.project_id,n.thought_type,n.title,n.body,n.state,n.revision,n.updated_at,
            n.record_id,n.document_id,n.annotation_id,r.title AS source_title,d.edition,d.locator,a.exact AS selected_quote,
            'entry:'||n.id AS cursor FROM research.notebook_entries n
        LEFT JOIN research.records r ON r.project_id=n.project_id AND r.id=n.record_id
        LEFT JOIN research.reading_documents d ON d.project_id=n.project_id AND d.id=n.document_id
        LEFT JOIN research.reading_annotations a ON a.project_id=n.project_id AND a.id=n.annotation_id WHERE n.project_id=%s
        UNION ALL
        SELECT 'passage_note',a.id,a.project_id,'passage_note',r.title,a.body,'active',a.revision,a.updated_at,
            r.id,d.id,a.id,r.title,d.edition,d.locator,a.exact,'passage_note:'||a.id
        FROM research.reading_annotations a JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE a.project_id=%s AND btrim(a.body)<>'' AND r.deleted_at IS NULL)
        SELECT * FROM thoughts WHERE state=%s AND (%s='' OR thought_type=%s) AND cursor>%s
        AND (%s='' OR to_tsvector('simple',title||' '||body||' '||coalesce(selected_quote,'')) @@ plainto_tsquery('simple',%s))
        ORDER BY cursor LIMIT %s''',(project_id,project_id,state,thought_type,thought_type,cursor,q,q,limit)).fetchall()
