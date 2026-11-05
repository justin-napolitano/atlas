-- Explicit one-time references from historical groupings, never a default project.
CREATE TABLE research.workspace_legacy_collections (
 project_id text PRIMARY KEY REFERENCES research.projects(id),
 collection_id text NOT NULL UNIQUE REFERENCES research.workspace_collections(id),
 mapped_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO research.workspace_collections(id,title,creation_sha256,changed_by)
 SELECT 'urn:research:collection:legacy:'||encode(sha256(convert_to(p.id,'UTF8')),'hex'),
 CASE WHEN length(btrim(p.title))=0 THEN 'Untitled collection' ELSE left(p.title,300) END,encode(sha256(convert_to(jsonb_build_array(p.id,p.title)::text,'UTF8')),'hex'),'legacy-collection-migration-v1'
 FROM research.projects p;
INSERT INTO research.workspace_legacy_collections(project_id,collection_id)
 SELECT p.id,'urn:research:collection:legacy:'||encode(sha256(convert_to(p.id,'UTF8')),'hex') FROM research.projects p;
INSERT INTO research.workspace_collection_items(collection_id,target_kind,target_id,state,changed_by)
 SELECT m.collection_id,'record',r.id,'active','legacy-collection-migration-v1' FROM research.records r
 JOIN research.workspace_legacy_collections m ON m.project_id=r.project_id WHERE r.deleted_at IS NULL AND r.review_state<>'withdrawn'
 UNION ALL SELECT m.collection_id,'entry',n.id,'active','legacy-collection-migration-v1' FROM research.notebook_entries n
 JOIN research.workspace_legacy_collections m ON m.project_id=n.project_id WHERE n.state='active' AND NOT EXISTS(
  SELECT 1 FROM research.note_trash t WHERE t.project_id=n.project_id AND t.target_kind='entry' AND t.target_id=n.id AND t.state='trashed')
 UNION ALL SELECT m.collection_id,'annotation',a.id,'active','legacy-collection-migration-v1' FROM research.reading_annotations a
 JOIN research.workspace_legacy_collections m ON m.project_id=a.project_id WHERE NOT EXISTS(
  SELECT 1 FROM research.note_trash t WHERE t.project_id=a.project_id AND t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed');
REVOKE ALL ON research.workspace_legacy_collections FROM PUBLIC;
