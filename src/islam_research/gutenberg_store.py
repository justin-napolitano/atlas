"""Private bindings and CAS resume; catalog browsing never adds research records."""
import hashlib
import uuid
from . import database as db, passage_store, gutenberg


def cache(connection, value):
    if value.get('availability')!='read': return value
    with connection.transaction():
        # Bounded retained public corpus. No unbounded mirroring via API requests.
        connection.execute('SELECT pg_advisory_xact_lock(184514, 170)')
        old=snapshot(connection,value['book_id'],value['version'])
        if old: return old
        if connection.execute('SELECT count(*) AS n FROM research.gutenberg_books').fetchone()['n']>=128:
            raise ValueError('Reading cache is full; retain or archive existing books before adding more')
        connection.execute('INSERT INTO research.gutenberg_books(book_id,version,payload) VALUES(%s,%s,%s)',
                           (value['book_id'],value['version'],db.Jsonb(value)))
    return value


def snapshot(connection, book_id, version=''):
    row=connection.execute('''SELECT payload FROM research.gutenberg_books WHERE book_id=%s
        AND (%s='' OR version=%s) ORDER BY created_at DESC LIMIT 1''',(book_id,version,version)).fetchone()
    return row['payload'] if row else None


def place(connection, project_id, book_id):
    return connection.execute('SELECT * FROM research.gutenberg_places WHERE project_id=%s AND book_id=%s',
                              (project_id,book_id)).fetchone()


def representation(value, project_id, section):
    if type(section) is not int or not 0<=section<len(value['sections']): raise ValueError('Unknown reading section')
    chunk=value['sections'][section]
    base=project_id+'\n'+f"gutenberg:{value['book_id']}"
    source_id='urn:research:source:'+str(uuid.uuid5(uuid.NAMESPACE_URL,base))
    document_id='urn:research:document:'+str(uuid.uuid5(uuid.NAMESPACE_URL,base+'\n'+value['version']+'\n'+str(section)))
    # A concise provenance notice; the complete source header/license stays with the retained book.
    notice=value['attribution']+'\n'+value['rights_notice']+'\n'+value['license_url']+'\nRaw UTF-8 SHA-256: '+value['version']
    return dict(id=document_id,project_id=project_id,source_record_id=source_id,
        edition=value['edition']+' · '+value['version'][:12],locator=f"Section {section+1}: {chunk['label']}",
        representation_url=value['representation_url'],text_body=chunk['text'],text_sha256=chunk['text_sha256'],
        normalization='plain-text-lf-v1; logical Unicode order; no Unicode/whitespace folding',
        review_scope='Unreviewed reading text; opening is not scholarly review.',source_notice=notice)


def binding(connection, *, project_id, book_id, version, section, actor):
    value=snapshot(connection,book_id,version)
    if not value: raise ValueError('This book version is unavailable; saved notes retain their original reading snapshots')
    target=representation(value,project_id,section)
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(target['source_record_id'],))
        attributes=dict(gutenberg_id=book_id,provider='gutenberg',source_url=value['source_url'],
                        creators=value['creators'],translators=value['translators'],language=value['languages'],
                        metadata_origin='gutenberg_rdf',edition=value['edition'],release_date=value['release_date'],
                        rights_notice=value['rights_notice'],review_effect='none')
        connection.execute('''INSERT INTO research.records(id,project_id,kind,title,attributes,changed_by)
            VALUES(%s,%s,'source',%s,%s,%s) ON CONFLICT(id) DO NOTHING''',
            (target['source_record_id'],project_id,value['title'],db.Jsonb(attributes),actor))
        source=db.get_record(connection,target['source_record_id'])
        if not source or source['project_id']!=project_id or source['deleted_at'] or source['attributes'].get('gutenberg_id')!=book_id:
            raise ValueError('This book binding requires reconciliation')
        document=passage_store.create_document(connection,project_id=project_id,source_record_id=target['source_record_id'],
            edition=target['edition'],locator=target['locator'],representation_url=target['representation_url'],
            text=target['text_body'],source_notice=target['source_notice'],document_id=target['id'],actor=actor)
        if document['id']!=target['id']: raise ValueError('This source version needs identity reconciliation')
        return dict(project_id=project_id,record_id=source['id'],document=document)


def save_place(connection, *, project_id, book_id, version, section, position, expected_revision, actor):
    value=snapshot(connection,book_id,version)
    if not value: raise ValueError('Reading version unavailable')
    target=representation(value,project_id,section)
    if type(position) is not int or not 0<=position<=len(target['text_body']): raise ValueError('Invalid reading position')
    if type(expected_revision) is not int or expected_revision<0: raise ValueError('Invalid reading revision')
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(184514,hashtext(%s))',(f'gutenberg-place:{project_id}:{book_id}',))
        old=place(connection,project_id,book_id)
        desired=dict(version=version,section=section,position=position)
        if old and old['revision']==expected_revision+1 and all(old[k]==v for k,v in desired.items()): return old
        if (old['revision'] if old else 0)!=expected_revision: raise db.RevisionConflict(old)
        if old:
            connection.execute('''UPDATE research.gutenberg_places SET version=%s,section=%s,position=%s,
                revision=revision+1,changed_by=%s,updated_at=clock_timestamp() WHERE project_id=%s AND book_id=%s''',
                (version,section,position,actor,project_id,book_id))
        else:
            connection.execute('''INSERT INTO research.gutenberg_places(project_id,book_id,version,section,position,changed_by)
                VALUES(%s,%s,%s,%s,%s,%s)''',(project_id,book_id,version,section,position,actor))
        return place(connection,project_id,book_id)
