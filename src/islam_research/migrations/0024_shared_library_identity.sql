-- Additive owner-library aliases. Existing source/text/note rows are never rewritten.
CREATE FUNCTION research.library_id(kind text, identity jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 'urn:research:library:' || kind || ':' || encode(sha256(convert_to(identity::text,'UTF8')),'hex')
$$;

CREATE TABLE research.library_works (
 id text PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 2000),
 identity_basis text NOT NULL DEFAULT 'legacy_source_unresolved' CHECK(identity_basis='legacy_source_unresolved'),
 legacy_source_id text NOT NULL UNIQUE REFERENCES research.records(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.library_editions (
 id text PRIMARY KEY,
 work_id text NOT NULL REFERENCES research.library_works(id),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 1000),
 representation_url text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,work_id), UNIQUE(work_id,label,representation_url)
);
CREATE TABLE research.library_representations (
 id text PRIMARY KEY,
 work_id text NOT NULL,
 edition_id text NOT NULL,
 locator text NOT NULL,
 text_sha256 text NOT NULL CHECK(text_sha256 ~ '^[a-f0-9]{64}$'),
 notice_sha256 text NOT NULL CHECK(notice_sha256 ~ '^[a-f0-9]{64}$'),
 normalization text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(edition_id,work_id) REFERENCES research.library_editions(id,work_id),
 UNIQUE(id,work_id)
);
CREATE TABLE research.library_items (
 id text PRIMARY KEY,
 work_id text NOT NULL UNIQUE REFERENCES research.library_works(id),
 preferred_edition_id text,
 on_shelf boolean NOT NULL DEFAULT false,
 reading_status text NOT NULL DEFAULT 'needs_review' CHECK(reading_status IN ('needs_review','want_to_read','reading','finished')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 retained_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(preferred_edition_id,work_id) REFERENCES research.library_editions(id,work_id),
 UNIQUE(id,work_id)
);
CREATE TABLE research.library_source_bindings (
 source_record_id text PRIMARY KEY,
 project_id text NOT NULL,
 item_id text NOT NULL,
 work_id text NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,source_record_id) REFERENCES research.records(project_id,id),
 FOREIGN KEY(item_id,work_id) REFERENCES research.library_items(id,work_id),
 UNIQUE(source_record_id,project_id,work_id)
);
CREATE TABLE research.library_document_bindings (
 document_id text PRIMARY KEY,
 project_id text NOT NULL,
 source_record_id text NOT NULL,
 work_id text NOT NULL,
 representation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
 FOREIGN KEY(source_record_id,project_id,work_id) REFERENCES research.library_source_bindings(source_record_id,project_id,work_id),
 FOREIGN KEY(representation_id,work_id) REFERENCES research.library_representations(id,work_id)
);
CREATE TABLE research.library_project_items (
 item_id text NOT NULL REFERENCES research.library_items(id),
 project_id text NOT NULL REFERENCES research.projects(id),
 state text NOT NULL CHECK(state IN ('legacy','active','removed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(item_id,project_id)
);
CREATE TABLE research.library_requests (
 request_uuid uuid PRIMARY KEY,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL,
 changed_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.library_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_kind text NOT NULL CHECK(target_kind IN ('item','membership')),
 target_id text NOT NULL,
 project_id text NOT NULL DEFAULT '',
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(target_kind,target_id,project_id,revision)
);
CREATE INDEX library_documents_work ON research.library_document_bindings(work_id,document_id);
CREATE INDEX library_projects_project ON research.library_project_items(project_id,item_id) WHERE state<>'removed';

CREATE FUNCTION research.prepare_library_item() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.work_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.work_id,OLD.created_at)
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable library identity or stale revision' USING ERRCODE='23514'; END IF;
  NEW.retained_at:=CASE WHEN NEW.on_shelf THEN COALESCE(OLD.retained_at,clock_timestamp()) ELSE OLD.retained_at END;
 ELSE
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'initial revision must be one' USING ERRCODE='23514'; END IF;
  NEW.retained_at:=CASE WHEN NEW.on_shelf THEN clock_timestamp() ELSE NULL END;
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER library_item_prepare BEFORE INSERT OR UPDATE ON research.library_items
 FOR EACH ROW EXECUTE FUNCTION research.prepare_library_item();
CREATE FUNCTION research.prepare_library_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.item_id,NEW.project_id) IS DISTINCT FROM (OLD.item_id,OLD.project_id)
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable membership identity or stale revision' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'initial revision must be one' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER library_membership_prepare BEFORE INSERT OR UPDATE ON research.library_project_items
 FOR EACH ROW EXECUTE FUNCTION research.prepare_library_membership();
CREATE FUNCTION research.log_library_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_TABLE_NAME='library_items' THEN
  INSERT INTO research.library_events(target_kind,target_id,revision,snapshot) VALUES('item',NEW.id,NEW.revision,to_jsonb(NEW));
 ELSE
  INSERT INTO research.library_events(target_kind,target_id,project_id,revision,snapshot) VALUES('membership',NEW.item_id,NEW.project_id,NEW.revision,to_jsonb(NEW));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER library_item_log AFTER INSERT OR UPDATE ON research.library_items FOR EACH ROW EXECUTE FUNCTION research.log_library_event();
CREATE TRIGGER library_membership_log AFTER INSERT OR UPDATE ON research.library_project_items FOR EACH ROW EXECUTE FUNCTION research.log_library_event();

CREATE FUNCTION research.index_library_source(source_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
DECLARE r research.records%ROWTYPE; w text; item text;
BEGIN
 SELECT * INTO r FROM research.records WHERE id=source_id AND kind IN ('source','work','edition') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source missing' USING ERRCODE='23514'; END IF;
 w:=research.library_id('work',to_jsonb(r.id));item:=research.library_id('item',to_jsonb(r.id));
 INSERT INTO research.library_works(id,title,legacy_source_id) VALUES(w,r.title,r.id) ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_items(id,work_id,changed_by) VALUES(item,w,'identity-migration-v1') ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_source_bindings(source_record_id,project_id,item_id,work_id,source_revision)
  VALUES(r.id,r.project_id,item,w,r.revision) ON CONFLICT(source_record_id) DO NOTHING;
 INSERT INTO research.library_project_items(item_id,project_id,state,changed_by)
  VALUES(item,r.project_id,'legacy','identity-migration-v1') ON CONFLICT(item_id,project_id) DO NOTHING;
 INSERT INTO research.library_editions(id,work_id,label,representation_url)
  SELECT DISTINCT research.library_id('edition',jsonb_build_array(w,d.edition,d.representation_url)),w,d.edition,d.representation_url
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id=r.project_id ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_representations(id,work_id,edition_id,locator,text_sha256,notice_sha256,normalization)
  SELECT DISTINCT research.library_id('representation',jsonb_build_array(w,d.edition,d.representation_url,d.locator,d.text_sha256,
      encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization)),w,
   research.library_id('edition',jsonb_build_array(w,d.edition,d.representation_url)),d.locator,d.text_sha256,
   encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id=r.project_id ON CONFLICT(id) DO NOTHING;
 INSERT INTO research.library_document_bindings(document_id,project_id,source_record_id,work_id,representation_id)
  SELECT d.id,d.project_id,d.source_record_id,w,
   research.library_id('representation',jsonb_build_array(w,d.edition,d.representation_url,d.locator,d.text_sha256,
      encode(sha256(convert_to(d.source_notice,'UTF8')),'hex'),d.normalization))
  FROM research.reading_documents d WHERE d.source_record_id=r.id AND d.project_id=r.project_id ON CONFLICT(document_id) DO NOTHING;
 RETURN item;
END $$;

-- No title/provider-hint merging and no preferred edition, state or notebook guesses.
DO $$ DECLARE source_id text; BEGIN
 FOR source_id IN SELECT id FROM research.records WHERE kind IN ('source','work','edition') ORDER BY id LOOP
  PERFORM research.index_library_source(source_id);
 END LOOP;
END $$;

REVOKE ALL ON research.library_works,research.library_editions,research.library_representations,
 research.library_items,research.library_source_bindings,research.library_document_bindings,
 research.library_project_items,research.library_requests,research.library_events FROM PUBLIC;
REVOKE ALL ON FUNCTION research.library_id(text,jsonb),research.index_library_source(text),
 research.prepare_library_item(),research.prepare_library_membership(),research.log_library_event() FROM PUBLIC;
