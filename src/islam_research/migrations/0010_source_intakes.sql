-- Immutable receipts make explicit source intake safe after a lost response.
-- Metadata and excerpts stay in the existing private record/document stores.
CREATE TABLE research.source_intakes (
    request_uuid uuid PRIMARY KEY,
    project_id text NOT NULL REFERENCES research.projects(id),
    input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
    source_record_id text NOT NULL,
    document_id text,
    declarations jsonb NOT NULL CHECK (jsonb_typeof(declarations)='object' AND length(declarations::text)<=50000),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,source_record_id) REFERENCES research.records(project_id,id),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id)
);
CREATE FUNCTION research.check_source_intake() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'intake receipts are immutable' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM research.records r WHERE r.project_id=NEW.project_id
        AND r.id=NEW.source_record_id AND r.kind IN ('source','work','edition') AND r.deleted_at IS NULL)
       OR (NEW.document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM research.reading_documents d WHERE d.project_id=NEW.project_id
           AND d.id=NEW.document_id AND d.source_record_id=NEW.source_record_id)) THEN
        RAISE EXCEPTION 'intake source and snapshot must share their project and identity' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION research.check_source_intake() FROM PUBLIC;
CREATE TRIGGER source_intake_guard BEFORE INSERT OR UPDATE OR DELETE ON research.source_intakes
    FOR EACH ROW EXECUTE FUNCTION research.check_source_intake();
REVOKE ALL ON research.source_intakes FROM PUBLIC;
