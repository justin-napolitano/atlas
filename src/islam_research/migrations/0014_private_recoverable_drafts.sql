-- Private unfinished writing; never publication or scholarly review inputs.
CREATE TABLE research.reading_drafts (
    id text PRIMARY KEY CHECK (id ~ '^urn:research:draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    project_id text NOT NULL REFERENCES research.projects(id),
    record_id text NOT NULL,
    context_kind text NOT NULL CHECK (context_kind IN ('record_note','capture','annotation')),
    document_id text,
    annotation_id text,
    text_sha256 text,
    start_pos integer,
    end_pos integer,
    exact text NOT NULL DEFAULT '' CHECK (length(exact)<=500),
    prefix text NOT NULL DEFAULT '' CHECK (length(prefix)<=40),
    suffix text NOT NULL DEFAULT '' CHECK (length(suffix)<=40),
    capture_kind text CHECK (capture_kind IN ('comment','term_candidate','citation_candidate')),
    base_revision integer NOT NULL CHECK (base_revision>=0),
    base_snapshot jsonb NOT NULL DEFAULT '{}',
    body text NOT NULL CHECK (length(body)<=10000),
    mark_style text NOT NULL CHECK (mark_style IN ('highlight','underline','none')),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','discarded')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,record_id) REFERENCES research.records(project_id,id),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
    FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
    CHECK ((context_kind='record_note' AND document_id IS NULL AND annotation_id IS NULL AND text_sha256 IS NULL AND start_pos IS NULL AND end_pos IS NULL AND exact='' AND prefix='' AND suffix='' AND capture_kind IS NULL AND mark_style='none')
      OR (context_kind IN ('capture','annotation') AND document_id IS NOT NULL AND text_sha256 IS NOT NULL AND start_pos IS NOT NULL AND end_pos IS NOT NULL AND text_sha256 ~ '^[0-9a-f]{64}$' AND start_pos>=0 AND end_pos>start_pos AND end_pos-start_pos<=500 AND length(exact)=end_pos-start_pos AND capture_kind IS NOT NULL
        AND ((context_kind='capture' AND annotation_id IS NULL AND base_revision=0) OR (context_kind='annotation' AND annotation_id IS NOT NULL AND base_revision>=1))))
);
CREATE INDEX reading_drafts_context ON research.reading_drafts(project_id,record_id,state,id);
CREATE TABLE research.reading_draft_revisions (
    draft_id text NOT NULL REFERENCES research.reading_drafts(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(draft_id,revision)
);
CREATE FUNCTION research.prepare_reading_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE source_kind text; document research.reading_documents%ROWTYPE; captured research.reading_annotations%ROWTYPE; baseline jsonb;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.record_id,NEW.context_kind,NEW.document_id,NEW.annotation_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.prefix,NEW.suffix,NEW.capture_kind,NEW.base_revision,NEW.base_snapshot)
           IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.record_id,OLD.context_kind,OLD.document_id,OLD.annotation_id,OLD.text_sha256,OLD.start_pos,OLD.end_pos,OLD.exact,OLD.prefix,OLD.suffix,OLD.capture_kind,OLD.base_revision,OLD.base_snapshot)
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
CREATE TRIGGER reading_draft_prepare BEFORE INSERT OR UPDATE ON research.reading_drafts FOR EACH ROW EXECUTE FUNCTION research.prepare_reading_draft();
CREATE FUNCTION research.reading_draft_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.reading_draft_revisions VALUES(NEW.id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER reading_draft_log AFTER INSERT OR UPDATE ON research.reading_drafts FOR EACH ROW EXECUTE FUNCTION research.reading_draft_history();
REVOKE ALL ON research.reading_drafts,research.reading_draft_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_reading_draft(),research.reading_draft_history() FROM PUBLIC;
