-- Optional notebook type only; preserve original writing, receipts and history.
ALTER TABLE research.notebook_entries DROP CONSTRAINT notebook_entries_thought_type_check;
ALTER TABLE research.notebook_entries ADD CONSTRAINT notebook_entries_thought_type_check
 CHECK(thought_type IN ('note','question','source_claim','interpretation','objection','decision','principle','skill'));

-- Keep the existing recovery target/anchor/revision guards, extending its type set.
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
  OR NEW.value->>'thought_type' NOT IN ('note','question','source_claim','interpretation','objection','decision','principle','skill')
  OR NEW.value->>'state' NOT IN ('active','withdrawn')
 THEN RAISE EXCEPTION 'invalid private recovery value' USING ERRCODE='23514'; END IF;
 IF NEW.reading_position IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.reading_documents WHERE (NEW.project_id IS NULL OR project_id=NEW.project_id) AND id=NEW.document_id AND source_record_id=NEW.record_id AND NEW.reading_position<=length(text_body)) THEN
  RAISE EXCEPTION 'reading position outside document' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
