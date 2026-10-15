-- Private draft lexicon, reusing canonical concept identities without RDF writes.
CREATE TABLE research.lexicon_entries (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL REFERENCES research.projects(id),
    entry_type text NOT NULL DEFAULT 'undetermined' CHECK (entry_type IN ('word','multiword','undetermined')),
    scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 10000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id)
);
CREATE TABLE research.lexicon_forms (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    entry_id text NOT NULL,
    form_kind text NOT NULL DEFAULT 'undetermined' CHECK (form_kind IN ('canonical','other','undetermined')),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    FOREIGN KEY(project_id,entry_id) REFERENCES research.lexicon_entries(project_id,id)
);
CREATE UNIQUE INDEX lexicon_canonical_form ON research.lexicon_forms(project_id,entry_id) WHERE form_kind='canonical';
CREATE TABLE research.lexicon_representations (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    form_id text NOT NULL,
    origin_annotation_id text NOT NULL,
    origin_start integer NOT NULL CHECK (origin_start>=0),
    origin_end integer NOT NULL CHECK (origin_end>origin_start AND origin_end-origin_start<=500),
    written_rep text NOT NULL CHECK (length(trim(written_rep)) BETWEEN 1 AND 500),
    language_tag text NOT NULL CHECK (length(language_tag) BETWEEN 1 AND 100 AND language_tag ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'),
    script_tag text NOT NULL CHECK (script_tag='' OR script_tag ~ '^[A-Za-z]{4}$'),
    transliteration_scheme text NOT NULL CHECK (length(transliteration_scheme)<=500),
    search_key text NOT NULL CHECK (length(search_key)<=10000),
    search_version text NOT NULL CHECK (search_version='lexicon-search-1'),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    UNIQUE(project_id,form_id,written_rep,language_tag,script_tag,transliteration_scheme),
    FOREIGN KEY(project_id,form_id) REFERENCES research.lexicon_forms(project_id,id),
    FOREIGN KEY(project_id,origin_annotation_id) REFERENCES research.reading_annotations(project_id,id)
);
CREATE INDEX lexicon_representation_search ON research.lexicon_representations USING gin(to_tsvector('simple',search_key));
CREATE TABLE research.lexicon_senses (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    entry_id text NOT NULL,
    concept_id text NOT NULL,
    scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 10000),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
    review_state text NOT NULL DEFAULT 'pending' CHECK (review_state='pending'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    UNIQUE(project_id,id,concept_id),
    UNIQUE(project_id,entry_id,concept_id),
    FOREIGN KEY(project_id,entry_id) REFERENCES research.lexicon_entries(project_id,id),
    FOREIGN KEY(project_id,concept_id) REFERENCES research.records(project_id,id)
);
CREATE INDEX lexicon_senses_concept ON research.lexicon_senses(project_id,concept_id,id);
CREATE TABLE research.lexicon_definitions (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    concept_id text NOT NULL,
    sense_id text,
    annotation_id text NOT NULL,
    definition_kind text NOT NULL CHECK (definition_kind IN ('source_explicit','reference_gloss','owner_paraphrase','machine_proposed')),
    wording_mode text NOT NULL CHECK (wording_mode IN ('quotation','paraphrase')),
    body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
    attribution text NOT NULL CHECK (length(trim(attribution)) BETWEEN 1 AND 2000),
    attribution_person_id text,
    scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 10000),
    dating_note text NOT NULL CHECK (length(dating_note)<=2000),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    proposal_tool text NOT NULL CHECK (length(proposal_tool)<=500),
    proposal_version text NOT NULL CHECK (length(proposal_version)<=500),
    proposal_activity text NOT NULL CHECK (length(proposal_activity)<=500),
    search_key text NOT NULL CHECK (length(search_key)<=20000),
    search_version text NOT NULL CHECK (search_version='lexicon-search-1'),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
    review_state text NOT NULL DEFAULT 'pending' CHECK (review_state='pending'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    FOREIGN KEY(project_id,concept_id) REFERENCES research.records(project_id,id),
    FOREIGN KEY(project_id,sense_id,concept_id) REFERENCES research.lexicon_senses(project_id,id,concept_id),
    FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
    FOREIGN KEY(project_id,attribution_person_id) REFERENCES research.records(project_id,id),
    CHECK ((definition_kind='machine_proposed' AND length(trim(proposal_tool))>0 AND length(trim(proposal_version))>0 AND length(trim(proposal_activity))>0)
        OR (definition_kind<>'machine_proposed' AND proposal_tool='' AND proposal_version='' AND proposal_activity=''))
);
CREATE INDEX lexicon_definitions_concept ON research.lexicon_definitions(project_id,concept_id,id);
CREATE INDEX lexicon_definition_search ON research.lexicon_definitions USING gin(to_tsvector('simple',search_key));
CREATE TABLE research.lexicon_occurrences (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL,
    representation_id text NOT NULL,
    sense_id text NOT NULL,
    annotation_id text NOT NULL,
    document_id text NOT NULL,
    text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    term_start integer NOT NULL CHECK (term_start>=0),
    term_end integer NOT NULL CHECK (term_end>term_start AND term_end-term_start<=500),
    exact text NOT NULL CHECK (length(exact)=term_end-term_start),
    rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 2000),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
    review_state text NOT NULL DEFAULT 'pending' CHECK (review_state='pending'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,id),
    UNIQUE(project_id,annotation_id,term_start,term_end,representation_id,sense_id),
    FOREIGN KEY(project_id,representation_id) REFERENCES research.lexicon_representations(project_id,id),
    FOREIGN KEY(project_id,sense_id) REFERENCES research.lexicon_senses(project_id,id),
    FOREIGN KEY(project_id,annotation_id) REFERENCES research.reading_annotations(project_id,id),
    FOREIGN KEY(project_id,document_id) REFERENCES research.reading_documents(project_id,id)
);
CREATE INDEX lexicon_occurrences_sense ON research.lexicon_occurrences(project_id,sense_id,id);
CREATE TABLE research.lexicon_revisions (
    entity_table text NOT NULL,
    entity_id text NOT NULL,
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(entity_table,entity_id,revision)
);
CREATE TABLE research.lexicon_captures (
    request_uuid uuid PRIMARY KEY,
    project_id text NOT NULL REFERENCES research.projects(id),
    input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION research.prepare_lexicon_entity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE
    mutable text[];
    captured research.reading_annotations%ROWTYPE;
    entry text;
    matching_concept text;
BEGIN
    mutable := CASE TG_TABLE_NAME
        WHEN 'lexicon_entries' THEN ARRAY['scope','entry_type']
        WHEN 'lexicon_forms' THEN ARRAY['rationale','form_kind']
        WHEN 'lexicon_representations' THEN ARRAY['rationale']
        WHEN 'lexicon_senses' THEN ARRAY['scope','rationale','state']
        WHEN 'lexicon_definitions' THEN ARRAY['wording_mode','body','attribution','scope','dating_note','rationale','search_key','state']
        WHEN 'lexicon_occurrences' THEN ARRAY['rationale','state']
        ELSE NULL END;
    IF mutable IS NULL THEN RAISE EXCEPTION 'unsupported lexicon table' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' THEN
        mutable:=mutable || ARRAY['revision','changed_by','created_at','updated_at'];
        IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) THEN
            RAISE EXCEPTION 'lexicon identity and source provenance cannot change' USING ERRCODE='23514';
        END IF;
        IF NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'lexicon revision must advance by one' USING ERRCODE='23514';
        END IF;
        NEW.created_at:=OLD.created_at;
    ELSIF NEW.revision<>1 THEN
        RAISE EXCEPTION 'first lexicon revision must be one' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME IN ('lexicon_senses','lexicon_definitions') THEN
        PERFORM 1 FROM research.records WHERE project_id=NEW.project_id AND id=NEW.concept_id AND kind='concept' AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'active concept required' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_TABLE_NAME='lexicon_definitions' THEN
        SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
        IF NOT FOUND OR (NEW.wording_mode='quotation' AND NEW.body<>captured.exact) THEN
            RAISE EXCEPTION 'definition does not match located source quotation' USING ERRCODE='23514';
        END IF;
        IF NEW.attribution_person_id IS NOT NULL THEN
            PERFORM 1 FROM research.records WHERE project_id=NEW.project_id AND id=NEW.attribution_person_id AND kind='person' AND deleted_at IS NULL;
            IF NOT FOUND THEN RAISE EXCEPTION 'attribution requires active person identity' USING ERRCODE='23514'; END IF;
        END IF;
    END IF;
    IF TG_TABLE_NAME='lexicon_representations' THEN
        SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.origin_annotation_id;
        IF NOT FOUND OR NEW.origin_end>length(captured.exact)
           OR NEW.written_rep<>substring(captured.exact FROM NEW.origin_start+1 FOR NEW.origin_end-NEW.origin_start) THEN
            RAISE EXCEPTION 'written representation does not match its source occurrence' USING ERRCODE='23514';
        END IF;
    END IF;
    IF TG_TABLE_NAME='lexicon_occurrences' THEN
        SELECT * INTO captured FROM research.reading_annotations WHERE project_id=NEW.project_id AND id=NEW.annotation_id;
        IF NOT FOUND OR NEW.document_id<>captured.document_id OR NEW.text_sha256<>captured.text_sha256
           OR NEW.term_end>length(captured.exact)
           OR NEW.exact<>substring(captured.exact FROM NEW.term_start+1 FOR NEW.term_end-NEW.term_start) THEN
            RAISE EXCEPTION 'term occurrence does not match captured source' USING ERRCODE='23514';
        END IF;
        SELECT f.entry_id INTO entry FROM research.lexicon_representations r JOIN research.lexicon_forms f
            ON f.project_id=r.project_id AND f.id=r.form_id
            WHERE r.project_id=NEW.project_id AND r.id=NEW.representation_id AND r.written_rep=NEW.exact;
        IF NOT FOUND THEN RAISE EXCEPTION 'term spelling does not match its representation' USING ERRCODE='23514'; END IF;
        SELECT concept_id INTO matching_concept FROM research.lexicon_senses WHERE project_id=NEW.project_id AND id=NEW.sense_id AND entry_id=entry AND (NEW.state='withdrawn' OR state='active');
        IF NOT FOUND THEN RAISE EXCEPTION 'term representation and sense refer to different entries' USING ERRCODE='23514'; END IF;
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE FUNCTION research.lexicon_entity_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
    INSERT INTO research.lexicon_revisions VALUES(TG_TABLE_NAME,NEW.id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
DO $$
DECLARE entity_table text;
BEGIN
    FOREACH entity_table IN ARRAY ARRAY['lexicon_entries','lexicon_forms','lexicon_representations','lexicon_senses','lexicon_definitions','lexicon_occurrences'] LOOP
        EXECUTE format('CREATE TRIGGER lexicon_prepare BEFORE INSERT OR UPDATE ON research.%I FOR EACH ROW EXECUTE FUNCTION research.prepare_lexicon_entity()',entity_table);
        EXECUTE format('CREATE TRIGGER lexicon_history AFTER INSERT OR UPDATE ON research.%I FOR EACH ROW EXECUTE FUNCTION research.lexicon_entity_history()',entity_table);
    END LOOP;
END $$;
CREATE TRIGGER lexicon_capture_immutable BEFORE UPDATE ON research.lexicon_captures
    FOR EACH ROW EXECUTE FUNCTION research.immutable_reading_document();
REVOKE ALL ON research.lexicon_entries,research.lexicon_forms,research.lexicon_representations,research.lexicon_senses,
    research.lexicon_definitions,research.lexicon_occurrences,research.lexicon_revisions,research.lexicon_captures FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_lexicon_entity(),research.lexicon_entity_history() FROM PUBLIC;
