-- Personal completion is independent of translation and scholarly review.
CREATE TABLE research.quran_reading_progress (
 project_id text NOT NULL REFERENCES research.projects(id),
 chapter integer NOT NULL CHECK(chapter BETWEEN 1 AND 114),
 ayah integer NOT NULL CHECK(ayah BETWEEN 1 AND 286),
 is_read boolean NOT NULL,
 read_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(btrim(changed_by)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,chapter,ayah),
 CHECK(is_read=(read_at IS NOT NULL)),
 CHECK(ayah <= (ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6])[chapter])
);
CREATE TABLE research.quran_progress_revisions (
 project_id text NOT NULL, chapter integer NOT NULL, ayah integer NOT NULL,
 revision integer NOT NULL, snapshot jsonb NOT NULL,
 PRIMARY KEY(project_id,chapter,ayah,revision),
 FOREIGN KEY(project_id,chapter,ayah) REFERENCES research.quran_reading_progress(project_id,chapter,ayah)
);
CREATE FUNCTION research.prepare_quran_progress() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.project_id,NEW.chapter,NEW.ayah) IS DISTINCT FROM (OLD.project_id,OLD.chapter,OLD.ayah)
   OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable progress identity or invalid revision' USING ERRCODE='23514'; END IF;
  NEW.read_at:=CASE WHEN NEW.is_read THEN COALESCE(OLD.read_at,clock_timestamp()) ELSE NULL END;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first progress revision must be one' USING ERRCODE='23514';
 ELSE NEW.read_at:=CASE WHEN NEW.is_read THEN clock_timestamp() ELSE NULL END;
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER quran_progress_prepare BEFORE INSERT OR UPDATE ON research.quran_reading_progress
 FOR EACH ROW EXECUTE FUNCTION research.prepare_quran_progress();
CREATE FUNCTION research.quran_progress_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO research.quran_progress_revisions VALUES(NEW.project_id,NEW.chapter,NEW.ayah,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER quran_progress_log AFTER INSERT OR UPDATE ON research.quran_reading_progress
 FOR EACH ROW EXECUTE FUNCTION research.quran_progress_history();
REVOKE ALL ON research.quran_reading_progress,research.quran_progress_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_quran_progress(),research.quran_progress_history() FROM PUBLIC;
