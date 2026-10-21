"""Metadata-first desktop capture. No fetch, parser execution or editable file mirror."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import uuid

from . import database as db, workspace_store as workspace, shared_library, source_intake, passage_store

MAX_FILE=32768


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def _receipt(connection,request_uuid,actor,value,action):
    request=uuid.UUID(request_uuid)
    if request.version!=4:raise ValueError('Retain a UUIDv4 for this save')
    db._text(actor,'actor',500)
    digest=_fingerprint(dict(action=action,actor=actor,value=value))
    connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('desktop:'+str(request),))
    old=connection.execute('SELECT * FROM research.desktop_requests WHERE request_uuid=%s',(request,)).fetchone()
    if old and (old['input_sha256']!=digest or old['changed_by']!=actor):
        raise ValueError('This save ID belongs to different input. Keep the original request for retry.')
    return request,digest,old


def _commit(connection,request,digest,result,actor):
    connection.execute('INSERT INTO research.desktop_requests(request_uuid,input_sha256,result,changed_by) VALUES(%s,%s,%s,%s)',
        (request,digest,db.Jsonb(result),actor))
    return {**result,'replayed':False}


def reference(connection,*,request_uuid,reference,actor,existing_source_record_id=None,distinct_reason=''):
    db._text(reference,'reference',2000);reference=reference.strip()
    db._text(distinct_reason,'distinct edition reason',2000,empty=True)
    source_url=reference if re.match(r'^https?://',reference,re.I) else ''
    identifier=reference if re.match(r'^(?:doi:|10\.\d{4,9}/|https?://(?:dx\.)?doi\.org/)',reference,re.I) else ''
    keys=source_intake.identity_keys(source_url,identifier)
    value=dict(reference=reference,existing_source_record_id=existing_source_record_id,distinct_reason=distinct_reason)
    with connection.transaction():
        request,digest,old=_receipt(connection,request_uuid,actor,value,'reference-v1')
        if old:return {**old['result'],'replayed':True}
        # Serialize equal identity candidates across requests without merging them.
        for key in sorted(k for k in keys if k):connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('workspace:owner:'+key,))
        if existing_source_record_id:
            if not workspace.source(connection,record_id=existing_source_record_id):raise ValueError('Source unavailable')
            record_id=existing_source_record_id
        else:
            matches=source_intake.candidates(connection,None,source_url,identifier)
            if matches and not distinct_reason.strip():raise ValueError('Choose the existing reference or explain the distinct edition.')
            record_id='urn:research:source:'+str(request)
            metadata=dict(source_url=source_url,identifier=identifier,url_key=keys[0],identifier_key=keys[1],
                metadata_origin='owner_declared_reference',identity_resolution='unresolved',edition='',
                title_status='reference_label' if source_url or identifier else 'owner_declared',
                access_status='unknown',rights_status='metadata_only',coverage_scope='metadata_only',
                intake_version=2,distinct_source_rationale=distinct_reason)
            db.save_record(connection,record_id=record_id,project_id=None,kind='source',title=reference,
                actor=actor,attributes={'source_intake':metadata})
        workspace.retain_source(connection,record_id,actor,reading_status='want_to_read')
        return _commit(connection,request,digest,dict(record_id=record_id,project_id=None,document_id=None),actor)


def related(connection,*,record_id,cursor='',limit=30):
    source=workspace.source(connection,record_id=record_id)
    if not source:raise ValueError('Source unavailable')
    db._text(cursor,'cursor',1200,empty=True)
    if type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid page size')
    item=source['library']
    if not item:return dict(items=[],next_cursor=None)
    # Reuse existing reading-note projections, then include all explicitly linked
    # loose writing in either direction. Associations are not evidence claims.
    rows=connection.execute('WITH base AS ('+shared_library.NOTES_SQL+'''SELECT * FROM notes), linked AS (
      SELECT 'entry:'||n.id AS note_key,'entry' AS item_kind,n.id,n.title,n.body,n.thought_type,n.revision,
        n.project_id AS origin_project_id,n.document_id,n.annotation_id,n.reading_position
      FROM research.notebook_entries n WHERE n.state='active' AND (
       EXISTS(SELECT 1 FROM research.workspace_connections x WHERE x.state<>'withdrawn' AND
        ((x.from_kind='entry' AND x.from_id=n.id AND x.to_kind='record' AND x.to_id=%s) OR
         (x.to_kind='entry' AND x.to_id=n.id AND x.from_kind='record' AND x.from_id=%s))) OR
       EXISTS(SELECT 1 FROM jsonb_array_elements(n.links) l WHERE l->>'kind'='record' AND l->>'id'=%s))
       AND NOT EXISTS(SELECT 1 FROM research.workspace_note_trash t WHERE t.entry_id=n.id AND t.state='trashed')
       AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed')
    ), combined AS (
      SELECT note_key,item_kind,id,title,body,thought_type,revision,project_id AS origin_project_id,document_id,annotation_id,reading_position FROM base
      UNION SELECT * FROM linked
      UNION SELECT 'record:'||r.id,'record',r.id,r.title,r.summary,'question',r.revision,r.project_id,NULL,NULL,NULL
       FROM research.records r WHERE r.kind='question' AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
       AND EXISTS(SELECT 1 FROM research.workspace_connections x WHERE x.state<>'withdrawn' AND
        ((x.from_kind='record' AND x.from_id=r.id AND x.to_kind='record' AND x.to_id=%s) OR
         (x.to_kind='record' AND x.to_id=r.id AND x.from_kind='record' AND x.from_id=%s)))
    ) SELECT * FROM combined WHERE note_key>%s ORDER BY note_key LIMIT %s''',
      ([item['item_id']],record_id,record_id,record_id,record_id,record_id,cursor,limit+1)).fetchall()
    return dict(items=rows[:limit],next_cursor=rows[limit-1]['note_key'] if len(rows)>limit else None)


def metadata(connection,*,request_uuid,record_id,expected_revision,title,creators,edition,actor):
    for value,name,size in [(title,'title',2000),(creators,'creators',2000),(edition,'edition',1000)]:
        db._text(value,name,size,empty=name!='title')
    if type(expected_revision) is not int or expected_revision<1:raise ValueError('Supply the saved source revision')
    value=dict(record_id=record_id,expected_revision=expected_revision,title=title,creators=creators,edition=edition)
    with connection.transaction():
        request,digest,old=_receipt(connection,request_uuid,actor,value,'metadata-v1')
        if old:return {**old['result'],'replayed':True}
        source=workspace.source(connection,record_id=record_id)
        if not source:raise ValueError('Source unavailable')
        row=source['record']
        if row['revision']!=expected_revision:raise db.RevisionConflict(row)
        attributes={**row['attributes']}
        attributes['source_intake']={**attributes.get('source_intake',{}),'creators':creators,'edition':edition,
            'title_status':'owner_declared','metadata_origin':'owner_declared','review_effect':'none'}
        updated=db.save_record(connection,record_id=record_id,project_id=row['project_id'],kind=row['kind'],title=title,
            summary=row['summary'],attributes=attributes,actor=actor,expected_revision=expected_revision)
        return _commit(connection,request,digest,dict(record_id=record_id,revision=updated['revision']),actor)


def private_root(root):
    root=Path(root)
    if not root.is_absolute() or root.parent.is_symlink():raise ValueError('Private artifact storage required')
    created=not root.exists()
    root.mkdir(mode=0o700,exist_ok=True)
    info=root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise ValueError('Private artifact storage required')
    if created:
        fd=os.open(root.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    return root


def read_artifact(root,digest):
    if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid artifact key')
    target=private_root(root)/digest
    fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077 or not 0<info.st_size<=MAX_FILE:raise ValueError('Private artifact is unavailable')
        data=stream.read(MAX_FILE+1)
    if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Artifact verification failed')
    return data


def write_artifact(root,data):
    root=private_root(root);digest=hashlib.sha256(data).hexdigest()
    if (root/digest).exists():
        read_artifact(root,digest);return digest
    fd,name=tempfile.mkstemp(prefix='.pending-',dir=root)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        try:os.link(name,root/digest)  # atomic create, never replace another version
        except FileExistsError:read_artifact(root,digest)
        directory=os.open(root,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:Path(name).unlink(missing_ok=True)
    return digest


def ingest(connection,*,artifact_root,request_uuid,filename,content_base64,intent,rights_basis,actor,record_id=None):
    db._text(filename,'filename',255);db._text(rights_basis,'retention rights basis',2000)
    if filename!=Path(filename).name or '/' in filename or '\\' in filename:raise ValueError('Use a filename without a path')
    suffix=Path(filename).suffix.lower()
    if suffix not in {'.md','.markdown','.txt'} or intent not in {'source','note'}:raise ValueError('Choose a Markdown or plain-text source or note')
    try:data=base64.b64decode(content_base64,validate=True)
    except (ValueError,TypeError):raise ValueError('Invalid file encoding') from None
    if not 0<len(data)<=MAX_FILE:raise ValueError('Files must be between 1 byte and 32 KiB')
    try:text=data.decode('utf-8-sig')
    except UnicodeError:raise ValueError('Use a UTF-8 text file') from None
    if not text.strip() or any(ord(c)<32 and c not in '\t\r\n' for c in text):raise ValueError('Use a non-empty UTF-8 text document')
    if intent=='note' and len(text)>20000:raise ValueError('Editable notes support up to 20,000 characters; retain this file as a source instead')
    if record_id and not workspace.source(connection,record_id=record_id):raise ValueError('Source unavailable')
    sha=hashlib.sha256(data).hexdigest()
    value=dict(filename=filename,sha256=sha,intent=intent,rights_basis=rights_basis,record_id=record_id)
    with connection.transaction():
        request,digest,old=_receipt(connection,request_uuid,actor,value,'file-v1')
        if old:
            read_artifact(artifact_root,sha)
            return {**old['result'],'replayed':True}
        write_artifact(artifact_root,data)
        documents=[];entry_id=None
        if intent=='note':
            note=workspace.create_note(connection,request_uuid=str(request),body=text,actor=actor,record_id=record_id)
            entry_id=note['id'];artifact_record=None
        else:
            if not record_id:
                record_id='urn:research:source:'+str(request)
                db.save_record(connection,record_id=record_id,project_id=None,kind='source',title=filename,actor=actor,
                    attributes={'source_intake':dict(metadata_origin='owner_imported_file',edition='',identity_resolution='unresolved',rights_status='unknown',access_status='owned_copy')})
            source=workspace.source(connection,record_id=record_id);origin=source['record']['project_id']
            for start in range(0,len(text),10000):
                chunk=text[start:start+10000]
                if not chunk.strip():continue
                doc=passage_store.create_document(connection,project_id=origin,source_record_id=record_id,
                    edition='Imported digital file · SHA-256 '+sha,locator=f'Characters {start+1}–{start+len(chunk)} of retained file',
                    text=chunk,representation_url='',actor=actor,source_notice='Owner-retained file. Bibliographic edition unverified. '+rights_basis)
                documents.append(doc['id'])
            connection.execute('SELECT research.index_library_source(%s)',(record_id,))
            workspace.retain_source(connection,record_id,actor,reading_status='want_to_read')
            artifact_record=record_id
        connection.execute('''INSERT INTO research.desktop_artifacts(id,sha256,bytes,filename,media_type,record_id,entry_id,document_ids,rights_basis,changed_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
          (request,sha,len(data),filename,'text/plain' if suffix=='.txt' else 'text/markdown',artifact_record,entry_id,db.Jsonb(documents),rights_basis,actor))
        return _commit(connection,request,digest,dict(artifact_id=str(request),sha256=sha,record_id=record_id,
            entry_id=entry_id,document_id=documents[0] if documents else None),actor)


def artifacts(connection,*,record_id):
    if not workspace.source(connection,record_id=record_id):raise ValueError('Source unavailable')
    return connection.execute('SELECT id,filename,sha256,bytes,media_type,document_ids,created_at FROM research.desktop_artifacts WHERE record_id=%s ORDER BY created_at,id LIMIT 50',(record_id,)).fetchall()
