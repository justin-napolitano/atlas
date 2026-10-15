-- Private authoring state and explicit public projections have different schemas.
CREATE SCHEMA IF NOT EXISTS research_public;
REVOKE ALL ON SCHEMA research FROM PUBLIC;
REVOKE ALL ON SCHEMA research_public FROM PUBLIC;

CREATE TABLE research.projects (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 2000),
    scope text NOT NULL DEFAULT '',
    graph_authority text NOT NULL DEFAULT 'canonical_rdf'
        CHECK (graph_authority IN ('canonical_rdf', 'hosted')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE research.records (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL REFERENCES research.projects(id),
    kind text NOT NULL CHECK (kind IN (
        'source','work','edition','passage','claim','evidence','question','hypothesis',
        'concept','lexical_form','sense','definition','occurrence','person','place',
        'period','tradition','school','event','article','note','annotation','activity','record'
    )),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 2000),
    summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 50000),
    attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
    review_state text NOT NULL DEFAULT 'pending'
        CHECK (review_state IN ('pending','needs_followup','reviewed','disputed','withdrawn')),
    origin text NOT NULL DEFAULT 'owner' CHECK (origin IN ('canonical_rdf','discovery','owner','proposal')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz,
    UNIQUE (project_id, id)
);
CREATE INDEX records_project_kind ON research.records(project_id, kind);
CREATE INDEX records_text ON research.records USING gin (
    to_tsvector('simple', title || ' ' || summary)
);

CREATE TABLE research.record_revisions (
    record_id text NOT NULL REFERENCES research.records(id),
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (record_id, revision)
);

CREATE FUNCTION research.prepare_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id
           OR NEW.kind <> OLD.kind OR NEW.origin <> OLD.origin THEN
            RAISE EXCEPTION 'record identity cannot change' USING ERRCODE = '23514';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'revision must advance by one' USING ERRCODE = '23514';
        END IF;
        NEW.created_at := OLD.created_at;
    ELSIF NEW.revision <> 1 THEN
        RAISE EXCEPTION 'first revision must be one' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
-- Deferred FK allows recording the first insert in a BEFORE trigger.
ALTER TABLE research.record_revisions DROP CONSTRAINT record_revisions_record_id_fkey;
ALTER TABLE research.record_revisions ADD CONSTRAINT record_revisions_record_id_fkey
    FOREIGN KEY (record_id) REFERENCES research.records(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER records_history BEFORE INSERT OR UPDATE ON research.records
    FOR EACH ROW EXECUTE FUNCTION research.prepare_record();
CREATE FUNCTION research.record_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research AS $$
BEGIN
    INSERT INTO research.record_revisions(record_id,revision,snapshot) VALUES (NEW.id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER record_revision_log AFTER INSERT OR UPDATE ON research.records
    FOR EACH ROW EXECUTE FUNCTION research.record_history();

CREATE TABLE research.relation_types (
    predicate text PRIMARY KEY CHECK (length(predicate) BETWEEN 1 AND 500),
    description text NOT NULL,
    from_kinds text[] NOT NULL DEFAULT '{}',
    to_kinds text[] NOT NULL DEFAULT '{}',
    inverse_traversal boolean NOT NULL DEFAULT false,
    requires_evidence boolean NOT NULL DEFAULT false
);
CREATE TABLE research.relations (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 500),
    project_id text NOT NULL REFERENCES research.projects(id),
    from_id text NOT NULL,
    predicate text NOT NULL REFERENCES research.relation_types(predicate),
    to_id text NOT NULL,
    provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object' AND provenance <> '{}'),
    review_state text NOT NULL DEFAULT 'pending'
        CHECK (review_state IN ('pending','needs_followup','reviewed','disputed','withdrawn')),
    FOREIGN KEY (project_id, from_id) REFERENCES research.records(project_id, id),
    FOREIGN KEY (project_id, to_id) REFERENCES research.records(project_id, id),
    UNIQUE (project_id, from_id, predicate, to_id)
);
CREATE INDEX relations_from ON research.relations(project_id, from_id, predicate);
CREATE INDEX relations_to ON research.relations(project_id, to_id, predicate);

CREATE TABLE research.personal_states (
    record_id text PRIMARY KEY,
    project_id text NOT NULL,
    reading text NOT NULL DEFAULT 'unread' CHECK (reading IN ('unread','reading','read')),
    read_at timestamptz,
    decision text NOT NULL DEFAULT 'unreviewed'
        CHECK (decision IN ('unreviewed','relevant','not_relevant','read_later')),
    note text NOT NULL DEFAULT '' CHECK (length(note) <= 10000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (project_id, record_id) REFERENCES research.records(project_id, id),
    CHECK ((reading = 'read' AND read_at IS NOT NULL) OR (reading <> 'read' AND read_at IS NULL))
);
CREATE TABLE research.personal_state_revisions (
    record_id text NOT NULL,
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY(record_id, revision),
    FOREIGN KEY(record_id) REFERENCES research.personal_states(record_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION research.prepare_personal_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.record_id <> OLD.record_id OR NEW.project_id <> OLD.project_id THEN
            RAISE EXCEPTION 'personal state identity cannot change' USING ERRCODE = '23514';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'revision must advance by one' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.revision <> 1 THEN
        RAISE EXCEPTION 'first revision must be one' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER personal_history BEFORE INSERT OR UPDATE ON research.personal_states
    FOR EACH ROW EXECUTE FUNCTION research.prepare_personal_state();
CREATE FUNCTION research.personal_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, research AS $$
BEGIN
    INSERT INTO research.personal_state_revisions VALUES (NEW.record_id,NEW.revision,to_jsonb(NEW));
    RETURN NEW;
END $$;
CREATE TRIGGER personal_revision_log AFTER INSERT OR UPDATE ON research.personal_states
    FOR EACH ROW EXECUTE FUNCTION research.personal_history();

CREATE TABLE research.import_snapshots (
    project_id text NOT NULL REFERENCES research.projects(id),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    format text NOT NULL CHECK (format IN ('turtle','candidate_jsonl')),
    original_text text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    record_count integer NOT NULL CHECK (record_count >= 0),
    relation_count integer NOT NULL CHECK (relation_count >= 0),
    PRIMARY KEY (project_id, sha256)
);

-- Public publication data is an explicit projection, never a view of private notes.
-- No publishing API is introduced in this migration.
CREATE TABLE research_public.snapshots (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ALL TABLES IN SCHEMA research FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA research_public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA research FROM PUBLIC;
