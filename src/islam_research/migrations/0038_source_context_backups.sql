-- One backup enrollment per existing entry or annotation, never a duplicate note.
ALTER TABLE research.vault_sync_pages DROP CONSTRAINT vault_sync_pages_entry_id_fkey;
ALTER TABLE research.vault_sync_pages
 ADD COLUMN notebook_entry_id text REFERENCES research.notebook_entries(id),
 ADD COLUMN annotation_id text REFERENCES research.reading_annotations(id);
UPDATE research.vault_sync_pages SET notebook_entry_id=entry_id;
ALTER TABLE research.vault_sync_pages ADD CONSTRAINT vault_page_identity
 CHECK(entry_id ~ '^urn:research:(notebook|annotation):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
ALTER TABLE research.vault_sync_pages ADD CONSTRAINT vault_page_authority
 CHECK(num_nonnulls(notebook_entry_id,annotation_id)=1 AND entry_id=coalesce(notebook_entry_id,annotation_id));
CREATE FUNCTION research.validate_vault_page() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.entry_id<>OLD.entry_id THEN
  RAISE EXCEPTION 'backup identity is immutable' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM research.notebook_entries WHERE id=NEW.entry_id) THEN
  NEW.notebook_entry_id:=NEW.entry_id;NEW.annotation_id:=NULL;
 ELSIF EXISTS(SELECT 1 FROM research.reading_annotations WHERE id=NEW.entry_id) THEN
  NEW.annotation_id:=NEW.entry_id;NEW.notebook_entry_id:=NULL;
 ELSE
  RAISE EXCEPTION 'backup target is unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vault_page_target BEFORE INSERT OR UPDATE ON research.vault_sync_pages
 FOR EACH ROW EXECUTE FUNCTION research.validate_vault_page();
REVOKE ALL ON FUNCTION research.validate_vault_page() FROM PUBLIC;
CREATE TRIGGER annotation_vault_queue AFTER UPDATE ON research.reading_annotations
 FOR EACH ROW EXECUTE FUNCTION research.enqueue_vault_page();
