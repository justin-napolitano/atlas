"""Explicitly connect an exact imported collection excerpt to its verse reader.

This operation does not acquire a source, interpret it, promote review, or publish
it. The transport must enforce signed-owner identity and explicit confirmation.
"""
import uuid

from . import database as db, lexicon, passage_store, reader_collection, verse_store


def link(connection, *, project_id, reading_id, document_id, request_uuid, rationale, actor):
    """Atomically capture a whole located excerpt and its typed verse connection.

    Retry the original UUID and input after interruption. A prior material receipt
    acknowledges identity before any annotation write, preserving subsequent notes
    and corrected/withdrawn material metadata.
    """
    db._text(project_id,'project',500);db._text(reading_id,'collection reading',500)
    db._text(document_id,'reading document',500);db._text(rationale,'connection rationale',2000);db._text(actor,'actor',500)
    request=lexicon.request_identity(request_uuid)
    collection=reader_collection.collection_resource()
    reading=next((row for row in collection['readings'] if row['id']==reading_id),None)
    if reading is None:raise ValueError('Choose an identified reading from this collection')
    source=next(row for row in collection['sources'] if row['id']==reading['source_id'])
    annotation_id='urn:research:annotation:'+str(request)
    material_id='urn:research:verse-material:'+str(uuid.uuid5(request,'verse-material'))
    with connection.transaction():
        if connection.execute('SHOW transaction_isolation').fetchone()['transaction_isolation']!='read committed':
            raise ValueError('Collection-link retries require READ COMMITTED isolation')
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(str(request),))
        document=passage_store.get_document(connection,project_id,document_id)
        if document is None:raise ValueError('Active collection document not found in this project')
        expected=dict(text_body=reading['text'],text_sha256=reading['text_sha256'],edition=source['edition'],
            locator=reading['locator'],representation_url=source['source_url'])
        if any(document[key]!=value for key,value in expected.items()):
            raise ValueError('Imported document does not exactly match this identified collection excerpt')
        source_id=document['source_record_id']
        record=connection.execute('SELECT kind FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL',(project_id,source_id)).fetchone()
        if record is None or record['kind'] not in {'source','work','edition'}:raise ValueError('An active identified reading source is required')
        canonical=source.get('canonical_source_record_id')
        # Reused canonical RDF records keep their bibliography unchanged. Other
        # sources require the immutable intake receipt that identifies this exact
        # document, rather than trusting an arbitrary record title.
        if source_id!=canonical:
            receipt=connection.execute('''SELECT 1 FROM research.source_intakes WHERE project_id=%s
                AND source_record_id=%s AND document_id=%s AND declarations->>'source_url'=%s
                AND declarations->>'edition'=%s AND declarations->>'creators'=%s AND declarations->>'language'=%s LIMIT 1''',
                (project_id,source_id,document_id,source['source_url'],source['edition'],source['creators'],source['language'])).fetchone()
            if receipt is None:raise ValueError('Document source needs its matching collection intake identity')
        target=reading['reference'];kind=reading['material_kind']
        metadata=dict(attribution=reading['attribution'],language_tag=source['language'],source_scope=reading['source_scope'],
            assertion_mode='none',assertion_text='',period_note='',tradition_note='',context_basis='',rationale=rationale,state='active',
            reading_note=f"Collection {collection['collection_id']}; reading {reading_id}; artifact {collection['artifact_sha256']}; document {document_id}; source {source_id}. Pending located quotation; no new interpretation or scholarly review.")
        values=dict(request_uuid=str(request),project_id=project_id,annotation_id=annotation_id,
            chapter=target['chapter'],ayah_start=target['ayah_start'],ayah_end=target['ayah_end'],material_kind=kind,
            link_kind='representation' if kind=='translation' else 'discussion',citation_basis='none',citation_id=None,
            marker_start=None,marker_end=None,actor=actor,**metadata)
        previous=connection.execute('SELECT id FROM research.verse_materials WHERE id=%s',(material_id,)).fetchone()
        if previous is None:
            if connection.execute('SELECT id FROM research.reading_annotations WHERE id=%s',(annotation_id,)).fetchone():
                raise ValueError('This request UUID already belongs to another saved capture; use a fresh connection request')
            passage_store.create_annotation(connection,annotation_uuid=str(request),project_id=project_id,document_id=document_id,
                text_sha256=document['text_sha256'],start=0,end=len(reading['text']),exact=reading['text'],capture_kind='comment',
                body='',mark_style='none',actor=actor)
        acknowledged=verse_store.create(connection,**values)
        return dict(project_id=project_id,record_id=source_id,document_id=document_id,annotation_id=annotation_id,
            material_id=acknowledged['id'],revision=acknowledged['revision'],reading_id=reading_id)
