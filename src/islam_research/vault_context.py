"""Bounded source-context snapshots. No original document text or implicit imports."""
from __future__ import annotations

import html
import json
import re
import uuid

from . import database as db, passage_store, workspace_store

BIBLIOGRAPHY = ('creators','translators','publication','publication_date','edition','identifier','source_url','rights_status','rights_basis','coverage_scope','rights_notice','language')
RESOURCE = ('quran_resource','resource_id','source_sha256','license_url','provider','gutenberg_id')
MAX_BYTES = 65536


def bibliography(attributes):
    """Project known intake/catalog declarations, without copying arbitrary attributes."""
    values=attributes.get('source_intake',{})
    if not isinstance(values,dict):raise ValueError('Unsupported source declaration metadata')
    result={key:values[key] for key in BIBLIOGRAPHY if key in values}
    for key in BIBLIOGRAPHY:
        value=attributes.get(key)
        if key not in result and value is not None:
            if isinstance(value,list) and all(isinstance(part,str) for part in value):value='; '.join(value)
            result[key]=value
    if 'publication_date' not in result and attributes.get('release_date'):result['publication_date']=attributes['release_date']
    return result


def _text(value, maximum=2000, *, empty=True):
    if not isinstance(value,str) or len(value)>maximum or (not empty and not value.strip()) or '\0' in value:
        raise ValueError('Invalid source context text')


def _id(value):
    _text(value,500,empty=False)
    if any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid source context identity')


def _keys(value, expected):
    if not isinstance(value,dict) or set(value)!=set(expected.split()):raise ValueError('Unsupported source context fields')


def _hash(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Invalid source fingerprint')


def validate(context):
    """Reject unknown profiles/keys and dangling or internally inconsistent bindings."""
    _keys(context,'format binding sources documents annotations')
    if type(context['format']) is not int or context['format']!=1:raise ValueError('Unsupported source context version')
    if len(json.dumps(context,ensure_ascii=False,allow_nan=False).encode())>MAX_BYTES:raise ValueError('Source context exceeds the export limit')
    binding=context['binding'];_keys(binding,'record_id document_id annotation_id reading_position quran_context')
    tables={}
    for name in ('sources','documents','annotations'):
        rows=context[name]
        if not isinstance(rows,list) or len(rows)>26:raise ValueError('Too many source dependencies')
        tables[name]={}
        for row in rows:
            if not isinstance(row,dict):raise ValueError('Invalid source dependency')
            _id(row.get('id'))
            if row['id'] in tables[name]:raise ValueError('Duplicate source dependency')
            tables[name][row['id']]=row
    for source in context['sources']:
        _keys(source,'id project_id kind title application_revision bibliography resource library')
        if source['project_id'] is not None:_id(source['project_id'])
        if source['kind'] not in ('source','work','edition'):raise ValueError('Unsupported source kind')
        _text(source['title'],2000,empty=False)
        if type(source['application_revision']) is not int or source['application_revision']<1:raise ValueError('Invalid source revision')
        for name,allowed in (('bibliography',BIBLIOGRAPHY),('resource',RESOURCE),('library',('work_id','item_id'))):
            if not isinstance(source[name],dict) or not set(source[name])<=set(allowed):raise ValueError('Unsupported source metadata')
            for key,value in source[name].items():
                if name=='resource' and key=='gutenberg_id':
                    if type(value) is not int or value<1:raise ValueError('Invalid catalog identity')
                else:_text(value)
    if not context['sources']:raise ValueError('Source context needs at least one source')
    for document in context['documents']:
        _keys(document,'id project_id source_record_id edition locator representation_url text_sha256 input_sha256 normalization text_length source_notice library artifacts')
        source=tables['sources'].get(document['source_record_id'])
        if not source or document['project_id']!=source['project_id']:raise ValueError('Document source is outside the snapshot')
        for name,limit in (('edition',1000),('locator',2000),('representation_url',2000),('normalization',500),('source_notice',8000)):_text(document[name],limit)
        for name in ('text_sha256','input_sha256'):_hash(document[name])
        if type(document['text_length']) is not int or not 1<=document['text_length']<=12000:raise ValueError('Invalid document length')
        if not isinstance(document['library'],dict) or not set(document['library'])<= {'work_id','edition_id','representation_id'}:raise ValueError('Unsupported edition identities')
        for value in document['library'].values():_id(value)
        if document['library'].get('work_id')!=source['library'].get('work_id'):raise ValueError('Edition belongs to a different work')
        if not isinstance(document['artifacts'],list) or len(document['artifacts'])>10:raise ValueError('Too many original artifact references')
        for artifact in document['artifacts']:
            _keys(artifact,'id sha256 bytes included');_id(artifact['id']);_hash(artifact['sha256'])
            if type(artifact['bytes']) is not int or artifact['bytes']<0 or artifact['included'] is not False:raise ValueError('Original artifacts are reference-only')
    for annotation in context['annotations']:
        _keys(annotation,'id project_id document_id text_sha256 start_pos end_pos exact prefix suffix capture_kind body mark_style application_revision')
        try:
            identity=uuid.UUID(annotation['id'].removeprefix('urn:research:annotation:'))
            if annotation['id']!='urn:research:annotation:'+str(identity) or identity.version!=4:raise ValueError()
        except (ValueError,AttributeError):raise ValueError('Invalid annotation identity') from None
        doc=tables['documents'].get(annotation['document_id'])
        if not doc or annotation['project_id']!=doc['project_id'] or annotation['text_sha256']!=doc['text_sha256']:raise ValueError('Annotation document does not match')
        start,end=annotation['start_pos'],annotation['end_pos']
        if type(start) is not int or type(end) is not int or not 0<=start<end<=doc['text_length'] or end-start>500:raise ValueError('Invalid exact passage range')
        _text(annotation['exact'],500,empty=False)
        if len(annotation['exact'])!=end-start:raise ValueError('Quotation does not match its range')
        for name,limit in (('prefix',40),('suffix',40),('body',10000)):_text(annotation[name],limit)
        if annotation['capture_kind'] not in ('comment','term_candidate','citation_candidate') or annotation['mark_style'] not in ('highlight','underline','none'):raise ValueError('Unsupported annotation kind')
        if type(annotation['application_revision']) is not int or annotation['application_revision']<1:raise ValueError('Invalid annotation revision')
    for field,table in (('record_id','sources'),('document_id','documents'),('annotation_id','annotations')):
        if binding[field] is not None and binding[field] not in tables[table]:raise ValueError('Missing bound source dependency')
    doc=tables['documents'].get(binding['document_id']);mark=tables['annotations'].get(binding['annotation_id'])
    if doc and doc['source_record_id']!=binding['record_id'] or mark and mark['document_id']!=binding['document_id']:raise ValueError('Inconsistent source binding')
    position=binding['reading_position']
    if position is not None and (type(position) is not int or not doc or mark or not 0<=position<=doc['text_length']):raise ValueError('Invalid note position')
    q=binding['quran_context']
    if q is not None:
        _keys(q,'resource_key note_scope chapter ayah_start ayah_end')
        from .quran_workspace import _representation
        if q['note_scope'] not in ('source','surah','verse'):raise ValueError('Invalid Quran note scope')
        if q['note_scope']=='source' and any(q[k] is not None for k in ('chapter','ayah_start','ayah_end')):raise ValueError('Invalid whole-source location')
        if q['note_scope']=='surah' and (type(q['chapter']) is not int or not 1<=q['chapter']<=114 or q['ayah_start'] is not None or q['ayah_end'] is not None):raise ValueError('Invalid surah location')
        if q['note_scope']=='verse' and any(type(q[k]) is not int for k in ('chapter','ayah_start','ayah_end')):raise ValueError('Invalid verse location')
        source=tables['sources'].get(binding['record_id'])
        if not source or source['resource'].get('quran_resource')!=q['resource_key']:raise ValueError('Quran resource binding differs')
        value=_representation(q['resource_key'],q['chapter'] or 1,q['ayah_start'] or 1,q['ayah_end'] or 1,q['note_scope'])
        if doc and value.get('text_sha256')!=doc['text_sha256']:raise ValueError('Quran representation differs')
    return context


def capture(c,row):
    """Read only dependencies bound to this note or its explicit typed links."""
    if row.get('project_id') is not None:raise ValueError('Legacy project writing remains local')
    q=row.get('quran_context')
    binding={name:row.get(name) for name in ('record_id','document_id','annotation_id','reading_position')}
    binding['quran_context']={key:q[key] for key in ('resource_key','note_scope','chapter','ayah_start','ayah_end')} if q else None
    sources={};documents={};annotations={}
    def source(identifier):
        if identifier in sources:return
        value=c.execute("SELECT * FROM research.records WHERE id=%s AND deleted_at IS NULL AND review_state<>'withdrawn'",(identifier,)).fetchone()
        if not value or value['kind'] not in ('source','work','edition'):raise ValueError('A linked source is unavailable or unsupported')
        attrs=value['attributes'];declared=bibliography(attrs)
        library=c.execute('SELECT work_id,item_id FROM research.library_source_bindings WHERE source_record_id=%s',(identifier,)).fetchone()
        sources[identifier]=dict(id=identifier,project_id=value['project_id'],kind=value['kind'],title=value['title'],application_revision=value['revision'],
            bibliography=declared,resource={k:attrs[k] for k in RESOURCE if k in attrs},library=dict(library) if library else {})
    def document(identifier):
        if identifier in documents:return
        value=passage_store.get_document(c,None,identifier)
        if not value:raise ValueError('The original document binding is unavailable')
        source(value['source_record_id'])
        library=c.execute('SELECT b.work_id,r.edition_id,b.representation_id FROM research.library_document_bindings b JOIN research.library_representations r ON r.id=b.representation_id WHERE b.document_id=%s',(identifier,)).fetchone()
        artifacts=c.execute('SELECT id,sha256,bytes FROM research.desktop_artifacts WHERE document_ids ? %s ORDER BY id LIMIT 11',(identifier,)).fetchall()
        documents[identifier]={k:value[k] for k in ('id','project_id','source_record_id','edition','locator','representation_url','text_sha256','input_sha256','normalization','source_notice')}
        documents[identifier].update(text_length=len(value['text_body']),library=dict(library) if library else {},artifacts=[dict(id=str(a['id']),sha256=a['sha256'],bytes=a['bytes'],included=False) for a in artifacts])
    def annotation(identifier):
        if identifier in annotations:return
        value=passage_store.annotation(c,None,identifier)
        if not value or not value['anchor']['anchored']:raise ValueError('The exact passage is unavailable')
        a=value['annotation']
        trashed=c.execute("SELECT 1 FROM research.workspace_annotation_trash WHERE annotation_id=%s AND state='trashed' UNION ALL SELECT 1 FROM research.note_trash WHERE target_kind='annotation' AND target_id=%s AND state='trashed'",(identifier,identifier)).fetchone()
        if trashed:raise ValueError('A referenced passage is in Trash')
        document(a['document_id'])
        annotations[identifier]={k:a[k] for k in ('id','project_id','document_id','text_sha256','start_pos','end_pos','exact','prefix','suffix','capture_kind','body','mark_style')}
        annotations[identifier]['application_revision']=a['revision']
    if binding['record_id']:source(binding['record_id'])
    if binding['document_id']:document(binding['document_id'])
    if binding['annotation_id']:annotation(binding['annotation_id'])
    for link in row.get('links',[]):
        if link['kind']=='record':source(link['id'])
        elif link['kind']=='annotation':annotation(link['id'])
    if not sources:return None
    result=dict(format=1,binding=binding,sources=sorted(sources.values(),key=lambda r:r['id']),documents=sorted(documents.values(),key=lambda r:r['id']),annotations=sorted(annotations.values(),key=lambda r:r['id']))
    return validate(result)


def citation(context):
    """An inert readable companion, kept separate from exact saved note Markdown."""
    validate(context)
    lines=['# Source context','', 'Generated citation context; the saved note text is in the adjacent note file.','']
    # Quote every metadata line as text; do not manufacture Markdown links/HTML.
    def literal(label,value):
        if value is not None and value!='':
            safe=re.sub(r'([\\`*_\[\]#!|~])',r'\\\1',html.escape(str(value),quote=False))
            lines.extend('> '+line for line in (label+': '+safe).splitlines());lines.append('')
    for source in context['sources']:
        literal('Source',source['title']);literal('Source ID',source['id'])
        for key,value in sorted(source['bibliography'].items()):literal(key.replace('_',' ').capitalize(),value)
    for doc in context['documents']:
        for key in ('edition','locator','representation_url','id','text_sha256','source_notice'):literal(key.replace('_',' ').capitalize(),doc[key])
        literal('Original document','Not included; required separately for exact reader reconstruction')
        for artifact in doc['artifacts']:literal('Original artifact reference',artifact['id']+' / SHA-256 '+artifact['sha256'])
    for a in context['annotations']:
        literal('Passage ID',a['id']);literal('Character range',str(a['start_pos'])+'–'+str(a['end_pos']));literal('Exact quotation',a['exact'])
    if context['binding']['reading_position'] is not None:literal('Note position (not reading progress)',context['binding']['reading_position'])
    if context['binding']['quran_context']:literal('Quran scope',json.dumps(context['binding']['quran_context'],ensure_ascii=False,sort_keys=True))
    return ('\n'.join(lines)+'\n').encode('utf-8')


def dependency_problem(c,context):
    """Describe a missing or conflicting dependency without writing any records."""
    validate(context)
    for source in context['sources']:
        row=c.execute('SELECT * FROM research.records WHERE id=%s',(source['id'],)).fetchone()
        if row and (row['deleted_at'] is not None or row['review_state']=='withdrawn' or row['project_id']!=source['project_id'] or row['kind']!=source['kind'] or row['title']!=source['title']):return 'Current source identity or bibliography differs'
        if row and (any(bibliography(row['attributes']).get(k)!=v for k,v in source['bibliography'].items()) or any(row['attributes'].get(k)!=v for k,v in source['resource'].items())):return 'Current source bibliography or representation differs'
        if row and source['library']:
            library=c.execute('SELECT work_id,item_id FROM research.library_source_bindings WHERE source_record_id=%s',(source['id'],)).fetchone()
            if not library or dict(library)!=source['library']:return 'Current library work identity differs'
        if source['project_id'] is not None and not c.execute('SELECT 1 FROM research.projects WHERE id=%s',(source['project_id'],)).fetchone():return 'Original project context is unavailable'
    for doc in context['documents']:
        row=passage_store.get_document(c,None,doc['id'])
        if row is None:return 'Original document is required separately; its text was not exported'
        if any(row[k]!=doc[k] for k in ('project_id','source_record_id','edition','locator','representation_url','text_sha256','input_sha256','normalization','source_notice')) or len(row['text_body'])!=doc['text_length']:return 'Current document edition or fingerprint differs'
        if doc['library']:
            library=c.execute('SELECT b.work_id,r.edition_id,b.representation_id FROM research.library_document_bindings b JOIN research.library_representations r ON r.id=b.representation_id WHERE b.document_id=%s',(doc['id'],)).fetchone()
            if not library or dict(library)!=doc['library']:return 'Current library edition identity differs'
    for mark in context['annotations']:
        row=passage_store.annotation(c,None,mark['id'])
        if row and (not row['anchor']['anchored'] or any(row['annotation'][k]!=mark[k] for k in ('project_id','document_id','text_sha256','start_pos','end_pos','exact','prefix','suffix','capture_kind','body','mark_style'))):return 'Current passage anchor or annotation differs'
        if row and local(c,mark['id'])['trashed']:return 'Current passage is in Trash'
    return None


def restore_dependencies(c,pages,*,actor,documents=None):
    """Explicit internal reconstruction; callers wrap this in their import transaction.

    Missing source text must be supplied separately and match both fingerprints.
    Never create dummy documents or infer an edition from its title.
    """
    documents=documents or {};sources={};snapshots={};annotations={}
    for page in pages:
        ctx=page.get('source_context')
        if not ctx:continue
        validate(ctx)
        for name,target in (('sources',sources),('documents',snapshots),('annotations',annotations)):
            for value in ctx[name]:
                old=target.get(value['id'])
                if old is not None and old!=value:raise ValueError('Conflicting dependency snapshots')
                target[value['id']]=value
        problem=dependency_problem(c,ctx)
        if problem and problem!='Original document is required separately; its text was not exported':raise ValueError(problem)
    # Validate all separately supplied originals before creating any dependencies.
    from .passages import normalize_excerpt
    for value in snapshots.values():
        if passage_store.get_document(c,None,value['id']) is None:
            raw=documents.get(value['id'])
            if not isinstance(raw,str):raise ValueError('Original document required separately for reconstruction')
            normalized=normalize_excerpt(raw)
            if any(normalized[k]!=value[k] for k in ('text_sha256','input_sha256','normalization')) or len(normalized['text'])!=value['text_length']:raise ValueError('Original document fingerprint differs')
    for source in sources.values():
        old=c.execute('SELECT id FROM research.records WHERE id=%s',(source['id'],)).fetchone()
        if old:continue
        attributes={**source['resource']}
        if source['bibliography']:attributes['source_intake']=source['bibliography']
        db.save_record(c,record_id=source['id'],project_id=source['project_id'],kind=source['kind'],title=source['title'],actor=actor,attributes=attributes)
    for value in snapshots.values():
        if passage_store.get_document(c,None,value['id']) is None:
            passage_store.create_document(c,project_id=value['project_id'],source_record_id=value['source_record_id'],edition=value['edition'],locator=value['locator'],representation_url=value['representation_url'],text=documents[value['id']],source_notice=value['source_notice'],document_id=value['id'],actor=actor)
    for source in sources.values():
        if source['library']:c.execute('SELECT research.index_library_source(%s)',(source['id'],))
    for value in annotations.values():
        if passage_store.annotation(c,None,value['id']) is None:
            result=passage_store.create_annotation(c,annotation_uuid=value['id'].rsplit(':',1)[1],project_id=value['project_id'],document_id=value['document_id'],text_sha256=value['text_sha256'],start=value['start_pos'],end=value['end_pos'],exact=value['exact'],capture_kind=value['capture_kind'],body=value['body'],mark_style=value['mark_style'],actor=actor)
            if result['prefix']!=value['prefix'] or result['suffix']!=value['suffix']:raise ValueError('Original quote context differs')
    for page in pages:
        if page.get('source_context'):
            problem=dependency_problem(c,page['source_context'])
            if problem:raise ValueError(problem)


def local(c,identifier):
    """Project an annotation without creating a second saved note body."""
    if not identifier.startswith('urn:research:annotation:'):return workspace_store.note(c,identifier)
    bundle=passage_store.annotation(c,None,identifier)
    if not bundle:return None
    a=bundle['annotation'];document=passage_store.get_document(c,None,a['document_id'])
    trashed=c.execute("SELECT 1 FROM research.workspace_annotation_trash WHERE annotation_id=%s AND state='trashed' UNION ALL SELECT 1 FROM research.note_trash WHERE target_kind='annotation' AND target_id=%s AND state='trashed'",(identifier,identifier)).fetchone()
    return dict(id=identifier,item_kind='annotation',project_id=a['project_id'],record_id=document['source_record_id'],document_id=a['document_id'],
        annotation_id=identifier,reading_position=None,body=a['body'],revision=a['revision'],title=a['exact'][:300],title_mode='manual',thought_type='note',links=[],state='active',trashed=bool(trashed))


def portable(c,row):
    """Freeze context with the page. No mutation or best-effort reassociation."""
    from . import vault_format as codec
    if row.get('trashed') or row.get('project_id') is not None:raise ValueError(codec.exclusion(row))
    result=dict(row);context=capture(c,row)
    if context:result['source_context']=context
    return result
