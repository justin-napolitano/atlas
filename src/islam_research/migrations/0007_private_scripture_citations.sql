-- Private owner reference resolution. No canonical graph or publication writes.
CREATE TABLE research.scripture_citations (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    annotation_id text NOT NULL REFERENCES research.reading_annotations(id),
    document_id text NOT NULL,
    text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    candidate_key text NOT NULL CHECK (candidate_key='manual' OR candidate_key ~ '^[0-9a-f]{64}$'),
    parser_version text NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 100),
    detector_kind text NOT NULL CHECK (detector_kind IN ('explicit_numeric','english_narrative','owner_mapping')),
    match_start integer NOT NULL CHECK (match_start>=0),
    match_end integer NOT NULL CHECK (match_end>match_start AND match_end-match_start<=500),
    matched_text text NOT NULL CHECK (length(matched_text)=match_end-match_start),
    proposal jsonb NOT NULL,
    profile_id text NOT NULL CHECK (profile_id='tanzil-structure-1.0'),
    decision text NOT NULL CHECK (decision IN ('confirmed','dismissed')),
    chapter integer,
    ayah_start integer,
    ayah_end integer,
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id),
    UNIQUE(project_id,annotation_id,candidate_key),
    CHECK ((decision='confirmed' AND chapter IS NOT NULL AND ayah_start IS NOT NULL AND ayah_end IS NOT NULL)
        OR (decision='dismissed' AND chapter IS NULL AND ayah_start IS NULL AND ayah_end IS NULL))
);
CREATE INDEX scripture_citations_verse ON research.scripture_citations(project_id,chapter,ayah_start,ayah_end,id)
    WHERE decision='confirmed';
CREATE TABLE research.scripture_citation_revisions (
    citation_id text NOT NULL REFERENCES research.scripture_citations(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(citation_id,revision)
);
CREATE FUNCTION research.prepare_scripture_citation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    captured research.reading_annotations%ROWTYPE;
    -- Tanzil metadata v1.0; exact derivation/provenance in packaged resource.
    counts integer[] := ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];
BEGIN
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.project_id,NEW.annotation_id,NEW.document_id,NEW.text_sha256,
               NEW.candidate_key,NEW.parser_version,NEW.detector_kind,NEW.match_start,
               NEW.match_end,NEW.matched_text,NEW.proposal,NEW.profile_id)
           IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.annotation_id,OLD.document_id,OLD.text_sha256,
               OLD.candidate_key,OLD.parser_version,OLD.detector_kind,OLD.match_start,
               OLD.match_end,OLD.matched_text,OLD.proposal,OLD.profile_id) THEN
            RAISE EXCEPTION 'reference provenance cannot change' USING ERRCODE='23514';
        END IF;
        IF NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'reference revision must advance by one' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN
        RAISE EXCEPTION 'first reference revision must be one' USING ERRCODE='23514';
    END IF;
    SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
    IF NOT FOUND OR NEW.document_id<>captured.document_id OR NEW.text_sha256<>captured.text_sha256
       OR NEW.match_end>length(captured.exact)
       OR NEW.matched_text<>substring(captured.exact FROM NEW.match_start+1 FOR NEW.match_end-NEW.match_start) THEN
        RAISE EXCEPTION 'reference selector does not match captured passage' USING ERRCODE='23514';
    END IF;
    IF NEW.decision='confirmed' AND (NEW.chapter IS NULL OR NEW.chapter<1 OR NEW.chapter>114
       OR NEW.ayah_start IS NULL OR NEW.ayah_end IS NULL OR NEW.ayah_start<1
       OR NEW.ayah_end<NEW.ayah_start OR NEW.ayah_end>counts[NEW.chapter]) THEN
        RAISE EXCEPTION 'reference outside declared structure profile' USING ERRCODE='23514';
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER scripture_citation_prepare BEFORE INSERT OR UPDATE ON research.scripture_citations
    FOR EACH ROW EXECUTE FUNCTION research.prepare_scripture_citation();
CREATE FUNCTION research.scripture_citation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.scripture_citation_revisions VALUES(NEW.id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER scripture_citation_log AFTER INSERT OR UPDATE ON research.scripture_citations
    FOR EACH ROW EXECUTE FUNCTION research.scripture_citation_history();
REVOKE ALL ON research.scripture_citations,research.scripture_citation_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_scripture_citation(),research.scripture_citation_history() FROM PUBLIC;
