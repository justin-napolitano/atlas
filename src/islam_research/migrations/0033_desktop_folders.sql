-- Real organization metadata, separate from canonical note bodies.
CREATE TABLE research.desktop_folders (
 id text PRIMARY KEY,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
 parent_id text REFERENCES research.desktop_folders(id),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','removed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(id IS DISTINCT FROM parent_id)
);
CREATE INDEX desktop_folder_parent ON research.desktop_folders(parent_id,id);
CREATE TABLE research.desktop_folder_history (
 folder_id text NOT NULL REFERENCES research.desktop_folders(id),revision integer NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(folder_id,revision)
);
ALTER TABLE research.desktop_page_positions ADD COLUMN folder_id text REFERENCES research.desktop_folders(id);
ALTER TABLE research.desktop_page_positions ADD CHECK(parent_id IS NULL OR folder_id IS NULL);
CREATE INDEX desktop_folder_pages ON research.desktop_page_positions(folder_id,entry_id);
ALTER TABLE research.desktop_page_intents ALTER COLUMN parent_id DROP NOT NULL;
ALTER TABLE research.desktop_page_intents ADD COLUMN folder_id text REFERENCES research.desktop_folders(id);
ALTER TABLE research.desktop_page_intents ADD CHECK((parent_id IS NULL) <> (folder_id IS NULL));
CREATE FUNCTION research.prepare_desktop_folder() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE ancestors integer:=0; descendants integer:=0; cycle boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(184514,173121);
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR OLD.state='removed' THEN
   RAISE EXCEPTION 'folder identity, revision or state changed' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 OR NEW.state<>'active' THEN RAISE EXCEPTION 'invalid first folder revision' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM desktop_folders WHERE id=NEW.parent_id AND state='active') THEN
  RAISE EXCEPTION 'folder parent unavailable' USING ERRCODE='23514'; END IF;
 WITH RECURSIVE parents(id,depth) AS (
  SELECT NEW.parent_id,1 WHERE NEW.parent_id IS NOT NULL UNION ALL
  SELECT f.parent_id,p.depth+1 FROM parents p JOIN desktop_folders f ON f.id=p.id WHERE f.parent_id IS NOT NULL AND p.depth<17
 ) SELECT coalesce(max(depth),0),coalesce(bool_or(id=NEW.id),false) INTO ancestors,cycle FROM parents;
 WITH RECURSIVE children(id,depth) AS (
  SELECT NEW.id,1 UNION ALL SELECT f.id,c.depth+1 FROM children c JOIN desktop_folders f ON f.parent_id=c.id
  WHERE f.state='active' AND c.depth<17
 ) SELECT max(depth) INTO descendants FROM children;
 IF cycle OR ancestors+descendants>16 THEN RAISE EXCEPTION 'folder cycle or depth limit' USING ERRCODE='23514'; END IF;
 IF NEW.state='removed' AND (EXISTS(SELECT 1 FROM desktop_folders WHERE parent_id=NEW.id AND state='active')
   OR EXISTS(SELECT 1 FROM desktop_page_positions WHERE folder_id=NEW.id)) THEN
  RAISE EXCEPTION 'folder must be empty' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION research.check_desktop_note_folder() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(184514,173121);
 IF NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM desktop_folders WHERE id=NEW.folder_id AND state='active') THEN
  RAISE EXCEPTION 'note folder unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION research.log_desktop_folder() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO desktop_folder_history VALUES(NEW.id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER desktop_folder_prepare BEFORE INSERT OR UPDATE ON research.desktop_folders FOR EACH ROW EXECUTE FUNCTION research.prepare_desktop_folder();
CREATE TRIGGER desktop_folder_log AFTER INSERT OR UPDATE ON research.desktop_folders FOR EACH ROW EXECUTE FUNCTION research.log_desktop_folder();
CREATE TRIGGER desktop_note_folder_check BEFORE INSERT OR UPDATE ON research.desktop_page_positions FOR EACH ROW EXECUTE FUNCTION research.check_desktop_note_folder();
CREATE TRIGGER desktop_intent_folder_check BEFORE INSERT OR UPDATE ON research.desktop_page_intents FOR EACH ROW EXECUTE FUNCTION research.check_desktop_note_folder();
REVOKE ALL ON research.desktop_folders,research.desktop_folder_history FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_desktop_folder(),research.check_desktop_note_folder(),research.log_desktop_folder() FROM PUBLIC;
