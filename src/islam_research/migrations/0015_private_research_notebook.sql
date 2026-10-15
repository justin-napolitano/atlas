-- Original notebook thoughts; existing passage-note bodies remain authoritative.
CREATE TABLE research.notebook_entries (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES research.projects(id),
 creation_sha256 text NOT NULL CHECK (creation_sha256 ~ '^[a-f0-9]{64}$'),
 record_id text, document_id text, annotation_id text,
 thought_type text NOT NULL CHECK (thought_type IN ('note','question','source_claim','interpretation','objection')),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
 links jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(links)='array' AND jsonb_array_length(links)<=25),
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
 review_state text NOT NULL DEFAULT 'pending' CHECK (review_state='pending'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 changed_by text NOT NULL CHECK (length(btrim(changed_by)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(project_id,id),
 FOREIGN KEY(project_id,record_id) REFERENCES research.records(project_id,id),
 FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
 FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
 CHECK ((document_id IS NULL AND annotation_id IS NULL) OR record_id IS NOT NULL),
 CHECK (annotation_id IS NULL OR document_id IS NOT NULL),
 CHECK (thought_type<>'source_claim' OR annotation_id IS NOT NULL)
);
CREATE INDEX notebook_project_order ON research.notebook_entries(project_id,id);
CREATE TABLE research.notebook_revisions (
 project_id text NOT NULL, entry_id text NOT NULL, revision integer NOT NULL, snapshot jsonb NOT NULL,
 PRIMARY KEY(entry_id,revision), FOREIGN KEY(project_id,entry_id) REFERENCES research.notebook_entries(project_id,id)
);
CREATE FUNCTION research.prepare_notebook_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE d research.reading_documents%ROWTYPE; a research.reading_annotations%ROWTYPE; link jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.project_id,NEW.creation_sha256,NEW.record_id,NEW.document_id,NEW.annotation_id,NEW.review_state)
   IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.creation_sha256,OLD.record_id,OLD.document_id,OLD.annotation_id,OLD.review_state)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable notebook target or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.created_at:=OLD.created_at;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first notebook revision must be one' USING ERRCODE='23514'; END IF;
 IF NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM research.records WHERE project_id=NEW.project_id AND id=NEW.record_id AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'notebook source not active in project' USING ERRCODE='23514'; END IF;
 IF NEW.document_id IS NOT NULL THEN
  SELECT * INTO d FROM research.reading_documents WHERE project_id=NEW.project_id AND id=NEW.document_id;
  IF NOT FOUND OR d.source_record_id<>NEW.record_id THEN RAISE EXCEPTION 'notebook document does not match source' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.annotation_id IS NOT NULL THEN
  SELECT * INTO a FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
  IF NOT FOUND OR a.document_id<>NEW.document_id OR a.text_sha256<>d.text_sha256
   OR substring(d.text_body FROM a.start_pos+1 FOR a.end_pos-a.start_pos)<>a.exact
  THEN RAISE EXCEPTION 'notebook annotation does not match exact document' USING ERRCODE='23514'; END IF;
 END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(NEW.links) LOOP
  IF jsonb_typeof(link)<>'object' OR NOT link ?& ARRAY['kind','id','rationale']
   OR (SELECT count(*) FROM jsonb_object_keys(link))<>3
   OR jsonb_typeof(link->'kind')<>'string' OR jsonb_typeof(link->'id')<>'string' OR jsonb_typeof(link->'rationale')<>'string'
   OR length(btrim(link->>'id')) NOT BETWEEN 1 AND 500 OR length(btrim(link->>'rationale')) NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'explicit located notebook link and rationale required' USING ERRCODE='23514'; END IF;
  IF link->>'kind'='record' THEN
   SELECT count(*) INTO n FROM research.records WHERE project_id=NEW.project_id AND id=link->>'id' AND deleted_at IS NULL;
  ELSIF link->>'kind'='annotation' THEN
   SELECT count(*) INTO n FROM research.reading_annotations x JOIN research.reading_documents y ON y.project_id=x.project_id AND y.id=x.document_id
    JOIN research.records z ON z.project_id=y.project_id AND z.id=y.source_record_id
    WHERE x.project_id=NEW.project_id AND x.id=link->>'id' AND z.deleted_at IS NULL;
  ELSIF link->>'kind'='entry' AND link->>'id'<>NEW.id THEN
   SELECT count(*) INTO n FROM research.notebook_entries WHERE project_id=NEW.project_id AND id=link->>'id' AND state='active';
  ELSE n:=0; END IF;
  IF n<>1 THEN RAISE EXCEPTION 'notebook link target unavailable in project' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.links)) <>
  (SELECT count(DISTINCT (value->>'kind',value->>'id')) FROM jsonb_array_elements(NEW.links))
 THEN RAISE EXCEPTION 'duplicate notebook connection' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER notebook_prepare BEFORE INSERT OR UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.prepare_notebook_entry();
CREATE FUNCTION research.notebook_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.notebook_revisions VALUES(NEW.project_id,NEW.id,NEW.revision,to_jsonb(NEW)); RETURN NEW; END $$;
CREATE TRIGGER notebook_log AFTER INSERT OR UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.notebook_history();
REVOKE ALL ON research.notebook_entries,research.notebook_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_notebook_entry(),research.notebook_history() FROM PUBLIC;
