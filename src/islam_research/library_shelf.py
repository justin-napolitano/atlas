"""Private shelf projection; existing identities, writing and resume remain authoritative."""
import base64
from datetime import datetime
import json
from . import database as db, shared_library


def _cursor(value):
    if not value:return None
    try:
        data=json.loads(base64.urlsafe_b64decode(value+'='*(-len(value)%4)))
        if not isinstance(data,list) or len(data)!=2:raise ValueError()
        stamp=datetime.fromisoformat(data[0])
        if stamp.tzinfo is None:raise ValueError()
        db._text(data[1],'shelf cursor identity',500)
        return stamp,data[1]
    except (ValueError,TypeError,KeyError,UnicodeError) as error:raise ValueError('Invalid shelf cursor') from error


def page(connection,*,project_id='',q='',state='',cursor='',limit=30,continuing=False):
    db._text(project_id,'project',500,empty=True);db._text(q,'query',300,empty=True)
    if state not in {'',*shared_library.STATUSES} or type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid shelf page')
    after=_cursor(cursor)
    # Exact saved-document resume only, never a max-position guess across editions.
    # Lateral joins are one fixed query, followed by a batch note count query.
    rows=connection.execute('''SELECT i.*,r.title,r.project_id AS origin_project_id,r.id AS record_id,
      r.attributes,e.label AS edition_label,
      (r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available,
      target.document_id,target.locator,target.text_sha256,target.position,
      coalesce(qp.updated_at,gp.updated_at,target.read_at) AS read_at,
      qp.chapter AS resume_chapter,qp.ayah AS resume_ayah,qp.resource_key,
      bv.book_id,bv.version AS book_version,coalesce(gp.section,0) AS book_section,coalesce(gp.position,0) AS book_position,
      (SELECT count(*) FROM research.library_editions x WHERE x.work_id=i.work_id) AS edition_count
      FROM research.library_items i JOIN research.library_works w ON w.id=i.work_id
      JOIN research.records r ON r.id=w.legacy_source_id
      LEFT JOIN research.library_editions e ON e.id=i.preferred_edition_id
      LEFT JOIN research.quran_places qp ON qp.project_id=r.project_id
        AND qp.resource_key=r.attributes->>'quran_resource' AND i.preferred_edition_id IS NOT NULL
        AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
      LEFT JOIN LATERAL (
        SELECT gb.book_id,gb.version FROM research.gutenberg_books gb
        WHERE gb.book_id::text=r.attributes->>'gutenberg_id'
        AND e.label=(gb.payload->>'edition')||' · '||left(gb.version,12)
        AND e.representation_url=gb.payload->>'representation_url'
        ORDER BY gb.version LIMIT 1
      ) bv ON r.deleted_at IS NULL AND r.review_state<>'withdrawn'
      LEFT JOIN research.gutenberg_places gp ON gp.project_id=r.project_id
        AND gp.book_id=bv.book_id AND gp.version=bv.version
      LEFT JOIN LATERAL (
        SELECT b.document_id,rp.locator,rp.text_sha256,coalesce(p.start_pos,0) AS position,p.updated_at AS read_at
        FROM research.library_document_bindings b JOIN research.library_representations rp ON rp.id=b.representation_id
        JOIN research.reading_documents d ON d.id=b.document_id AND d.project_id=b.project_id
        LEFT JOIN research.reading_desks p ON p.project_id=b.project_id AND p.document_id=b.document_id AND p.record_id=b.source_record_id
        WHERE b.work_id=i.work_id AND rp.edition_id=i.preferred_edition_id
        ORDER BY p.updated_at DESC NULLS LAST,d.created_at,b.document_id LIMIT 1
      ) target ON r.deleted_at IS NULL AND r.review_state<>'withdrawn'
      WHERE i.on_shelf AND (%s='' OR i.reading_status=%s)
      AND (%s='' OR EXISTS(SELECT 1 FROM research.library_project_items m WHERE m.item_id=i.id AND m.project_id=%s AND m.state<>'removed'))
      AND (strpos(lower(r.title),lower(%s))>0 OR strpos(lower(coalesce(r.attributes->>'creators','')),lower(%s))>0)
      AND (NOT %s OR (i.reading_status='reading' AND coalesce(qp.updated_at,gp.updated_at,target.read_at) IS NOT NULL))
      AND (%s::timestamptz IS NULL OR (i.retained_at,i.id)<(%s::timestamptz,%s))
      ORDER BY CASE WHEN %s THEN coalesce(qp.updated_at,gp.updated_at,target.read_at) END DESC NULLS LAST,i.retained_at DESC,i.id DESC LIMIT %s''',
      (state,state,project_id,project_id,q.strip(),q.strip(),continuing,after[0] if after else None,after[0] if after else None,after[1] if after else '',continuing,limit+1)).fetchall()
    visible=rows[:limit]
    counts=connection.execute(shared_library.NOTES_SQL+'SELECT item_id,count(DISTINCT note_key) AS n FROM notes GROUP BY item_id',([r['id'] for r in visible],)).fetchall() if visible else []
    counts={r['item_id']:r['n'] for r in counts}
    for row in visible:
        attrs=row.pop('attributes')
        row['creators']=attrs.get('creators',[]);row['language']=attrs.get('language',[])
        row['note_count']=counts.get(row['id'],0)
        row['reader']='document'
        if row['source_available'] and row['preferred_edition_id'] and attrs.get('quran_resource') in {'tanzil-uthmani','itani-god'}:
            from . import quran_reader
            _,resource=quran_reader._load(attrs['quran_resource'])
            if attrs.get('source_sha256')==resource['sha256']:
                row['reader']='quran';row['resource_key']=attrs['quran_resource']
                row['resume_chapter']=row['resume_chapter'] or 1;row['resume_ayah']=row['resume_ayah'] or 1
        elif row['book_id'] and row['source_available']:row['reader']='gutenberg'
        row['availability']='read' if row['reader'] in {'quran','gutenberg'} else ''
        row['availability']=row['availability'] or ('read' if row['document_id'] else ('choose_edition' if row['source_available'] and row['edition_count'] else 'reference' if row['source_available'] else 'unavailable'))
    next_cursor=None
    if len(rows)>limit and not continuing:
        last=visible[-1];next_cursor=base64.urlsafe_b64encode(json.dumps([last['retained_at'].isoformat(),last['id']]).encode()).decode().rstrip('=')
    return dict(items=visible,next_cursor=next_cursor)


def mark_reading(connection,*,source_id,edition,representation_url,actor):
    """A confirmed place may begin Reading only for the retained selected edition."""
    connection.execute("""UPDATE research.library_items i SET reading_status='reading',
      revision=i.revision+1,changed_by=%s FROM research.library_source_bindings b,
      research.library_editions e,research.records r
      WHERE i.id=b.item_id AND e.id=i.preferred_edition_id AND r.id=b.source_record_id
      AND b.source_record_id=%s AND e.label=%s AND e.representation_url=%s
      AND i.on_shelf AND i.reading_status='want_to_read'
      AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'""",(actor,source_id,edition,representation_url))
