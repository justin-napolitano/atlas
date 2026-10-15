-- Private previews are sealed. Only an explicit approval can create a public row.
CREATE TABLE research.publication_previews (
    id text PRIMARY KEY CHECK (id ~ '^publication-[a-f0-9]{32}$'),
    project_id text NOT NULL REFERENCES research.projects(id),
    record_ids text[] NOT NULL,
    relation_ids text[] NOT NULL,
    inputs jsonb NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2000000),
    payload_sha256 text NOT NULL CHECK (payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
    created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research_public.publication_heads (
    project_id text PRIMARY KEY,
    revision integer NOT NULL CHECK (revision>0),
    snapshot_id text REFERENCES research_public.snapshots(id),
    status text NOT NULL CHECK (status IN ('published','withdrawn')),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((status='published' AND snapshot_id IS NOT NULL) OR (status='withdrawn' AND snapshot_id IS NULL))
);
CREATE TABLE research.publication_events (
    project_id text NOT NULL,
    revision integer NOT NULL,
    preview_id text UNIQUE REFERENCES research.publication_previews(id),
    action text NOT NULL CHECK (action IN ('publish','withdraw')),
    rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
    changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 500),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(project_id,revision)
);

CREATE FUNCTION research.publication_inputs(project_key text, records text[], relations text[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,research AS $$
    SELECT jsonb_build_object(
        'project',(SELECT to_jsonb(p) FROM research.projects p WHERE p.id=project_key),
        'canonical_snapshot_sha256',COALESCE((SELECT jsonb_agg(i.sha256 ORDER BY i.sha256)
            FROM research.import_snapshots i WHERE i.project_id=project_key AND i.format='turtle'),'[]'::jsonb),
        'records',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM research.records r
            WHERE r.project_id=project_key AND r.id=ANY(records) AND r.deleted_at IS NULL),'[]'::jsonb),
        'relations',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM research.relations e
            WHERE e.project_id=project_key AND e.id=ANY(relations)),'[]'::jsonb))
$$;
CREATE FUNCTION research.publication_head(project_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,research AS $$
    SELECT COALESCE((SELECT to_jsonb(h) FROM research_public.publication_heads h WHERE h.project_id=project_key),
        jsonb_build_object('project_id',project_key,'revision',0,'snapshot_id',NULL,'status','private','changed_at',NULL))
$$;

CREATE FUNCTION research.seal_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN
    RAISE EXCEPTION 'publication history and previews are immutable' USING ERRCODE='23514';
END $$;
CREATE FUNCTION research.validate_publication_preview() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE node jsonb; edge jsonb; link jsonb; original jsonb;
BEGIN
    IF cardinality(NEW.record_ids) NOT BETWEEN 1 AND 100 OR cardinality(NEW.relation_ids)>300
       OR cardinality(NEW.record_ids)<>(SELECT count(DISTINCT v) FROM unnest(NEW.record_ids) v)
       OR cardinality(NEW.relation_ids)<>(SELECT count(DISTINCT v) FROM unnest(NEW.relation_ids) v)
       OR NEW.inputs IS DISTINCT FROM research.publication_inputs(NEW.project_id,NEW.record_ids,NEW.relation_ids)
       OR NEW.inputs->'project' IS NULL OR NEW.inputs->'project'='null'::jsonb
       OR jsonb_array_length(NEW.inputs->'records')<>cardinality(NEW.record_ids)
       OR jsonb_array_length(NEW.inputs->'relations')<>cardinality(NEW.relation_ids) THEN
        RAISE EXCEPTION 'invalid publication selection' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(NEW.payload)<>'object' OR NEW.payload->>'snapshot_id' IS DISTINCT FROM NEW.id
       OR NEW.payload->>'format_version' IS DISTINCT FROM '1'
       OR jsonb_typeof(NEW.payload->'generated_at') IS DISTINCT FROM 'string' OR length(NEW.payload->>'generated_at')>100
       OR NEW.payload->'project' IS DISTINCT FROM jsonb_build_object('id',NEW.project_id,'title',NEW.inputs->'project'->>'title')
       OR NEW.payload->>'curated_graph' IS DISTINCT FROM NEW.inputs->'project'->>'graph_authority'
       OR NEW.payload->'canonical_snapshot_sha256' IS DISTINCT FROM NEW.inputs->'canonical_snapshot_sha256'
       OR NEW.payload->'candidates' IS DISTINCT FROM '[]'::jsonb
       OR EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.payload) k WHERE k NOT IN
           ('format_version','snapshot_id','generated_at','curated_graph','canonical_snapshot_sha256','project','nodes','edges','candidates','publication'))
       OR jsonb_typeof(NEW.payload->'nodes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(NEW.payload->'edges') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.payload->'nodes')<>cardinality(NEW.record_ids)
       OR jsonb_array_length(NEW.payload->'edges')<>cardinality(NEW.relation_ids)
       OR NEW.payload->'publication' IS DISTINCT FROM '{"policy":"explicit_owner_selection_v1","review":"Visibility approval is not a new scholarly review"}'::jsonb THEN
        RAISE EXCEPTION 'invalid public projection' USING ERRCODE='23514';
    END IF;
    FOR node IN SELECT value FROM jsonb_array_elements(NEW.payload->'nodes') LOOP
        SELECT value INTO original FROM jsonb_array_elements(NEW.inputs->'records') WHERE value->>'id'=node->>'id';
        IF original IS NULL OR node->>'label' IS DISTINCT FROM original->>'title'
           OR node->>'type' IS DISTINCT FROM original->>'kind'
           OR node->>'status' IS DISTINCT FROM original->>'review_state'
           OR node->>'status'='withdrawn'
           OR node->>'origin' IS DISTINCT FROM original->>'origin'
           OR node->'source_revision' IS DISTINCT FROM original->'revision'
           OR node->>'type' NOT IN ('source','work','edition','claim','evidence','question','hypothesis','concept',
               'lexical_form','sense','definition','occurrence','person','place','period','tradition','school','event','article')
           OR node->>'summary' IS NULL OR node->>'summary' NOT IN ('',original->>'summary')
           OR EXISTS(SELECT 1 FROM jsonb_object_keys(node) k WHERE k NOT IN
               ('id','label','type','status','origin','source_revision','summary','scope','people','role','locator','links','citation','review_limits'))
           OR EXISTS(SELECT 1 FROM jsonb_each(node) e WHERE e.key IN ('id','label','type','status','origin','summary','scope','role','locator','citation') AND jsonb_typeof(e.value)<>'string')
           OR jsonb_typeof(node->'people') IS DISTINCT FROM 'array' OR jsonb_typeof(node->'review_limits') IS DISTINCT FROM 'array'
           OR jsonb_typeof(node->'links') IS DISTINCT FROM 'array'
           OR EXISTS(SELECT 1 FROM jsonb_array_elements(node->'people') v WHERE jsonb_typeof(v)<>'string')
           OR EXISTS(SELECT 1 FROM jsonb_array_elements(node->'review_limits') v WHERE jsonb_typeof(v)<>'string') THEN
            RAISE EXCEPTION 'invalid public record' USING ERRCODE='23514';
        END IF;
        FOR link IN SELECT value FROM jsonb_array_elements(node->'links') LOOP
            IF jsonb_typeof(link)<>'object' OR (link-'url'-'label')<>'{}'::jsonb
               OR jsonb_typeof(link->'url') IS DISTINCT FROM 'string' OR jsonb_typeof(link->'label') IS DISTINCT FROM 'string'
               OR link->>'url' !~ '^https?://[^/@[:space:]]+([/?#][^[:cntrl:]]*)?$' THEN
                RAISE EXCEPTION 'invalid public source link' USING ERRCODE='23514';
            END IF;
        END LOOP;
    END LOOP;
    IF (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(NEW.payload->'nodes') v)<>cardinality(NEW.record_ids) THEN
        RAISE EXCEPTION 'duplicate public records' USING ERRCODE='23514';
    END IF;
    FOR edge IN SELECT value FROM jsonb_array_elements(NEW.payload->'edges') LOOP
        SELECT value INTO original FROM jsonb_array_elements(NEW.inputs->'relations') WHERE value->>'id'=edge->>'id';
        IF original IS NULL OR edge->>'from' IS DISTINCT FROM original->>'from_id'
           OR edge->>'to' IS DISTINCT FROM original->>'to_id' OR edge->>'predicate' IS DISTINCT FROM original->>'predicate'
           OR edge->>'status' IS DISTINCT FROM original->>'review_state'
           OR edge->>'status'='withdrawn'
           OR NOT (edge->>'from'=ANY(NEW.record_ids) AND edge->>'to'=ANY(NEW.record_ids))
           OR (edge-'id'-'from'-'to'-'predicate'-'label'-'status')<>'{}'::jsonb
           OR EXISTS(SELECT 1 FROM jsonb_each(edge) e WHERE jsonb_typeof(e.value)<>'string') THEN
            RAISE EXCEPTION 'invalid public relation' USING ERRCODE='23514';
        END IF;
    END LOOP;
    IF (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(NEW.payload->'edges') v)<>cardinality(NEW.relation_ids) THEN
        RAISE EXCEPTION 'duplicate public relations' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER publication_preview_validate BEFORE INSERT ON research.publication_previews
    FOR EACH ROW EXECUTE FUNCTION research.validate_publication_preview();
CREATE TRIGGER publication_preview_immutable BEFORE UPDATE OR DELETE ON research.publication_previews
    FOR EACH ROW EXECUTE FUNCTION research.seal_publication();
CREATE TRIGGER publication_event_immutable BEFORE UPDATE OR DELETE ON research.publication_events
    FOR EACH ROW EXECUTE FUNCTION research.seal_publication();
CREATE TRIGGER public_snapshot_immutable BEFORE UPDATE OR DELETE ON research_public.snapshots
    FOR EACH ROW EXECUTE FUNCTION research.seal_publication();

CREATE FUNCTION research.approve_publication(preview_key text, expected_digest text, expected_revision integer,
    rationale text, actor text, rights_checked boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
DECLARE
    preview research.publication_previews%ROWTYPE;
    head research_public.publication_heads%ROWTYPE;
    existing research.publication_events%ROWTYPE;
BEGIN
    IF rights_checked IS DISTINCT FROM true OR expected_revision<0 OR expected_revision IS NULL
       OR rationale IS NULL OR length(btrim(rationale)) NOT BETWEEN 1 AND 2000
       OR actor IS NULL OR length(btrim(actor)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'explicit publication acknowledgement required' USING ERRCODE='23514';
    END IF;
    SELECT * INTO STRICT preview FROM research.publication_previews WHERE id=preview_key;
    IF expected_digest IS DISTINCT FROM preview.payload_sha256 THEN
        RAISE EXCEPTION 'preview digest changed' USING ERRCODE='40001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(preview.project_id,184511));
    SELECT * INTO head FROM research_public.publication_heads WHERE project_id=preview.project_id FOR UPDATE;
    SELECT * INTO existing FROM research.publication_events WHERE preview_id=preview_key;
    IF FOUND THEN
        IF head.revision=existing.revision AND head.snapshot_id=preview_key AND head.status='published'
           AND expected_revision=existing.revision-1 AND existing.rationale=rationale AND existing.changed_by=actor THEN
            RETURN to_jsonb(head);
        END IF;
        RAISE EXCEPTION 'publication changed' USING ERRCODE='40001';
    END IF;
    IF COALESCE(head.revision,0)<>expected_revision THEN
        RAISE EXCEPTION 'publication changed' USING ERRCODE='40001';
    END IF;
    -- Lock the selected rows until commit so a concurrent edit cannot cross approval.
    PERFORM 1 FROM research.projects WHERE id=preview.project_id FOR SHARE;
    PERFORM 1 FROM research.records WHERE project_id=preview.project_id AND id=ANY(preview.record_ids) ORDER BY id FOR SHARE;
    PERFORM 1 FROM research.relations WHERE project_id=preview.project_id AND id=ANY(preview.relation_ids) ORDER BY id FOR SHARE;
    IF research.publication_inputs(preview.project_id,preview.record_ids,preview.relation_ids) IS DISTINCT FROM preview.inputs THEN
        RAISE EXCEPTION 'publication source changed' USING ERRCODE='40001';
    END IF;
    INSERT INTO research_public.snapshots(id,project_id,payload) VALUES(preview.id,preview.project_id,preview.payload);
    INSERT INTO research.publication_events(project_id,revision,preview_id,action,rationale,changed_by)
        VALUES(preview.project_id,expected_revision+1,preview.id,'publish',rationale,actor);
    INSERT INTO research_public.publication_heads(project_id,revision,snapshot_id,status)
        VALUES(preview.project_id,expected_revision+1,preview.id,'published')
        ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision,snapshot_id=EXCLUDED.snapshot_id,status=EXCLUDED.status,changed_at=clock_timestamp()
        RETURNING * INTO head;
    RETURN to_jsonb(head);
END $$;

CREATE FUNCTION research.withdraw_publication(project_key text, expected_revision integer, rationale text, actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
DECLARE head research_public.publication_heads%ROWTYPE;
BEGIN
    IF expected_revision IS NULL OR expected_revision<1 OR rationale IS NULL OR length(btrim(rationale)) NOT BETWEEN 1 AND 2000
       OR actor IS NULL OR length(btrim(actor)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'withdrawal rationale required' USING ERRCODE='23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(project_key,184511));
    SELECT * INTO head FROM research_public.publication_heads WHERE project_id=project_key FOR UPDATE;
    IF NOT FOUND OR head.revision<>expected_revision THEN
        RAISE EXCEPTION 'publication changed' USING ERRCODE='40001';
    END IF;
    IF head.status='withdrawn' THEN RETURN to_jsonb(head); END IF;
    INSERT INTO research.publication_events(project_id,revision,action,rationale,changed_by)
        VALUES(project_key,expected_revision+1,'withdraw',rationale,actor);
    UPDATE research_public.publication_heads SET revision=expected_revision+1,snapshot_id=NULL,status='withdrawn',changed_at=clock_timestamp()
        WHERE project_id=project_key RETURNING * INTO head;
    RETURN to_jsonb(head);
END $$;
REVOKE ALL ON research.publication_previews,research.publication_events,research_public.publication_heads FROM PUBLIC;
REVOKE ALL ON FUNCTION research.publication_inputs(text,text[],text[]),research.publication_head(text),research.seal_publication(),
    research.validate_publication_preview(),research.approve_publication(text,text,integer,text,text,boolean),research.withdraw_publication(text,integer,text,text) FROM PUBLIC;
