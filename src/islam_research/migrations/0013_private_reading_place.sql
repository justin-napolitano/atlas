-- One confirmed private reading place per project. Notes remain separate.
CREATE TABLE research.reading_desks (
    project_id text PRIMARY KEY REFERENCES research.projects(id),
    record_id text NOT NULL,
    document_id text,
    annotation_id text,
    start_pos integer,
    end_pos integer,
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,record_id) REFERENCES research.records(project_id,id),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
    FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
    CHECK ((document_id IS NULL AND annotation_id IS NULL AND start_pos IS NULL AND end_pos IS NULL)
        OR (document_id IS NOT NULL AND start_pos IS NOT NULL AND end_pos IS NOT NULL AND start_pos>=0 AND end_pos>=start_pos))
);
CREATE TABLE research.reading_desk_revisions (
    project_id text NOT NULL REFERENCES research.projects(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(project_id,revision)
);
CREATE FUNCTION research.prepare_reading_desk() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    source_kind text;
    document research.reading_documents%ROWTYPE;
    captured research.reading_annotations%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'reading place identity or revision changed' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN
        RAISE EXCEPTION 'first reading place revision must be one' USING ERRCODE='23514';
    END IF;
    SELECT kind INTO source_kind FROM research.records WHERE project_id=NEW.project_id AND id=NEW.record_id AND deleted_at IS NULL;
    IF NOT FOUND OR source_kind NOT IN ('source','work','edition') THEN
        RAISE EXCEPTION 'reading place requires active source in project' USING ERRCODE='23514';
    END IF;
    IF NEW.document_id IS NOT NULL THEN
        SELECT * INTO document FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id;
        IF NOT FOUND OR document.source_record_id<>NEW.record_id OR NEW.end_pos>length(document.text_body) THEN
            RAISE EXCEPTION 'reading place does not match source representation' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.annotation_id IS NOT NULL THEN
        SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
        IF NOT FOUND OR captured.document_id<>NEW.document_id OR captured.start_pos<>NEW.start_pos OR captured.end_pos<>NEW.end_pos THEN
            RAISE EXCEPTION 'reading place does not match captured annotation' USING ERRCODE='23514';
        END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER reading_desk_prepare BEFORE INSERT OR UPDATE ON research.reading_desks
    FOR EACH ROW EXECUTE FUNCTION research.prepare_reading_desk();
CREATE FUNCTION research.reading_desk_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.reading_desk_revisions VALUES(NEW.project_id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER reading_desk_log AFTER INSERT OR UPDATE ON research.reading_desks
    FOR EACH ROW EXECUTE FUNCTION research.reading_desk_history();
REVOKE ALL ON research.reading_desks,research.reading_desk_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_reading_desk(),research.reading_desk_history() FROM PUBLIC;
