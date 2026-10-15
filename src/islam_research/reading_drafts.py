"""Private anchored unfinished writing; recovery never commits scholarly notes."""
import uuid
from . import database as db, passage_store
from .passages import anchor

IDENTITY = ('project_id','record_id','context_kind','document_id','annotation_id','text_sha256','start_pos','end_pos','exact','prefix','suffix','capture_kind','base_revision')
SELECT = """SELECT f.*,r.title AS record_title,d.edition,d.locator FROM research.reading_drafts f
    JOIN research.records r ON r.project_id=f.project_id AND r.id=f.record_id
    LEFT JOIN research.reading_documents d ON d.project_id=f.project_id AND d.id=f.document_id
    WHERE r.deleted_at IS NULL"""


def identifier(draft_uuid):
    value=uuid.UUID(draft_uuid)
    if value.version!=4: raise ValueError('Retain a UUIDv4 draft identity when retrying')
    return 'urn:research:draft:'+str(value)


def get(connection,project_id,draft_id):
    return connection.execute(SELECT+' AND f.project_id=%s AND f.id=%s',(project_id,draft_id)).fetchone()


def listing(connection,project_id,record_id,document_id,annotation_id,context_kind,state,cursor,limit):
    return connection.execute(SELECT+''' AND f.project_id=%s AND f.state=%s AND f.id>%s
        AND (%s::text IS NULL OR f.record_id=%s) AND (%s::text IS NULL OR f.document_id=%s)
        AND (%s::text IS NULL OR f.annotation_id=%s) AND (%s::text IS NULL OR f.context_kind=%s)
        ORDER BY f.id LIMIT %s''',(project_id,state,cursor,record_id,record_id,document_id,document_id,annotation_id,annotation_id,context_kind,context_kind,limit)).fetchall()


def save(connection,*,draft_uuid,project_id,record_id,context_kind,document_id,annotation_id,text_sha256,start,end,exact,capture_kind,base_revision,body,mark_style,state,expected_revision,actor):
    draft_id=identifier(draft_uuid);db._text(actor,'actor',500);db._text(body,'draft body',10000,empty=True)
    if type(expected_revision) is not int or expected_revision<0 or type(base_revision) is not int or base_revision<0:
        raise ValueError('Supply confirmed draft and baseline revisions')
    if context_kind not in {'record_note','capture','annotation'} or state not in {'active','discarded'} or mark_style not in {'highlight','underline','none'}:
        raise ValueError('Unsupported private draft state')
    with connection.transaction():
        source=connection.execute('SELECT kind FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL',(project_id,record_id)).fetchone()
        if not source: raise ValueError('Active record not found in this project')
        values=dict(project_id=project_id,record_id=record_id,context_kind=context_kind,document_id=document_id,annotation_id=annotation_id,text_sha256=text_sha256,start_pos=start,end_pos=end,exact=exact,prefix='',suffix='',capture_kind=capture_kind,base_revision=base_revision)
        if context_kind=='record_note':
            if any(value is not None for value in (document_id,annotation_id,text_sha256,start,end,capture_kind)) or exact or mark_style!='none':
                raise ValueError('Record-note drafts do not carry passage selectors')
        else:
            document=passage_store.get_document(connection,project_id,document_id)
            if source['kind'] not in {'source','work','edition'} or not document or document['source_record_id']!=record_id:
                raise ValueError('Draft document must belong to this active source')
            selection=anchor(document['text_body'],start,end)
            if selection['text_sha256']!=text_sha256 or selection['exact']!=exact: raise ValueError('Draft source version or quotation changed')
            values.update(prefix=selection['prefix'],suffix=selection['suffix'])
            if capture_kind not in {'comment','term_candidate','citation_candidate'}: raise ValueError('Unsupported capture kind')
            if context_kind=='capture' and (annotation_id is not None or base_revision!=0): raise ValueError('New passage drafts have no saved annotation baseline')
            if context_kind=='annotation':
                captured=passage_store.annotation(connection,project_id,annotation_id)
                if not captured or not captured['anchor']['anchored'] or any(captured['annotation'][key]!=values[key] for key in ('document_id','text_sha256','start_pos','end_pos','exact','capture_kind')):
                    raise ValueError('Draft does not match saved source annotation')
        current=get(connection,project_id,draft_id)
        if current and any(current[key]!=values[key] for key in IDENTITY): raise ValueError('A draft identity cannot move to another source or baseline')
        fields=(*IDENTITY,'body','mark_style','state','changed_by')
        complete={**values,'body':body,'mark_style':mark_style,'state':state,'changed_by':actor}
        if expected_revision==0:
            from psycopg import sql
            row=connection.execute(sql.SQL('INSERT INTO research.reading_drafts (id,{}) VALUES (%s,{}) ON CONFLICT(id) DO NOTHING RETURNING id').format(sql.SQL(',').join(map(sql.Identifier,fields)),sql.SQL(',').join(sql.Placeholder() for _ in fields)),(draft_id,*(complete[key] for key in fields))).fetchone()
        else:
            row=connection.execute('''UPDATE research.reading_drafts SET body=%s,mark_style=%s,state=%s,changed_by=%s,revision=revision+1
                WHERE project_id=%s AND id=%s AND revision=%s RETURNING id''',(body,mark_style,state,actor,project_id,draft_id,expected_revision)).fetchone()
        if row: return get(connection,project_id,draft_id)
        current=get(connection,project_id,draft_id)
        if current and current['revision']==expected_revision+1 and all(current[key]==value for key,value in complete.items()):return current
        raise db.RevisionConflict(current)


def history(connection,project_id,draft_id,before_revision,limit):
    if get(connection,project_id,draft_id) is None:return None
    return connection.execute('''SELECT revision,snapshot FROM research.reading_draft_revisions WHERE draft_id=%s
        AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s''',(draft_id,before_revision,before_revision,limit)).fetchall()
