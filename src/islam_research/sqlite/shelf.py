"""SQLite shelf projection: correlated scalar selection replaces LATERAL joins.

Only the query differs; the shared shelf module retains validation, availability,
source provenance, note counts and pagination behavior.
"""
from .connection import adapt

SQL='''WITH quran AS (
 SELECT project_id,resource_key,chapter,ayah,updated_at FROM quran_places
 UNION ALL SELECT NULL,resource_key,chapter,ayah,updated_at FROM workspace_quran_places
), gutenberg AS (
 SELECT project_id,book_id,version,section,position,updated_at FROM gutenberg_places
 UNION ALL SELECT NULL,book_id,version,section,position,updated_at FROM workspace_gutenberg_places
), desks AS (
 SELECT project_id,document_id,record_id,start_pos,updated_at FROM reading_desks
 UNION ALL SELECT NULL,document_id,record_id,start_pos,updated_at FROM workspace_reading_desks
)
SELECT i.*,r.title,r.project_id AS origin_project_id,r.id AS record_id,r.attributes,e.label AS edition_label,
 (r.deleted_at IS NULL AND r.review_state<>'withdrawn') AS source_available,
 d.id AS document_id,rp.locator,rp.text_sha256,coalesce(p.start_pos,0) AS position,
 coalesce(qp.updated_at,gp.updated_at,p.updated_at) AS read_at,
 qp.chapter AS resume_chapter,qp.ayah AS resume_ayah,qp.resource_key,
 bv.book_id,bv.version AS book_version,coalesce(gp.section,0) AS book_section,coalesce(gp.position,0) AS book_position,
 (SELECT count(*) FROM library_editions x WHERE x.work_id=i.work_id) AS edition_count
FROM library_items i JOIN library_works w ON w.id=i.work_id JOIN records r ON r.id=w.legacy_source_id
LEFT JOIN library_editions e ON e.id=i.preferred_edition_id
LEFT JOIN quran qp ON qp.project_id IS r.project_id AND qp.resource_key=r.attributes->>'$.quran_resource'
 AND i.preferred_edition_id IS NOT NULL AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
LEFT JOIN gutenberg_books bv ON bv.book_id=CAST(r.attributes->>'$.gutenberg_id' AS INTEGER)
 AND bv.version=(SELECT gb.version FROM gutenberg_books gb WHERE CAST(gb.book_id AS TEXT)=r.attributes->>'$.gutenberg_id'
 AND e.label=(gb.payload->>'$.edition')||' · '||substr(gb.version,1,12)
 AND e.representation_url=gb.payload->>'$.representation_url' ORDER BY gb.version LIMIT 1)
 AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
LEFT JOIN gutenberg gp ON gp.project_id IS r.project_id AND gp.book_id=bv.book_id AND gp.version=bv.version
LEFT JOIN reading_documents d ON d.id=(
 SELECT b.document_id FROM library_document_bindings b JOIN library_representations x ON x.id=b.representation_id
 JOIN reading_documents doc ON doc.id=b.document_id AND doc.project_id IS b.project_id
 LEFT JOIN desks place ON place.project_id IS b.project_id AND place.document_id=b.document_id AND place.record_id=b.source_record_id
 WHERE b.work_id=i.work_id AND x.edition_id=i.preferred_edition_id
 ORDER BY place.updated_at DESC NULLS LAST,doc.created_at,b.document_id LIMIT 1
) AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'
LEFT JOIN library_document_bindings binding ON binding.document_id=d.id
LEFT JOIN library_representations rp ON rp.id=binding.representation_id
LEFT JOIN desks p ON p.project_id IS binding.project_id AND p.document_id=d.id AND p.record_id=binding.source_record_id
WHERE i.on_shelf AND (?='' OR i.reading_status=?)
 AND (?='' OR EXISTS(SELECT 1 FROM library_project_items m WHERE m.item_id=i.id AND m.project_id=? AND m.state<>'removed'))
 AND (strpos(lower(r.title),lower(?))>0 OR strpos(lower(coalesce(r.attributes->>'$.creators','')),lower(?))>0)
 AND (NOT ? OR (i.reading_status='reading' AND coalesce(qp.updated_at,gp.updated_at,p.updated_at) IS NOT NULL))
 AND (? IS NULL OR (i.retained_at,i.id)<(?,?))
ORDER BY CASE WHEN ? THEN coalesce(qp.updated_at,gp.updated_at,p.updated_at) END DESC NULLS LAST,i.retained_at DESC,i.id DESC LIMIT ?'''


def shelf_rows(connection,parameters):return connection.raw.execute(SQL,tuple(adapt(value) for value in parameters)).fetchall()
