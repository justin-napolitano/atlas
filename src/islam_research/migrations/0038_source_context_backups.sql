-- One backup enrollment per existing entry or annotation, never a duplicate note.
ALTER TABLE research.vault_sync_pages DROP CONSTRAINT vault_sync_pages_entry_id_fkey;
ALTER TABLE research.vault_sync_pages ADD CONSTRAINT vault_page_identity
 CHECK(entry_id ~ '^urn:research:(notebook|annotation):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
CREATE FUNCTION research.validate_vault_page() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.entry_id<>OLD.entry_id THEN
  RAISE EXCEPTION 'backup identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM research.notebook_entries WHERE id=NEW.entry_id)
    AND NOT EXISTS(SELECT 1 FROM research.reading_annotations WHERE id=NEW.entry_id) THEN
  RAISE EXCEPTION 'backup target is unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vault_page_target BEFORE INSERT OR UPDATE ON research.vault_sync_pages
 FOR EACH ROW EXECUTE FUNCTION research.validate_vault_page();
REVOKE ALL ON FUNCTION research.validate_vault_page() FROM PUBLIC;
CREATE TRIGGER annotation_vault_queue AFTER UPDATE ON research.reading_annotations
 FOR EACH ROW EXECUTE FUNCTION research.enqueue_vault_page();
