-- Native sources/intake keep the same authorities with NULL legacy origin.
ALTER TABLE research.source_intakes ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.source_intakes ADD COLUMN workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id);
ALTER TABLE research.quran_note_contexts ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.library_source_bindings ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.library_document_bindings ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE research.library_works DROP CONSTRAINT library_works_identity_basis_check;
ALTER TABLE research.library_works ADD CONSTRAINT library_works_identity_basis_check CHECK(identity_basis IN ('legacy_source_unresolved','source_unresolved'));
CREATE FUNCTION research.check_native_document_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF NEW.project_id IS NULL AND NOT EXISTS(SELECT 1 FROM research.records r WHERE r.id=NEW.source_record_id
   AND r.project_id IS NULL AND r.workspace_id=NEW.workspace_id AND r.kind IN ('source','work','edition') AND r.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'native document source unavailable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER native_document_source BEFORE INSERT ON research.reading_documents FOR EACH ROW EXECUTE FUNCTION research.check_native_document_source();
REVOKE ALL ON FUNCTION research.check_native_document_source() FROM PUBLIC;
CREATE OR REPLACE FUNCTION research.check_source_intake() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'intake receipts are immutable' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM research.records r WHERE r.project_id IS NOT DISTINCT FROM NEW.project_id
        AND r.id=NEW.source_record_id AND r.kind IN ('source','work','edition') AND r.deleted_at IS NULL)
       OR (NEW.document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM research.reading_documents d WHERE d.project_id IS NOT DISTINCT FROM NEW.project_id
           AND d.id=NEW.document_id AND d.source_record_id=NEW.source_record_id)) THEN
        RAISE EXCEPTION 'intake source and snapshot must share their project and identity' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION research.prepare_reading_annotation() RETURNS trigger
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
    SELECT * INTO document FROM research.reading_documents WHERE project_id IS NOT DISTINCT FROM NEW.project_id AND id=NEW.document_id;
    IF NOT FOUND OR NEW.text_sha256<>document.text_sha256 OR NEW.end_pos>length(document.text_body)
       OR NEW.exact<>substring(document.text_body FROM NEW.start_pos+1 FOR NEW.end_pos-NEW.start_pos)
       OR NEW.prefix<>substring(document.text_body FROM greatest(1,NEW.start_pos-39) FOR least(NEW.start_pos,40))
       OR NEW.suffix<>substring(document.text_body FROM NEW.end_pos+1 FOR 40) THEN
        RAISE EXCEPTION 'annotation selector does not match snapshot' USING ERRCODE='23514';
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION research.index_library_source(source_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
DECLARE r research.records%ROWTYPE; w text; item text;
BEGIN
 SELECT * INTO r FROM research.records WHERE workspace_id='owner' AND id=source_id AND kind IN ('source','work','edition') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source missing' USING ERRCODE='23514'; END IF;
 w:=research.library_id('work',to_jsonb(r.id));item:=research.library_id('item',to_jsonb(r.id));
 INSERT INTO research.library_works(id,title,legacy_source_id,identity_basis) VALUES(w,r.title,r.id,CASE WHEN r.project_id IS NULL THEN 'source_unresolved' ELSE 'legacy_source_unresolved' END) ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_items(id,work_id,changed_by) VALUES(item,w,'identity-migration-v1') ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_source_bindings(source_record_id,project_id,item_id,work_id,source_revision)
  VALUES(r.id,r.project_id,item,w,r.revision) ON CONFLICT(source_record_id) DO NOTHING;
 IF r.project_id IS NOT NULL THEN
 INSERT INTO research.library_project_items(item_id,project_id,state,changed_by)
  VALUES(item,r.project_id,'legacy','identity-migration-v1') ON CONFLICT(item_id,project_id) DO NOTHING;
 END IF;
 INSERT INTO research.library_editions(id,work_id,label,representation_url)
  SELECT DISTINCT research.library_id('edition',jsonb_build_array(w,d.edition,d.representation_url)),w,d.edition,d.representation_url
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id IS NOT DISTINCT FROM r.project_id ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_representations(id,work_id,edition_id,locator,text_sha256,notice_sha256,normalization)
  SELECT DISTINCT research.library_id('representation',jsonb_build_array(w,d.edition,d.representation_url,d.locator,d.text_sha256,
      encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization)),w,
   research.library_id('edition',jsonb_build_array(w,d.edition,d.representation_url)),d.locator,d.text_sha256,
   encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id IS NOT DISTINCT FROM r.project_id ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_document_bindings(document_id,project_id,source_record_id,work_id,representation_id)
  SELECT d.id,d.project_id,d.source_record_id,w,
   research.library_id('representation',jsonb_build_array(w,d.edition,d.representation_url,d.locator,d.text_sha256,
      encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization))
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id IS NOT DISTINCT FROM r.project_id ON CONFLICT(document_id) DO NOTHING;
 RETURN item;
END $$;

