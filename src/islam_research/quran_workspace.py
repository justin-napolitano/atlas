"""Owner-private bindings to pinned text. No bibliography form or evidence promotion."""
import uuid
from . import database as db, quran_reader, passage_store, notebook
from .quran_citations import reference


def existing(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end):
    value=quran_reader.representation(resource_key,chapter,ayah_start,ayah_end)
    resource=value['resource']
    source_id='urn:research:source:'+str(uuid.uuid5(uuid.NAMESPACE_URL,project_id+'\nquran-reader\n'+resource['resource_id']))
    document=connection.execute('''SELECT d.* FROM research.reading_documents d JOIN research.records r
        ON r.project_id=d.project_id AND r.id=d.source_record_id WHERE d.project_id=%s AND d.source_record_id=%s
        AND d.locator=%s AND d.text_sha256=%s AND r.deleted_at IS NULL ORDER BY d.id LIMIT 1''',
        (project_id,source_id,value['reference']['label'],value['text_sha256'])).fetchone()
    if document is None:return None
    return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=document)


def binding(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end,actor):
    value=quran_reader.representation(resource_key,chapter,ayah_start,ayah_end)
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
        document=passage_store.create_document(connection,project_id=project_id,source_record_id=source_id,edition=resource['label']+' · '+resource['version'],
            locator=value['reference']['label'],representation_url=resource['source_url'],text=value['text'],actor=actor,
            source_notice=resource['attribution']+'\n'+resource['license_url']+'\n'+resource['source_notice'])
        return dict(project_id=project_id,record_id=source_id,resource_id=resource['resource_id'],resource_key=resource_key,reference=value['reference'],document=document)


def create_note(connection,*,project_id,resource_key,chapter,ayah_start,ayah_end,request_uuid,body,actor):
    # First source, immutable versioned reading, and actual private note commit together.
    with connection.transaction():
        bound=binding(connection,project_id=project_id,resource_key=resource_key,chapter=chapter,ayah_start=ayah_start,ayah_end=ayah_end,actor=actor)
        result=notebook.create(connection,project_id=project_id,request_uuid=request_uuid,thought_type='note',title=bound['reference']['label'],body=body,links=[],
            record_id=bound['record_id'],document_id=bound['document']['id'],reading_position=0,actor=actor)
        return dict(binding=bound,note=notebook.get(connection,project_id,result['id']))


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
