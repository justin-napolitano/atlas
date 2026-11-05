-- Pending capture classification may change; source selectors and saved annotation types remain immutable.
CREATE OR REPLACE FUNCTION research.prepare_reading_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE source_kind text; document research.reading_documents%ROWTYPE; captured research.reading_annotations%ROWTYPE; baseline jsonb;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.record_id,NEW.context_kind,NEW.document_id,NEW.annotation_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.prefix,NEW.suffix,NEW.base_revision,NEW.base_snapshot)
           IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.record_id,OLD.context_kind,OLD.document_id,OLD.annotation_id,OLD.text_sha256,OLD.start_pos,OLD.end_pos,OLD.exact,OLD.prefix,OLD.suffix,OLD.base_revision,OLD.base_snapshot)
           OR (NEW.context_kind<>'capture' AND NEW.capture_kind IS DISTINCT FROM OLD.capture_kind)
           OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'draft anchor or revision changed' USING ERRCODE='23514'; END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first draft revision must be one' USING ERRCODE='23514'; END IF;
    SELECT kind INTO source_kind FROM research.records WHERE project_id=NEW.project_id AND id=NEW.record_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'draft requires active record in project' USING ERRCODE='23514'; END IF;
    IF NEW.context_kind<>'record_note' THEN
        SELECT * INTO document FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id;
        IF NOT FOUND OR source_kind NOT IN ('source','work','edition') OR document.source_record_id<>NEW.record_id OR NEW.text_sha256<>document.text_sha256 OR NEW.end_pos>length(document.text_body)
          OR NEW.exact<>substring(document.text_body FROM NEW.start_pos+1 FOR NEW.end_pos-NEW.start_pos)
          OR NEW.prefix<>substring(document.text_body FROM greatest(1,NEW.start_pos-39) FOR least(NEW.start_pos,40))
          OR NEW.suffix<>substring(document.text_body FROM NEW.end_pos+1 FOR 40) THEN RAISE EXCEPTION 'draft selector does not match source document' USING ERRCODE='23514'; END IF;
        IF NEW.context_kind='annotation' THEN
            SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
            IF NOT FOUND OR ROW(captured.document_id,captured.text_sha256,captured.start_pos,captured.end_pos,captured.exact,captured.capture_kind)
              IS DISTINCT FROM ROW(NEW.document_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.capture_kind) THEN RAISE EXCEPTION 'draft does not match saved annotation' USING ERRCODE='23514'; END IF;
        END IF;
    END IF;
    IF TG_OP='INSERT' THEN
        IF NEW.context_kind='capture' THEN NEW.base_snapshot:='{}'::jsonb;
        ELSIF NEW.context_kind='record_note' AND NEW.base_revision=0 THEN NEW.base_snapshot:='{"note":"","revision":0}'::jsonb;
        ELSE
            IF NEW.context_kind='record_note' THEN
                SELECT snapshot INTO baseline FROM research.personal_state_revisions WHERE record_id=NEW.record_id AND revision=NEW.base_revision AND snapshot->>'project_id'=NEW.project_id;
                IF FOUND THEN NEW.base_snapshot:=jsonb_build_object('note',baseline->>'note','revision',NEW.base_revision); END IF;
            ELSE
                SELECT snapshot INTO baseline FROM research.reading_annotation_revisions WHERE annotation_id=NEW.annotation_id AND revision=NEW.base_revision AND snapshot->>'project_id'=NEW.project_id;
                IF FOUND THEN NEW.base_snapshot:=jsonb_build_object('body',baseline->>'body','mark_style',coalesce(baseline->>'mark_style','highlight'),'revision',NEW.base_revision); END IF;
            END IF;
            IF baseline IS NULL THEN RAISE EXCEPTION 'draft baseline revision is missing' USING ERRCODE='23514'; END IF;
        END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
