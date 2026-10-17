-- Visibility/tombstones only. Content and all source links remain at their original IDs.
CREATE TABLE research.note_trash (
 project_id text NOT NULL REFERENCES research.projects(id),
 target_kind text NOT NULL CHECK(target_kind IN ('entry','annotation')), target_id text NOT NULL,
 target_revision integer NOT NULL CHECK(target_revision>0),
 state text NOT NULL CHECK(state IN ('active','trashed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,target_kind,target_id)
);
CREATE TABLE research.note_trash_revisions (
 project_id text NOT NULL,target_kind text NOT NULL,target_id text NOT NULL,revision integer NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(project_id,target_kind,target_id,revision),
 FOREIGN KEY(project_id,target_kind,target_id) REFERENCES research.note_trash(project_id,target_kind,target_id)
);
CREATE FUNCTION research.prepare_note_trash() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE actual integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.project_id,NEW.target_kind,NEW.target_id) IS DISTINCT FROM (OLD.project_id,OLD.target_kind,OLD.target_id)
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable trash target or invalid revision' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first trash revision must be one' USING ERRCODE='23514'; END IF;
 IF NEW.target_kind='entry' THEN
  SELECT revision INTO actual FROM research.notebook_entries WHERE project_id=NEW.project_id AND id=NEW.target_id FOR UPDATE;
 ELSE
  SELECT revision INTO actual FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.target_id FOR UPDATE;
 END IF;
 IF actual IS NULL OR actual<>NEW.target_revision THEN RAISE EXCEPTION 'trash target revision unavailable' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER note_trash_prepare BEFORE INSERT OR UPDATE ON research.note_trash FOR EACH ROW EXECUTE FUNCTION research.prepare_note_trash();
CREATE FUNCTION research.note_trash_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.note_trash_revisions VALUES(NEW.project_id,NEW.target_kind,NEW.target_id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER note_trash_log AFTER INSERT OR UPDATE ON research.note_trash FOR EACH ROW EXECUTE FUNCTION research.note_trash_history();
REVOKE ALL ON research.note_trash,research.note_trash_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_note_trash(),research.note_trash_history() FROM PUBLIC;
CREATE FUNCTION research.guard_trashed_writing() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM research.note_trash WHERE project_id=OLD.project_id AND target_id=OLD.id
  AND target_kind=CASE WHEN TG_TABLE_NAME='notebook_entries' THEN 'entry' ELSE 'annotation' END AND state='trashed')
 THEN RAISE EXCEPTION 'restore trashed writing before editing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notebook_trash_guard BEFORE UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.guard_trashed_writing();
CREATE TRIGGER annotation_trash_guard BEFORE UPDATE ON research.reading_annotations FOR EACH ROW EXECUTE FUNCTION research.guard_trashed_writing();
REVOKE ALL ON FUNCTION research.guard_trashed_writing() FROM PUBLIC;
