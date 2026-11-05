-- One configured owner workspace. Legacy project columns are origins, never defaults.
CREATE TABLE research.owner_workspaces (
 id text PRIMARY KEY CHECK(id='owner'),title text NOT NULL DEFAULT 'My research',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO research.owner_workspaces(id) VALUES('owner');
ALTER TABLE research.records ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.records ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.reading_documents ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.reading_documents ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.reading_annotations ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.reading_annotations ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.notebook_entries ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.notebook_entries ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.notebook_drafts ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.notebook_drafts ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.notebook_revisions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.notebook_entries DROP CONSTRAINT notebook_entries_thought_type_check;
ALTER TABLE research.notebook_entries ADD CONSTRAINT notebook_entries_thought_type_check CHECK(thought_type IN ('note','question','source_claim','interpretation','objection','decision','principle'));
ALTER TABLE research.notebook_entries ADD COLUMN title_mode text NOT NULL DEFAULT 'manual' CHECK(title_mode IN ('automatic','manual'));
CREATE INDEX workspace_notes_recent ON research.notebook_entries(workspace_id,updated_at DESC,id) WHERE state='active';
CREATE INDEX workspace_notes_text ON research.notebook_entries USING gin(to_tsvector('simple',title||' '||body));
CREATE UNIQUE INDEX workspace_documents_content ON research.reading_documents(source_record_id,content_key) WHERE project_id IS NULL;
CREATE FUNCTION research.guard_workspace_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
 THEN RAISE EXCEPTION 'workspace and legacy origin are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_origin_guard BEFORE UPDATE ON research.records FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_origin();
CREATE TRIGGER workspace_origin_guard BEFORE UPDATE ON research.reading_documents FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_origin();
CREATE TRIGGER workspace_origin_guard BEFORE UPDATE ON research.reading_annotations FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_origin();
CREATE TRIGGER workspace_origin_guard BEFORE UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_origin();
CREATE TRIGGER workspace_origin_guard BEFORE UPDATE ON research.notebook_drafts FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_origin();
CREATE OR REPLACE FUNCTION research.prepare_notebook_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE d research.reading_documents%ROWTYPE; a research.reading_annotations%ROWTYPE; link jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.project_id,NEW.creation_sha256,NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.reading_position,NEW.review_state)
   IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.creation_sha256,OLD.record_id,OLD.document_id,OLD.annotation_id,OLD.reading_position,OLD.review_state)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable notebook target or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.created_at:=OLD.created_at;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first notebook revision must be one' USING ERRCODE='23514'; END IF;
 IF NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.records WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=NEW.record_id AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'notebook source not active in project' USING ERRCODE='23514'; END IF;
 IF NEW.document_id IS NOT NULL THEN
  SELECT * INTO d FROM research.reading_documents WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=NEW.document_id;
  IF NOT FOUND OR d.source_record_id<>NEW.record_id THEN RAISE EXCEPTION 'notebook document does not match source' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reading_position IS NOT NULL AND NEW.reading_position>length(d.text_body) THEN
  RAISE EXCEPTION 'reading position outside document' USING ERRCODE='23514'; END IF;
 IF NEW.annotation_id IS NOT NULL THEN
  SELECT * INTO a FROM research.reading_annotations WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=NEW.annotation_id;
  IF NOT FOUND OR a.document_id<>NEW.document_id OR a.text_sha256<>d.text_sha256
   OR substring(d.text_body FROM a.start_pos+1 FOR a.end_pos-a.start_pos)<>a.exact
  THEN RAISE EXCEPTION 'notebook annotation does not match exact document' USING ERRCODE='23514'; END IF;
 END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(NEW.links) LOOP
  IF jsonb_typeof(link)<>'object' OR NOT link ?& ARRAY['kind','id','rationale']
   OR (SELECT count(*) FROM jsonb_object_keys(link))<>3
   OR jsonb_typeof(link->'kind')<>'string' OR jsonb_typeof(link->'id')<>'string' OR jsonb_typeof(link->'rationale')<>'string'
   OR length(btrim(link->>'id')) NOT BETWEEN 1 AND 500 OR length(btrim(link->>'rationale')) NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'explicit located notebook link and rationale required' USING ERRCODE='23514'; END IF;
  IF link->>'kind'='record' THEN
   SELECT count(*) INTO n FROM research.records WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=link->>'id' AND deleted_at IS NULL;
  ELSIF link->>'kind'='annotation' THEN
   SELECT count(*) INTO n FROM research.reading_annotations x JOIN research.reading_documents y ON y.project_id IS NOT DISTINCT FROM x.project_id AND y.id=x.document_id
    JOIN research.records z ON z.project_id IS NOT DISTINCT FROM y.project_id AND z.id=y.source_record_id
    WHERE (NEW.project_id IS NULL OR x.project_id=NEW.project_id) AND x.id=link->>'id' AND z.deleted_at IS NULL;
  ELSIF link->>'kind'='entry' AND link->>'id'<>NEW.id THEN
   SELECT count(*) INTO n FROM research.notebook_entries WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=link->>'id' AND state='active';
  ELSE n:=0; END IF;
  IF n<>1 THEN RAISE EXCEPTION 'notebook link target unavailable in project' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.links)) <>
  (SELECT count(DISTINCT (value->>'kind',value->>'id')) FROM jsonb_array_elements(NEW.links))
 THEN RAISE EXCEPTION 'duplicate notebook connection' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION research.prepare_notebook_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE baseline jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.project_id,NEW.entry_id,NEW.request_uuid,NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.reading_position,NEW.base_revision,NEW.base_snapshot)
   IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.entry_id,OLD.request_uuid,OLD.record_id,OLD.document_id,OLD.annotation_id,OLD.reading_position,OLD.base_revision,OLD.base_snapshot)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable writing recovery target or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.created_at:=OLD.created_at;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first recovery revision must be one' USING ERRCODE='23514';
 ELSIF NEW.entry_id IS NOT NULL THEN
  SELECT snapshot INTO baseline FROM research.notebook_revisions WHERE project_id IS NOT DISTINCT FROM NEW.project_id AND entry_id=NEW.entry_id AND revision=NEW.base_revision;
  IF NOT FOUND OR NEW.base_snapshot IS DISTINCT FROM baseline OR
   (NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.reading_position) IS DISTINCT FROM (baseline->>'record_id',baseline->>'document_id',baseline->>'annotation_id',(baseline->>'reading_position')::integer)
  THEN RAISE EXCEPTION 'writing recovery baseline mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.base_snapshot IS NOT NULL AND NEW.base_snapshot<>'null'::jsonb THEN RAISE EXCEPTION 'new writing has no baseline' USING ERRCODE='23514';
 END IF;
 IF NOT NEW.value ?& ARRAY['thought_type','title','body','links','state']
  OR (SELECT count(*) FROM jsonb_object_keys(NEW.value))<>5
  OR jsonb_typeof(NEW.value->'title')<>'string' OR jsonb_typeof(NEW.value->'body')<>'string'
  OR jsonb_typeof(NEW.value->'links')<>'array' OR jsonb_array_length(NEW.value->'links')>25
  OR NEW.value->>'thought_type' NOT IN ('note','question','source_claim','interpretation','objection','decision','principle')
  OR NEW.value->>'state' NOT IN ('active','withdrawn')
 THEN RAISE EXCEPTION 'invalid private recovery value' USING ERRCODE='23514'; END IF;
 IF NEW.reading_position IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.reading_documents WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=NEW.document_id AND source_record_id=NEW.record_id AND NEW.reading_position<=length(text_body)) THEN
  RAISE EXCEPTION 'reading position outside document' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;

CREATE TABLE research.workspace_note_trash (
 entry_id text PRIMARY KEY REFERENCES research.notebook_entries(id),
 target_revision integer NOT NULL CHECK(target_revision>0),state text NOT NULL CHECK(state IN ('active','trashed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.workspace_note_trash_history (
 entry_id text NOT NULL REFERENCES research.notebook_entries(id),revision integer NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(entry_id,revision)
);
CREATE FUNCTION research.prepare_workspace_trash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE actual integer;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.revision<>OLD.revision+1)
  OR TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'invalid workspace trash revision' USING ERRCODE='23514';END IF;
 SELECT revision INTO actual FROM research.notebook_entries WHERE id=NEW.entry_id AND project_id IS NULL FOR UPDATE;
 IF actual IS NULL OR actual<>NEW.target_revision THEN RAISE EXCEPTION 'native note revision unavailable' USING ERRCODE='23514';END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION research.log_workspace_trash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.workspace_note_trash_history VALUES(NEW.entry_id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER workspace_trash_prepare BEFORE INSERT OR UPDATE ON research.workspace_note_trash FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_trash();
CREATE TRIGGER workspace_trash_log AFTER INSERT OR UPDATE ON research.workspace_note_trash FOR EACH ROW EXECUTE FUNCTION research.log_workspace_trash();
CREATE FUNCTION research.guard_native_trashed_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM research.workspace_note_trash WHERE entry_id=OLD.id AND state='trashed')
 THEN RAISE EXCEPTION 'restore native writing before editing' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER workspace_native_trash_guard BEFORE UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.guard_native_trashed_note();
REVOKE ALL ON research.owner_workspaces,research.workspace_note_trash,research.workspace_note_trash_history FROM PUBLIC;
REVOKE ALL ON FUNCTION research.guard_workspace_origin(),research.prepare_workspace_trash(),research.log_workspace_trash(),research.guard_native_trashed_note() FROM PUBLIC;

-- Workspace metadata is not an authored publication input; preserve prior seals.
CREATE OR REPLACE FUNCTION research.publication_inputs(project_key text, records text[], relations text[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,research AS $$
    SELECT jsonb_build_object(
        'project',(SELECT to_jsonb(p) FROM research.projects p WHERE p.id=project_key),
        'canonical_snapshot_sha256',COALESCE((SELECT jsonb_agg(i.sha256 ORDER BY i.sha256)
            FROM research.import_snapshots i WHERE i.project_id=project_key AND i.format='turtle'),'[]'::jsonb),
        'records',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'workspace_id' ORDER BY r.id) FROM research.records r
            WHERE r.project_id=project_key AND r.id=ANY(records) AND r.deleted_at IS NULL),'[]'::jsonb),
        'relations',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM research.relations e
            WHERE e.project_id=project_key AND e.id=ANY(relations)),'[]'::jsonb))
$$;
