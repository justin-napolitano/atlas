-- Private approximate reading points; never fabricate an exact passage annotation.
ALTER TABLE research.notebook_entries ADD COLUMN reading_position integer;
ALTER TABLE research.notebook_entries ADD CONSTRAINT notebook_entries_position CHECK (
 reading_position IS NULL OR (reading_position>=0 AND record_id IS NOT NULL AND document_id IS NOT NULL AND annotation_id IS NULL));
ALTER TABLE research.notebook_drafts ADD COLUMN reading_position integer;
ALTER TABLE research.notebook_drafts ADD CONSTRAINT notebook_drafts_position CHECK (
 reading_position IS NULL OR (reading_position>=0 AND record_id IS NOT NULL AND document_id IS NOT NULL AND annotation_id IS NULL));
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
 IF NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.records WHERE project_id=NEW.project_id AND id=NEW.record_id AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'notebook source not active in project' USING ERRCODE='23514'; END IF;
 IF NEW.document_id IS NOT NULL THEN
  SELECT * INTO d FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id;
  IF NOT FOUND OR d.source_record_id<>NEW.record_id THEN RAISE EXCEPTION 'notebook document does not match source' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reading_position IS NOT NULL AND NEW.reading_position>length(d.text_body) THEN
  RAISE EXCEPTION 'reading position outside document' USING ERRCODE='23514'; END IF;
 IF NEW.annotation_id IS NOT NULL THEN
  SELECT * INTO a FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
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
   SELECT count(*) INTO n FROM research.records WHERE project_id=NEW.project_id AND id=link->>'id' AND deleted_at IS NULL;
  ELSIF link->>'kind'='annotation' THEN
   SELECT count(*) INTO n FROM research.reading_annotations x JOIN research.reading_documents y ON y.project_id=x.project_id AND y.id=x.document_id
    JOIN research.records z ON z.project_id=y.project_id AND z.id=y.source_record_id
    WHERE x.project_id=NEW.project_id AND x.id=link->>'id' AND z.deleted_at IS NULL;
  ELSIF link->>'kind'='entry' AND link->>'id'<>NEW.id THEN
   SELECT count(*) INTO n FROM research.notebook_entries WHERE project_id=NEW.project_id AND id=link->>'id' AND state='active';
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
  SELECT snapshot INTO baseline FROM research.notebook_revisions WHERE project_id=NEW.project_id AND entry_id=NEW.entry_id AND revision=NEW.base_revision;
  IF NOT FOUND OR NEW.base_snapshot IS DISTINCT FROM baseline OR
   (NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.reading_position) IS DISTINCT FROM (baseline->>'record_id',baseline->>'document_id',baseline->>'annotation_id',(baseline->>'reading_position')::integer)
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
 IF NEW.reading_position IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id AND source_record_id=NEW.record_id AND NEW.reading_position<=length(text_body)) THEN
  RAISE EXCEPTION 'reading position outside document' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
