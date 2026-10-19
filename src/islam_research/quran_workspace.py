"""Owner-private bindings to pinned text. No bibliography form or evidence promotion."""
import uuid
from . import database as db, quran_reader, passage_store, notebook
from .quran_citations import reference, PROFILE_ID


def existing(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end,note_scope="verse"):
    value=_representation(resource_key,chapter,ayah_start,ayah_end,note_scope)
    resource=value['resource']
    source_id='urn:research:source:'+str(uuid.uuid5(uuid.NAMESPACE_URL,project_id+'\nquran-reader\n'+resource['resource_id']))
    if note_scope!='verse':return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=None) if connection.execute('SELECT id FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL',(project_id,source_id)).fetchone() else None
    document=connection.execute('''SELECT d.* FROM research.reading_documents d JOIN research.records r
        ON r.project_id=d.project_id AND r.id=d.source_record_id WHERE d.project_id=%s AND d.source_record_id=%s
        AND d.locator=%s AND d.text_sha256=%s AND r.deleted_at IS NULL ORDER BY d.id LIMIT 1''',
        (project_id,source_id,value['reference']['label'],value['text_sha256'])).fetchone()
    if document is None:return None
    return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=document)


def binding(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end,actor,note_scope="verse"):
    value=_representation(resource_key,chapter,ayah_start,ayah_end,note_scope)
    resource=value['resource']
    source_id='urn:research:source:'+str(uuid.uuid5(uuid.NAMESPACE_URL,project_id+'\nquran-reader\n'+resource['resource_id']))
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(source_id,))
        attributes=dict(quran_resource=resource['key'],resource_id=resource['resource_id'],source_sha256=resource['sha256'],license_url=resource['license_url'])
        connection.execute('''INSERT INTO research.records(id,project_id,kind,title,attributes,changed_by)
            VALUES(%s,%s,'source',%s,%s,%s) ON CONFLICT(id) DO NOTHING''',(source_id,project_id,resource['label'],db.Jsonb(attributes),actor))
        source=connection.execute('SELECT * FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL',(project_id,source_id)).fetchone()
        if not source or source['kind']!='source' or any(source['attributes'].get(k)!=v for k,v in attributes.items()):
            raise ValueError('This resource binding requires reconciliation')
        if note_scope!='verse':return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=None)
        document=passage_store.create_document(connection,project_id=project_id,source_record_id=source_id,edition=resource['label']+' · '+resource['version'],
            locator=value['reference']['label'],representation_url=resource['source_url'],text=value['text'],actor=actor,
            source_notice=resource['attribution']+'\n'+resource['license_url']+'\n'+resource['source_notice'])
        return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=document)


def _representation(resource_key,chapter,start,end,note_scope):
    reference(chapter,start,end)
    if note_scope=='verse':return quran_reader.representation(resource_key,chapter,start,end)
    if note_scope not in {'surah','source'}:raise ValueError('Unknown personal note scope')
    _,resource=quran_reader._load(resource_key)
    target=dict(id='urn:research:quran:'+PROFILE_ID+(':'+str(chapter) if note_scope=='surah' else ''),
        chapter=chapter if note_scope=='surah' else None,ayah_start=None,ayah_end=None,label='Surah '+str(chapter) if note_scope=='surah' else 'Qur’an')
    return dict(resource=resource,reference=target)


def create_note(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end,request_uuid,body,actor,note_scope='verse'):
    # First source, immutable versioned reading, and actual private note commit together.
    with connection.transaction():
        bound=binding(connection,project_id=project_id,resource_key=resource_key,chapter=chapter,ayah_start=ayah_start,ayah_end=ayah_end,actor=actor,note_scope=note_scope)
        result=notebook.create(connection,project_id=project_id,request_uuid=request_uuid,thought_type='note',title=bound['reference']['label'],body=body,links=[],
            record_id=bound['record_id'],document_id=bound['document']['id'] if bound['document'] else None,reading_position=0 if bound['document'] else None,actor=actor)
        context=dict(project_id=project_id,resource_key=resource_key,note_scope=note_scope,chapter=chapter if note_scope!='source' else None,
            ayah_start=ayah_start if note_scope=='verse' else None,ayah_end=ayah_end if note_scope=='verse' else None)
        connection.execute("INSERT INTO research.quran_note_contexts(entry_id,project_id,resource_key,note_scope,chapter,ayah_start,ayah_end) VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(entry_id) DO NOTHING",(result['id'],*context.values()))
        previous=connection.execute('SELECT * FROM research.quran_note_contexts WHERE entry_id=%s',(result['id'],)).fetchone()
        if any(previous[k]!=v for k,v in context.items()):raise db.RevisionConflict(None)
        return dict(binding=bound,note=notebook.get(connection,project_id,result['id']))


def notes(connection,*,project_id,resource_key,chapter,note_scope,cursor='',limit=25):
    if note_scope not in {'surah','source'}:raise ValueError('Verse notes use their immutable document')
    reference(chapter,1)
    if resource_key not in quran_reader.RESOURCES:raise ValueError('Unavailable resource')
    rows=connection.execute("""SELECT n.id FROM research.quran_note_contexts q JOIN research.notebook_entries n
        ON n.project_id=q.project_id AND n.id=q.entry_id JOIN research.records r ON r.project_id=n.project_id AND r.id=n.record_id
        WHERE q.project_id=%s AND q.resource_key=%s AND q.note_scope=%s AND (q.chapter=%s OR q.note_scope='source')
        AND n.state='active' AND r.deleted_at IS NULL AND n.id>%s AND NOT EXISTS(SELECT 1 FROM research.note_trash t
        WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed') ORDER BY n.id LIMIT %s""",(project_id,resource_key,note_scope,chapter,cursor,limit))
    return [notebook.get(connection,project_id,row['id']) for row in rows]


def place(connection,project_id):
    return connection.execute('SELECT * FROM research.quran_places WHERE project_id=%s',(project_id,)).fetchone()


def save_place(connection,*,project_id,resource_key,chapter,ayah,expected_revision,actor):
    reference(chapter,ayah)
    if resource_key not in quran_reader.RESOURCES:raise ValueError('Unavailable resource')
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',('quran-place:'+project_id,))
        old=place(connection,project_id)
        values=dict(resource_key=resource_key,chapter=chapter,ayah=ayah,changed_by=actor)
        if old and old['revision']==expected_revision+1 and all(old[k]==v for k,v in values.items()):return old
        if (old['revision'] if old else 0)!=expected_revision:raise db.RevisionConflict(old)
        connection.execute('''INSERT INTO research.quran_places(project_id,resource_key,chapter,ayah,changed_by)
            VALUES(%s,%s,%s,%s,%s) ON CONFLICT(project_id) DO UPDATE SET resource_key=EXCLUDED.resource_key,chapter=EXCLUDED.chapter,
            ayah=EXCLUDED.ayah,changed_by=EXCLUDED.changed_by,revision=research.quran_places.revision+1,updated_at=clock_timestamp()''',(project_id,resource_key,chapter,ayah,actor))
        return place(connection,project_id)
