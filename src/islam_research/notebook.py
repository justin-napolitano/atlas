"""Private running thoughts plus a live projection of existing passage notes.

Thoughts are Markdown source, rendered as inert text by the initial reader. A
source_claim is an owner-attributed claim to investigate, never reviewed evidence.
"""
import hashlib
import json
import uuid

from . import database as db, passage_store

TYPES = {'note','question','source_claim','interpretation','objection','decision','principle'}


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
        (EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed') OR EXISTS(SELECT 1 FROM research.workspace_note_trash t WHERE t.entry_id=n.id AND t.state='trashed')) AS trashed,
        coalesce((SELECT t.revision FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id),(SELECT t.revision FROM research.workspace_note_trash t WHERE t.entry_id=n.id),0) AS trash_revision,
        d.edition,d.locator,d.text_sha256,a.exact AS selected_quote,a.start_pos,a.end_pos,to_jsonb(q) AS quran_context
        FROM research.notebook_entries n LEFT JOIN research.quran_note_contexts q ON q.project_id=n.project_id AND q.entry_id=n.id LEFT JOIN research.records r ON (n.project_id IS NULL OR r.project_id=n.project_id) AND r.id=n.record_id
        LEFT JOIN research.reading_documents d ON (n.project_id IS NULL OR d.project_id=n.project_id) AND d.id=n.document_id
        LEFT JOIN research.reading_annotations a ON (n.project_id IS NULL OR a.project_id=n.project_id) AND a.id=n.annotation_id
        WHERE (%s::text IS NULL OR n.project_id IS NOT DISTINCT FROM %s) AND n.id=%s''',(project_id,project_id,entry_id)).fetchone()


def network(connection,project_id,limit):
    """Bounded current private notes for explicit links and Markdown navigation.

    This is a projection, never an independently edited graph authority. Bodies
    are required for Markdown-aware wiki-link extraction; no revision history,
    actors, source document text, or other project rows are returned.
    """
    if type(limit) is not int or not 1 <= limit <= 201:
        raise ValueError('Notebook network limit must be between 1 and 201')
    return connection.execute('''SELECT id,project_id,title,body,thought_type,revision,
        record_id,document_id,annotation_id,reading_position,links FROM research.notebook_entries
        WHERE project_id=%s AND state='active' AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=notebook_entries.project_id AND t.target_kind='entry' AND t.target_id=notebook_entries.id AND t.state='trashed')
        ORDER BY updated_at DESC,id COLLATE "C" LIMIT %s''',(project_id,limit)).fetchall()


def _targets(connection,project_id,record_id,document_id,annotation_id,links):
    if record_id and not connection.execute('SELECT id FROM research.records WHERE (%s::text IS NULL OR project_id=%s) AND id=%s AND deleted_at IS NULL',(project_id,project_id,record_id)).fetchone():
        raise ValueError('Notebook source is unavailable in this project')
    if document_id:
        document=passage_store.get_document(connection,project_id,document_id)
        if not document or document['source_record_id']!=record_id:raise ValueError('Notebook document does not match its source')
    if annotation_id:
        bundle=passage_store.annotation(connection,project_id,annotation_id)
        if not bundle or not bundle['anchor']['anchored'] or bundle['annotation']['document_id']!=document_id:
            raise ValueError('Notebook thought needs its exact saved passage')
    for link in links:
        if link['kind']=='entry':
            row=get(connection,project_id,link['id']);found=row and row['state']=='active'
        elif link['kind']=='annotation':
            row=passage_store.annotation(connection,project_id,link['id']);found=row and row['anchor']['anchored']
        else:found=connection.execute('SELECT id FROM research.records WHERE (%s::text IS NULL OR project_id=%s) AND id=%s AND deleted_at IS NULL',(project_id,project_id,link['id'])).fetchone()
        if not found:raise ValueError('Notebook connection target is unavailable in this project')


def position_anchor(connection,project_id,record_id,document_id,annotation_id,reading_position):
    """A private organizational point, never a quotation or evidentiary anchor."""
    if reading_position is None:return
    if type(reading_position) is not int or reading_position<0 or not record_id or not document_id or annotation_id:
        raise ValueError('A reading position needs its source and document, without a passage annotation')
    document=passage_store.get_document(connection,project_id,document_id)
    if not document or document['source_record_id']!=record_id or reading_position>len(document['text_body']):
        raise ValueError('Reading position is outside its original document')


def create(connection,*,request_uuid,project_id,thought_type,title,body,links,actor,record_id=None,document_id=None,annotation_id=None,reading_position=None,title_mode='manual'):
    try:
        identifier=uuid.UUID(request_uuid)
        if identifier.version!=4 or str(identifier)!=request_uuid: raise ValueError()
    except (ValueError,TypeError,AttributeError): raise ValueError('Supply a new canonical UUID4 request identity') from None
    if title_mode not in {'automatic','manual'}:raise ValueError('Invalid title mode')
    entry_id='urn:research:notebook:'+str(identifier)
    values=metadata(thought_type,title,body,links,'active');db._text(actor,'actor',500)
    record_id=_optional(record_id,'record id');document_id=_optional(document_id,'document id');annotation_id=_optional(annotation_id,'annotation id')
    if (document_id and not record_id) or (annotation_id and not document_id) or (thought_type=='source_claim' and not annotation_id):
        raise ValueError('A source claim needs its exact saved passage; document/annotation anchors need their source')
    payload=dict(**values,project_id=project_id,record_id=record_id,document_id=document_id,annotation_id=annotation_id,actor=actor)
    if reading_position is not None:payload['reading_position']=reading_position
    if title_mode=='automatic':payload['title_mode']=title_mode
    fingerprint=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    with connection.transaction():
        existing=get(connection,project_id,entry_id)
        if existing:
            if existing['creation_sha256']!=fingerprint:raise db.RevisionConflict(None)
            return dict(id=entry_id,project_id=project_id,revision=existing['revision'],replayed=True)
        position_anchor(connection,project_id,record_id,document_id,annotation_id,reading_position)
        _targets(connection,project_id,record_id,document_id,annotation_id,values['links'])
        row=connection.execute('''INSERT INTO research.notebook_entries(id,project_id,creation_sha256,record_id,document_id,annotation_id,reading_position,
            thought_type,title,body,links,changed_by,title_mode) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO NOTHING RETURNING id''',
            (entry_id,project_id,fingerprint,record_id,document_id,annotation_id,reading_position,thought_type,values['title'],values['body'],db.Jsonb(values['links']),actor,title_mode)).fetchone()
        current=get(connection,project_id,entry_id)
        if current is None or current['creation_sha256']!=fingerprint: raise db.RevisionConflict(None)
        return dict(id=entry_id,project_id=project_id,revision=current['revision'],replayed=row is None)


def update(connection,*,project_id,entry_id,expected_revision,thought_type,title,body,links,state,actor,title_mode=None):
    values=metadata(thought_type,title,body,links,state);db._text(actor,'actor',500)
    if title_mode is not None:
        if title_mode not in {'automatic','manual'}:raise ValueError('Invalid title mode')
        values['title_mode']=title_mode
    if project_id is None:
        original=get(connection,None,entry_id)
        if original:project_id=original['project_id']
    if type(expected_revision) is not int or expected_revision<1: raise ValueError('Supply the last confirmed notebook revision')
    with connection.transaction():
        from .private_trash import assert_active
        assert_active(connection,project_id,'entry',entry_id)
        previous=get(connection,project_id,entry_id)
        if previous is None:raise db.RevisionConflict(None)
        if previous['revision']!=expected_revision:
            if previous['revision']==expected_revision+1 and previous['changed_by']==actor and all(previous[k]==v for k,v in values.items()):return previous
            raise db.RevisionConflict(previous)
        if thought_type=='source_claim' and not previous['annotation_id']:raise ValueError('A source claim needs an exact saved passage')
        _targets(connection,project_id,previous['record_id'],previous['document_id'],previous['annotation_id'],values['links'])
        row=connection.execute('''UPDATE research.notebook_entries SET thought_type=%s,title=%s,body=%s,links=%s,state=%s,
            changed_by=%s,title_mode=coalesce(%s,title_mode),revision=revision+1 WHERE project_id IS NOT DISTINCT FROM %s AND id=%s AND revision=%s RETURNING id''',
            (thought_type,values['title'],values['body'],db.Jsonb(values['links']),state,actor,title_mode,project_id,entry_id,expected_revision)).fetchone()
        current=get(connection,project_id,entry_id)
        if row: return current
        if current and current['revision']==expected_revision+1 and current['changed_by']==actor and all(current[k]==v for k,v in values.items()): return current
        raise db.RevisionConflict(current)


def history(connection,project_id,entry_id,before_revision,limit):
    if get(connection,project_id,entry_id) is None:return None
    return connection.execute('''SELECT revision,snapshot FROM research.notebook_revisions WHERE project_id IS NOT DISTINCT FROM %s AND entry_id=%s
        AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s''',(project_id,entry_id,before_revision,before_revision,limit)).fetchall()


def items(connection,project_id,q,thought_type,state,cursor,limit,item_scope="all",document_id=None,location_only=False):
    if thought_type not in TYPES|{'','passage_note','record_note'} or state not in {'active','withdrawn'}:raise ValueError('Unknown notebook filter')
    if item_scope not in {'all','writing','reading'}:raise ValueError('Unknown notebook collection')
    db._text(q,'query',300,empty=True);db._text(cursor,'cursor',1100,empty=True)
    # Existing passage bodies are projected from their sole existing authority.
    return connection.execute('''WITH thoughts AS (
        SELECT 'entry' AS item_kind,n.id,n.project_id,n.thought_type,n.title,n.body,n.state,n.revision,n.updated_at,
            n.record_id,n.document_id,n.annotation_id,n.reading_position,r.title AS source_title,d.edition,d.locator,a.exact AS selected_quote,
            n.links,coalesce((SELECT t.revision FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id),(SELECT t.revision FROM research.workspace_note_trash t WHERE t.entry_id=n.id),0) AS trash_revision,'entry:'||n.id AS item_key FROM research.notebook_entries n
        LEFT JOIN research.records r ON (n.project_id IS NULL OR r.project_id=n.project_id) AND r.id=n.record_id
        LEFT JOIN research.reading_documents d ON (n.project_id IS NULL OR d.project_id=n.project_id) AND d.id=n.document_id
        LEFT JOIN research.reading_annotations a ON (n.project_id IS NULL OR a.project_id=n.project_id) AND a.id=n.annotation_id WHERE n.project_id IS NOT DISTINCT FROM %s AND NOT EXISTS(SELECT 1 FROM research.workspace_note_trash w WHERE w.entry_id=n.id AND w.state='trashed') AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed')
        UNION ALL
        SELECT 'passage_note',a.id,a.project_id,'passage_note',r.title,a.body,'active',a.revision,a.updated_at,
            r.id,d.id,a.id,NULL::integer,r.title,d.edition,d.locator,a.exact,'[]'::jsonb,0,'passage_note:'||a.id
        FROM research.reading_annotations a JOIN research.reading_documents d ON d.project_id IS NOT DISTINCT FROM a.project_id AND d.id=a.document_id
        JOIN research.records r ON r.project_id IS NOT DISTINCT FROM d.project_id AND r.id=d.source_record_id
        WHERE a.project_id IS NOT DISTINCT FROM %s AND NOT EXISTS(SELECT 1 FROM research.workspace_annotation_trash w WHERE w.annotation_id=a.id AND w.state='trashed') AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=a.project_id AND t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed') AND btrim(a.body)<>'' AND r.deleted_at IS NULL
        UNION ALL
        SELECT 'record_note',p.record_id,p.project_id,'record_note',r.title,p.note,'active',p.revision,p.updated_at,
            r.id,NULL::text,NULL::text,NULL::integer,r.title,NULL::text,NULL::text,NULL::text,'[]'::jsonb,0,'record_note:'||r.id
        FROM research.personal_states p JOIN research.records r ON r.project_id IS NOT DISTINCT FROM p.project_id AND r.id=p.record_id
        WHERE p.project_id IS NOT DISTINCT FROM %s AND btrim(p.note)<>'' AND r.deleted_at IS NULL), ordered AS (
        SELECT thoughts.*,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||':'||item_key AS cursor FROM thoughts)
        SELECT * FROM ordered WHERE (%s::text IS NULL OR document_id=%s) AND (NOT %s OR reading_position IS NOT NULL) AND (%s='all' OR (%s='writing' AND item_kind='entry') OR (%s='reading' AND item_kind<>'entry')) AND state=%s AND (%s='' OR thought_type=%s) AND (%s='' OR cursor<%s)
        AND (%s='' OR to_tsvector('simple',title||' '||body||' '||coalesce(selected_quote,'')) @@ plainto_tsquery('simple',%s))
        ORDER BY cursor DESC LIMIT %s''',(project_id,project_id,project_id,document_id,document_id,location_only,item_scope,item_scope,item_scope,state,thought_type,thought_type,cursor,cursor,q,q,limit)).fetchall()
