-- Source-located reading material, distinct from reference detection or review.
ALTER TABLE research.scripture_citations ADD CONSTRAINT scripture_citations_project_identity UNIQUE(project_id,id);
CREATE TABLE research.verse_materials (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    annotation_id text NOT NULL,
    document_id text NOT NULL,
    text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    creation_sha256 text NOT NULL CHECK (creation_sha256 ~ '^[0-9a-f]{64}$'),
    profile_id text NOT NULL CHECK (profile_id='tanzil-structure-1.0'),
    chapter integer NOT NULL CHECK (chapter BETWEEN 1 AND 114),
    ayah_start integer NOT NULL CHECK (ayah_start>=1),
    ayah_end integer NOT NULL CHECK (ayah_end>=ayah_start),
    material_kind text NOT NULL CHECK (material_kind IN ('arabic_text','translation','tafsir','linguistic_annotation','scholarship')),
    link_kind text NOT NULL CHECK (link_kind IN ('representation','explicit_citation','discussion','interpretive_claim')),
    citation_basis text NOT NULL CHECK (citation_basis IN ('none','resolved_reference','owner_identified')),
    citation_id text,
    citation_snapshot jsonb,
    marker_start integer,
    marker_end integer,
    marker_text text,
    attribution text NOT NULL CHECK (length(trim(attribution)) BETWEEN 1 AND 2000),
    language_tag text NOT NULL CHECK (length(language_tag) BETWEEN 1 AND 100),
    source_scope text NOT NULL CHECK (length(trim(source_scope)) BETWEEN 1 AND 10000),
    assertion_mode text NOT NULL CHECK (assertion_mode IN ('none','quotation','paraphrase')),
    assertion_text text NOT NULL CHECK (length(assertion_text)<=5000),
    reading_note text NOT NULL CHECK (length(reading_note)<=2000),
    period_note text NOT NULL CHECK (length(period_note)<=2000),
    tradition_note text NOT NULL CHECK (length(tradition_note)<=2000),
    context_basis text NOT NULL CHECK (length(context_basis)<=2000),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
    review_state text NOT NULL DEFAULT 'pending' CHECK (review_state='pending'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
    FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
    FOREIGN KEY(project_id,citation_id) REFERENCES research.scripture_citations(project_id,id),
    CHECK ((material_kind IN ('arabic_text','translation')) = (link_kind='representation')),
    CHECK ((link_kind='interpretive_claim' AND assertion_mode<>'none' AND length(trim(assertion_text))>0)
        OR (link_kind<>'interpretive_claim' AND assertion_mode='none' AND assertion_text='')),
    CHECK ((period_note='' AND tradition_note='') OR length(trim(context_basis))>0),
    CHECK ((link_kind='explicit_citation' AND citation_basis<>'none') OR (link_kind<>'explicit_citation' AND citation_basis='none')),
    CHECK ((citation_basis='resolved_reference' AND citation_id IS NOT NULL AND citation_snapshot IS NOT NULL)
        OR (citation_basis<>'resolved_reference' AND citation_id IS NULL AND citation_snapshot IS NULL)),
    CHECK ((citation_basis<>'none' AND marker_start IS NOT NULL AND marker_end IS NOT NULL
        AND marker_text IS NOT NULL AND marker_start>=0 AND marker_end>marker_start
        AND length(marker_text)=marker_end-marker_start)
        OR (citation_basis='none' AND marker_start IS NULL AND marker_end IS NULL AND marker_text IS NULL))
);
CREATE INDEX verse_materials_active_reference ON research.verse_materials(project_id,chapter,ayah_start,ayah_end,id) WHERE state='active';
CREATE INDEX verse_materials_annotation ON research.verse_materials(project_id,annotation_id,id);
CREATE TABLE research.verse_material_revisions (
    material_id text NOT NULL REFERENCES research.verse_materials(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(material_id,revision)
);
CREATE FUNCTION research.prepare_verse_material() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    captured research.reading_annotations%ROWTYPE;
    cited research.scripture_citations%ROWTYPE;
    counts integer[] := ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.annotation_id,NEW.document_id,NEW.text_sha256,NEW.creation_sha256,
            NEW.profile_id,NEW.chapter,NEW.ayah_start,NEW.ayah_end,NEW.material_kind,NEW.link_kind,
            NEW.citation_basis,NEW.citation_id,NEW.citation_snapshot,NEW.marker_start,NEW.marker_end,NEW.marker_text)
        IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.annotation_id,OLD.document_id,OLD.text_sha256,OLD.creation_sha256,
            OLD.profile_id,OLD.chapter,OLD.ayah_start,OLD.ayah_end,OLD.material_kind,OLD.link_kind,
            OLD.citation_basis,OLD.citation_id,OLD.citation_snapshot,OLD.marker_start,OLD.marker_end,OLD.marker_text) THEN
            RAISE EXCEPTION 'verse material provenance cannot change' USING ERRCODE='23514';
        END IF;
        IF NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'verse material revision must advance by one' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 OR NEW.state<>'active' THEN
        RAISE EXCEPTION 'verse material starts active at revision one' USING ERRCODE='23514';
    END IF;
    IF NEW.ayah_end>counts[NEW.chapter] THEN
        RAISE EXCEPTION 'verse material outside declared structure profile' USING ERRCODE='23514';
    END IF;
    SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
    IF NOT FOUND OR NEW.document_id<>captured.document_id OR NEW.text_sha256<>captured.text_sha256 THEN
        RAISE EXCEPTION 'verse material must retain its captured source' USING ERRCODE='23514';
    END IF;
    IF NEW.assertion_mode='quotation' AND NEW.assertion_text<>captured.exact THEN
        RAISE EXCEPTION 'quotation must equal the located source selection' USING ERRCODE='23514';
    END IF;
    IF NEW.citation_basis<>'none' AND (NEW.marker_end>length(captured.exact)
        OR NEW.marker_text<>substring(captured.exact FROM NEW.marker_start+1 FOR NEW.marker_end-NEW.marker_start)) THEN
        RAISE EXCEPTION 'citation marker must match the captured selection' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NEW.citation_basis='resolved_reference' THEN
        SELECT * INTO cited FROM research.scripture_citations WHERE project_id=NEW.project_id AND id=NEW.citation_id FOR SHARE;
        IF NOT FOUND OR cited.decision<>'confirmed' OR cited.detector_kind='owner_mapping'
            OR cited.annotation_id<>NEW.annotation_id OR cited.profile_id<>NEW.profile_id
            OR cited.chapter<>NEW.chapter OR cited.ayah_start<>NEW.ayah_start OR cited.ayah_end<>NEW.ayah_end
            OR NEW.citation_snapshot<>to_jsonb(cited) OR cited.match_start<>NEW.marker_start
            OR cited.match_end<>NEW.marker_end OR cited.matched_text<>NEW.marker_text THEN
            RAISE EXCEPTION 'confirmed exact citation evidence required' USING ERRCODE='23514';
        END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER verse_material_prepare BEFORE INSERT OR UPDATE ON research.verse_materials
    FOR EACH ROW EXECUTE FUNCTION research.prepare_verse_material();
CREATE FUNCTION research.verse_material_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.verse_material_revisions VALUES(NEW.id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER verse_material_log AFTER INSERT OR UPDATE ON research.verse_materials
    FOR EACH ROW EXECUTE FUNCTION research.verse_material_history();
REVOKE ALL ON research.verse_materials,research.verse_material_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_verse_material(),research.verse_material_history() FROM PUBLIC;
