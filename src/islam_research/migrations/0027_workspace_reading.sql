-- Native owner reading places are not projects. Legacy places remain distinct.

-- Private semantic resume location; independent of viewport geometry and review status.
CREATE TABLE research.workspace_quran_places (
 workspace_id text PRIMARY KEY DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 resource_key text NOT NULL CHECK(resource_key IN ('tanzil-uthmani','itani-god')),
 chapter integer NOT NULL CHECK(chapter BETWEEN 1 AND 114),
 ayah integer NOT NULL CHECK(ayah BETWEEN 1 AND 286),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(ayah <= (ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6])[chapter])
);
REVOKE ALL ON research.workspace_quran_places FROM PUBLIC;

-- Personal completion is independent of translation and scholarly review.
CREATE TABLE research.workspace_quran_reading_progress (
 workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 chapter integer NOT NULL CHECK(chapter BETWEEN 1 AND 114),
 ayah integer NOT NULL CHECK(ayah BETWEEN 1 AND 286),
 is_read boolean NOT NULL,
 read_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,chapter,ayah),
 CHECK(is_read=(read_at IS NOT NULL)),
 CHECK(ayah <= (ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6])[chapter])
);
CREATE TABLE research.workspace_quran_progress_revisions (
 workspace_id text NOT NULL, chapter integer NOT NULL, ayah integer NOT NULL,
 revision integer NOT NULL, snapshot jsonb NOT NULL,
 PRIMARY KEY(workspace_id,chapter,ayah,revision),
 FOREIGN KEY(workspace_id,chapter,ayah) REFERENCES research.workspace_quran_reading_progress(workspace_id,chapter,ayah)
);
CREATE FUNCTION research.prepare_workspace_quran_progress() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.workspace_id,NEW.chapter,NEW.ayah) IS DISTINCT FROM (OLD.workspace_id,OLD.chapter,OLD.ayah)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable progress identity or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.read_at:=CASE WHEN NEW.is_read THEN COALESCE(OLD.read_at,clock_timestamp()) ELSE NULL END;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first progress revision must be one' USING ERRCODE='23514';
 ELSE NEW.read_at:=CASE WHEN NEW.is_read THEN clock_timestamp() ELSE NULL END;
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER quran_progress_prepare BEFORE INSERT OR UPDATE ON research.workspace_quran_reading_progress
 FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_quran_progress();
CREATE FUNCTION research.workspace_quran_progress_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.workspace_quran_progress_revisions VALUES(NEW.workspace_id,NEW.chapter,NEW.ayah,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER quran_progress_log AFTER INSERT OR UPDATE ON research.workspace_quran_reading_progress
 FOR EACH ROW EXECUTE FUNCTION research.workspace_quran_progress_history();
REVOKE ALL ON research.workspace_quran_reading_progress,research.workspace_quran_progress_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_workspace_quran_progress(),research.workspace_quran_progress_history() FROM PUBLIC;

CREATE TABLE research.workspace_gutenberg_places (
 workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 book_id integer NOT NULL,
 version text NOT NULL,
 section integer NOT NULL CHECK(section BETWEEN 0 AND 1000),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 12000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,book_id),
 FOREIGN KEY(book_id,version) REFERENCES research.gutenberg_books(book_id,version)
);
REVOKE ALL ON research.workspace_gutenberg_places FROM PUBLIC;

ALTER TABLE research.reading_drafts ALTER COLUMN project_id DROP NOT NULL;
-- Pending capture classification may change; source selectors and saved annotation types remain immutable.
CREATE OR REPLACE FUNCTION research.prepare_reading_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE source_kind text; document research.reading_documents%ROWTYPE; captured research.reading_annotations%ROWTYPE; baseline jsonb;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.record_id,NEW.context_kind,NEW.document_id,NEW.annotation_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.prefix,NEW.suffix,NEW.base_revision,NEW.base_snapshot)
           IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.record_id,OLD.context_kind,OLD.document_id,OLD.annotation_id,OLD.text_sha256,OLD.start_pos,OLD.end_pos,OLD.exact,OLD.prefix,OLD.suffix,OLD.base_revision,OLD.base_snapshot)
           OR (NEW.context_kind<>'capture' AND NEW.capture_kind IS DISTINCT FROM OLD.capture_kind)
           OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'draft anchor or revision changed' USING ERRCODE='23514'; END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first draft revision must be one' USING ERRCODE='23514'; END IF;
    SELECT kind INTO source_kind FROM research.records WHERE project_id IS NOT DISTINCT FROM NEW.project_id AND id=NEW.record_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'draft requires active record in project' USING ERRCODE='23514'; END IF;
    IF NEW.context_kind<>'record_note' THEN
        SELECT * INTO document FROM research.reading_documents WHERE project_id IS NOT DISTINCT FROM NEW.project_id AND id=NEW.document_id;
        IF NOT FOUND OR source_kind NOT IN ('source','work','edition') OR document.source_record_id<>NEW.record_id OR NEW.text_sha256<>document.text_sha256 OR NEW.end_pos>length(document.text_body)
          OR NEW.exact<>substring(document.text_body FROM NEW.start_pos+1 FOR NEW.end_pos-NEW.start_pos)
          OR NEW.prefix<>substring(document.text_body FROM greatest(1,NEW.start_pos-39) FOR least(NEW.start_pos,40))
          OR NEW.suffix<>substring(document.text_body FROM NEW.end_pos+1 FOR 40) THEN RAISE EXCEPTION 'draft selector does not match source document' USING ERRCODE='23514'; END IF;
        IF NEW.context_kind='annotation' THEN
            SELECT * INTO captured FROM research.reading_annotations WHERE project_id IS NOT DISTINCT FROM NEW.project_id AND id=NEW.annotation_id;
            IF NOT FOUND OR ROW(captured.document_id,captured.text_sha256,captured.start_pos,captured.end_pos,captured.exact,captured.capture_kind)
              IS DISTINCT FROM ROW(NEW.document_id,NEW.text_sha256,NEW.start_pos,NEW.end_pos,NEW.exact,NEW.capture_kind) THEN RAISE EXCEPTION 'draft does not match saved annotation' USING ERRCODE='23514'; END IF;
        END IF;
    END IF;
    IF TG_OP='INSERT' THEN
        IF NEW.context_kind='capture' THEN NEW.base_snapshot:='{}'::jsonb;
        ELSIF NEW.context_kind='record_note' AND NEW.base_revision=0 THEN NEW.base_snapshot:='{"note":"","revision":0}'::jsonb;
        ELSE
            IF NEW.context_kind='record_note' THEN
                SELECT snapshot INTO baseline FROM research.personal_state_revisions WHERE record_id=NEW.record_id AND revision=NEW.base_revision AND (snapshot->>'project_id') IS NOT DISTINCT FROM NEW.project_id;
                IF FOUND THEN NEW.base_snapshot:=jsonb_build_object('note',baseline->>'note','revision',NEW.base_revision); END IF;
            ELSE
                SELECT snapshot INTO baseline FROM research.reading_annotation_revisions WHERE annotation_id=NEW.annotation_id AND revision=NEW.base_revision AND (snapshot->>'project_id') IS NOT DISTINCT FROM NEW.project_id;
                IF FOUND THEN NEW.base_snapshot:=jsonb_build_object('body',baseline->>'body','mark_style',coalesce(baseline->>'mark_style','highlight'),'revision',NEW.base_revision); END IF;
            END IF;
            IF baseline IS NULL THEN RAISE EXCEPTION 'draft baseline revision is missing' USING ERRCODE='23514'; END IF;
        END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;

CREATE TABLE research.workspace_annotation_trash (
 annotation_id text PRIMARY KEY REFERENCES research.reading_annotations(id),
 target_revision integer NOT NULL CHECK(target_revision>0),state text NOT NULL CHECK(state IN ('active','trashed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.workspace_annotation_trash_history (
 annotation_id text NOT NULL REFERENCES research.reading_annotations(id),revision integer NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(annotation_id,revision)
);
CREATE FUNCTION research.prepare_workspace_annotation_trash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE actual integer;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.annotation_id IS DISTINCT FROM OLD.annotation_id OR NEW.revision<>OLD.revision+1)
  OR TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'invalid workspace trash revision' USING ERRCODE='23514';END IF;
 SELECT revision INTO actual FROM research.reading_annotations WHERE id=NEW.annotation_id AND project_id IS NULL FOR UPDATE;
 IF actual IS NULL OR actual<>NEW.target_revision THEN RAISE EXCEPTION 'native note revision unavailable' USING ERRCODE='23514';END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION research.log_workspace_annotation_trash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.workspace_annotation_trash_history VALUES(NEW.annotation_id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER workspace_annotation_trash_prepare BEFORE INSERT OR UPDATE ON research.workspace_annotation_trash FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_annotation_trash();
CREATE TRIGGER workspace_annotation_trash_log AFTER INSERT OR UPDATE ON research.workspace_annotation_trash FOR EACH ROW EXECUTE FUNCTION research.log_workspace_annotation_trash();
CREATE FUNCTION research.guard_native_trashed_annotation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM research.workspace_annotation_trash WHERE annotation_id=OLD.id AND state='trashed')
 THEN RAISE EXCEPTION 'restore native writing before editing' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER workspace_native_trash_guard BEFORE UPDATE ON research.reading_annotations FOR EACH ROW EXECUTE FUNCTION research.guard_native_trashed_annotation();

REVOKE ALL ON research.workspace_annotation_trash,research.workspace_annotation_trash_history FROM PUBLIC;

ALTER TABLE research.personal_states ALTER COLUMN project_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION research.prepare_personal_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.record_id <> OLD.record_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
            RAISE EXCEPTION 'personal state identity cannot change' USING ERRCODE = '23514';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'revision must advance by one' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.revision <> 1 THEN
        RAISE EXCEPTION 'first revision must be one' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM research.records r WHERE r.id=NEW.record_id AND r.project_id IS NOT DISTINCT FROM NEW.project_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'personal state source unavailable' USING ERRCODE='23503'; END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION research.prepare_workspace_annotation_trash(),research.log_workspace_annotation_trash(),research.guard_native_trashed_annotation() FROM PUBLIC;

-- One confirmed private reading place per project. Notes remain separate.
CREATE TABLE research.workspace_reading_desks (
    workspace_id text PRIMARY KEY DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
    record_id text NOT NULL,
    document_id text,
    annotation_id text,
    start_pos integer,
    end_pos integer,
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(record_id) REFERENCES research.records(id),
    FOREIGN KEY(document_id) REFERENCES research.reading_documents(id),
    FOREIGN KEY(annotation_id) REFERENCES research.reading_annotations(id),
    CHECK ((document_id IS NULL AND annotation_id IS NULL AND start_pos IS NULL AND end_pos IS NULL)
        OR (document_id IS NOT NULL AND start_pos IS NOT NULL AND end_pos IS NOT NULL AND start_pos>=0 AND end_pos>=start_pos))
);
CREATE TABLE research.workspace_reading_desk_revisions (
    workspace_id text NOT NULL REFERENCES research.owner_workspaces(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(workspace_id,revision)
);
CREATE FUNCTION research.prepare_workspace_reading_desk() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    source_kind text;
    document research.reading_documents%ROWTYPE;
    captured research.reading_annotations%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'reading place identity or revision changed' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN
        RAISE EXCEPTION 'first reading place revision must be one' USING ERRCODE='23514';
    END IF;
    SELECT kind INTO source_kind FROM research.records WHERE project_id IS NULL AND id=NEW.record_id AND deleted_at IS NULL;
    IF NOT FOUND OR source_kind NOT IN ('source','work','edition') THEN
        RAISE EXCEPTION 'reading place requires active source in project' USING ERRCODE='23514';
    END IF;
    IF NEW.document_id IS NOT NULL THEN
        SELECT * INTO document FROM research.reading_documents WHERE project_id IS NULL AND id=NEW.document_id;
        IF NOT FOUND OR document.source_record_id<>NEW.record_id OR NEW.end_pos>length(document.text_body) THEN
            RAISE EXCEPTION 'reading place does not match source representation' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.annotation_id IS NOT NULL THEN
        SELECT * INTO captured FROM research.reading_annotations WHERE project_id IS NULL AND id=NEW.annotation_id;
        IF NOT FOUND OR captured.document_id<>NEW.document_id OR captured.start_pos<>NEW.start_pos OR captured.end_pos<>NEW.end_pos THEN
            RAISE EXCEPTION 'reading place does not match captured annotation' USING ERRCODE='23514';
        END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER reading_desk_prepare BEFORE INSERT OR UPDATE ON research.workspace_reading_desks
    FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_reading_desk();
CREATE FUNCTION research.workspace_reading_desk_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.workspace_reading_desk_revisions VALUES(NEW.workspace_id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER reading_desk_log AFTER INSERT OR UPDATE ON research.workspace_reading_desks
    FOR EACH ROW EXECUTE FUNCTION research.workspace_reading_desk_history();
REVOKE ALL ON research.workspace_reading_desks,research.workspace_reading_desk_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_workspace_reading_desk(),research.workspace_reading_desk_history() FROM PUBLIC;
