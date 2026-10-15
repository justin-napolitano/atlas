CREATE TABLE research.reading_documents (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL REFERENCES research.projects(id),
    source_record_id text NOT NULL,
    edition text NOT NULL CHECK (length(edition) BETWEEN 1 AND 1000),
    locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 2000),
    representation_url text NOT NULL CHECK (length(representation_url) <= 2000),
    media_type text NOT NULL DEFAULT 'text/plain' CHECK (media_type='text/plain'),
    text_body text NOT NULL CHECK (length(text_body) BETWEEN 1 AND 12000),
    input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
    text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    content_key text NOT NULL CHECK (content_key ~ '^[0-9a-f]{64}$'),
    normalization text NOT NULL,
    review_scope text NOT NULL DEFAULT 'Owner-imported excerpt; source identity and full argument remain unverified',
    changed_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,source_record_id) REFERENCES research.records(project_id,id),
    CHECK (text_sha256=encode(sha256(convert_to(text_body,'UTF8')),'hex')),
    UNIQUE(project_id,id),
    UNIQUE(project_id,content_key)
);
CREATE INDEX reading_documents_source ON research.reading_documents(project_id,source_record_id,id);
CREATE FUNCTION research.immutable_reading_document() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
    RAISE EXCEPTION 'reading snapshots are immutable; import a new version' USING ERRCODE='23514';
END $$;
CREATE TRIGGER reading_document_immutable BEFORE UPDATE ON research.reading_documents
    FOR EACH ROW EXECUTE FUNCTION research.immutable_reading_document();

CREATE TABLE research.reading_annotations (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    document_id text NOT NULL,
    text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    start_pos integer NOT NULL CHECK (start_pos>=0),
    end_pos integer NOT NULL CHECK (end_pos>start_pos AND end_pos-start_pos<=500),
    exact text NOT NULL CHECK (length(exact)=end_pos-start_pos),
    prefix text NOT NULL CHECK (length(prefix)<=40),
    suffix text NOT NULL CHECK (length(suffix)<=40),
    capture_kind text NOT NULL CHECK (capture_kind IN ('comment','term_candidate','citation_candidate')),
    body text NOT NULL CHECK (length(body)<=10000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id)
);
CREATE INDEX reading_annotations_document ON research.reading_annotations(project_id,document_id,id);
CREATE TABLE research.reading_annotation_revisions (
    annotation_id text NOT NULL REFERENCES research.reading_annotations(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(annotation_id,revision)
);
CREATE FUNCTION research.prepare_reading_annotation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    document research.reading_documents%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.document_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.prefix,NEW.suffix,NEW.capture_kind)
           IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.document_id,OLD.text_sha256,OLD.start_pos,OLD.end_pos,OLD.exact,OLD.prefix,OLD.suffix,OLD.capture_kind) THEN
            RAISE EXCEPTION 'annotation target cannot change' USING ERRCODE='23514';
        END IF;
        IF NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'annotation revision must advance by one' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN
        RAISE EXCEPTION 'first annotation revision must be one' USING ERRCODE='23514';
    END IF;
    SELECT * INTO document FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id;
    IF NOT FOUND OR NEW.text_sha256<>document.text_sha256 OR NEW.end_pos>length(document.text_body)
       OR NEW.exact<>substring(document.text_body FROM NEW.start_pos+1 FOR NEW.end_pos-NEW.start_pos)
       OR NEW.prefix<>substring(document.text_body FROM greatest(1,NEW.start_pos-39) FOR least(NEW.start_pos,40))
       OR NEW.suffix<>substring(document.text_body FROM NEW.end_pos+1 FOR 40) THEN
        RAISE EXCEPTION 'annotation selector does not match snapshot' USING ERRCODE='23514';
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER reading_annotation_prepare BEFORE INSERT OR UPDATE ON research.reading_annotations
    FOR EACH ROW EXECUTE FUNCTION research.prepare_reading_annotation();
CREATE FUNCTION research.reading_annotation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.reading_annotation_revisions VALUES(NEW.id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER reading_annotation_log AFTER INSERT OR UPDATE ON research.reading_annotations
    FOR EACH ROW EXECUTE FUNCTION research.reading_annotation_history();
REVOKE ALL ON research.reading_documents,research.reading_annotations,research.reading_annotation_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.immutable_reading_document(),research.prepare_reading_annotation(),research.reading_annotation_history() FROM PUBLIC;
