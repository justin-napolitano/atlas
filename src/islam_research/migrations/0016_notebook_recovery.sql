-- Separate private recovery authority. Never a confirmed notebook entry.
CREATE TABLE research.notebook_drafts (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES research.projects(id),
 entry_id text, request_uuid text, record_id text, document_id text, annotation_id text,
 base_revision integer NOT NULL CHECK(base_revision>=0), base_snapshot jsonb,
 value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','discarded')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,entry_id) REFERENCES research.notebook_entries(project_id,id),
 FOREIGN KEY(project_id,record_id) REFERENCES research.records(project_id,id),
 FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
 FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
 CHECK((entry_id IS NULL AND request_uuid IS NOT NULL AND base_revision=0) OR
       (entry_id IS NOT NULL AND request_uuid IS NULL AND base_revision>0)),
 CHECK(length(value->>'title')<=300 AND length(value->>'body')<=20000)
);
CREATE INDEX notebook_drafts_active ON research.notebook_drafts(project_id,state,id);
CREATE TABLE research.notebook_draft_revisions (
 draft_id text NOT NULL REFERENCES research.notebook_drafts(id), revision integer NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(draft_id,revision)
);
CREATE FUNCTION research.prepare_notebook_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE baseline jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.project_id,NEW.entry_id,NEW.request_uuid,NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.base_revision,NEW.base_snapshot)
   IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.entry_id,OLD.request_uuid,OLD.record_id,OLD.document_id,OLD.annotation_id,OLD.base_revision,OLD.base_snapshot)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable writing recovery target or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.created_at:=OLD.created_at;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first recovery revision must be one' USING ERRCODE='23514';
 ELSIF NEW.entry_id IS NOT NULL THEN
  SELECT snapshot INTO baseline FROM research.notebook_revisions WHERE project_id=NEW.project_id AND entry_id=NEW.entry_id AND revision=NEW.base_revision;
  IF NOT FOUND OR NEW.base_snapshot IS DISTINCT FROM baseline OR
   (NEW.record_id,NEW.document_id,NEW.annotation_id) IS DISTINCT FROM (baseline->>'record_id',baseline->>'document_id',baseline->>'annotation_id')
  THEN RAISE EXCEPTION 'writing recovery baseline mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.base_snapshot IS NOT NULL AND NEW.base_snapshot<>'null'::jsonb THEN RAISE EXCEPTION 'new writing has no baseline' USING ERRCODE='23514';
 END IF;
 IF NOT NEW.value ?& ARRAY['thought_type','title','body','links','state']
  OR (SELECT count(*) FROM jsonb_object_keys(NEW.value))<>5
  OR jsonb_typeof(NEW.value->'title')<>'string' OR jsonb_typeof(NEW.value->'body')<>'string'
  OR jsonb_typeof(NEW.value->'links')<>'array' OR jsonb_array_length(NEW.value->'links')>25
  OR NEW.value->>'thought_type' NOT IN ('note','question','source_claim','interpretation','objection')
  OR NEW.value->>'state' NOT IN ('active','withdrawn')
 THEN RAISE EXCEPTION 'invalid private recovery value' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER notebook_draft_prepare BEFORE INSERT OR UPDATE ON research.notebook_drafts
 FOR EACH ROW EXECUTE FUNCTION research.prepare_notebook_draft();
CREATE FUNCTION research.notebook_draft_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.notebook_draft_revisions VALUES(NEW.id,NEW.revision,to_jsonb(NEW)); RETURN NEW; END $$;
CREATE TRIGGER notebook_draft_log AFTER INSERT OR UPDATE ON research.notebook_drafts
 FOR EACH ROW EXECUTE FUNCTION research.notebook_draft_history();
REVOKE ALL ON research.notebook_drafts,research.notebook_draft_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_notebook_draft(),research.notebook_draft_history() FROM PUBLIC;
