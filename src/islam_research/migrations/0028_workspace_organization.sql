-- Private organization and connections reference existing authorities, never copy bodies.
CREATE TABLE research.workspace_collections (
 id text PRIMARY KEY, workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 300),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
 creation_sha256 text NOT NULL CHECK(length(creation_sha256)=64),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.workspace_collection_items (
 collection_id text NOT NULL REFERENCES research.workspace_collections(id),
 target_kind text NOT NULL CHECK(target_kind IN ('entry','record','annotation')),target_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('active','removed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(collection_id,target_kind,target_id)
);
CREATE INDEX workspace_collection_target ON research.workspace_collection_items(target_kind,target_id,collection_id) WHERE state='active';
CREATE TABLE research.workspace_saved_views (
 id text PRIMARY KEY,workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 300),
 query jsonb NOT NULL CHECK(jsonb_typeof(query)='object' AND query->>'version'='1'),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
 creation_sha256 text NOT NULL CHECK(length(creation_sha256)=64),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.workspace_connections (
 id text PRIMARY KEY,workspace_id text NOT NULL DEFAULT 'owner' REFERENCES research.owner_workspaces(id),
 from_kind text NOT NULL CHECK(from_kind IN ('entry','record','annotation')),from_id text NOT NULL,
 to_kind text NOT NULL CHECK(to_kind IN ('entry','record','annotation')),to_id text NOT NULL,
 relation text NOT NULL CHECK(relation IN ('personal_association','comments_on','asks_about','defines','supports','challenges','qualifies','interprets','historical_influence')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),
 attribution text NOT NULL DEFAULT '' CHECK(length(attribution)<=1000),
 evidence_annotation_id text REFERENCES research.reading_annotations(id),
 state text NOT NULL DEFAULT 'tentative' CHECK(state IN ('tentative','accepted','withdrawn')),
 creation_sha256 text NOT NULL CHECK(length(creation_sha256)=64),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(state<>'accepted' OR relation IN ('personal_association','comments_on','asks_about') OR
   (evidence_annotation_id IS NOT NULL AND length(btrim(attribution))>0))
);
CREATE INDEX workspace_connections_from ON research.workspace_connections(from_kind,from_id) WHERE state<>'withdrawn';
CREATE INDEX workspace_connections_to ON research.workspace_connections(to_kind,to_id) WHERE state<>'withdrawn';
CREATE TABLE research.workspace_investigations (
 target_kind text NOT NULL CHECK(target_kind IN ('entry','record')),target_id text NOT NULL,
 target_revision integer NOT NULL CHECK(target_revision>0),
 state text NOT NULL CHECK(state IN ('open','investigating','provisional','resolved','revisiting')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id)
);
CREATE TABLE research.workspace_reflections (
 id text PRIMARY KEY,entry_id text NOT NULL REFERENCES research.notebook_entries(id),entry_revision integer NOT NULL CHECK(entry_revision>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 uncertainty text NOT NULL DEFAULT '' CHECK(length(uncertainty)<=2000),
 evidence_annotation_id text REFERENCES research.reading_annotations(id),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 creation_sha256 text NOT NULL CHECK(length(creation_sha256)=64)
);
CREATE TABLE research.workspace_organization_history (
 entity text NOT NULL,identity jsonb NOT NULL,revision integer NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(entity,identity,revision)
);
CREATE FUNCTION research.prepare_workspace_organization() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE before jsonb;after jsonb;
BEGIN
 after:=to_jsonb(NEW);
 IF TG_OP='UPDATE' THEN
  before:=to_jsonb(OLD);
  IF after->'workspace_id' IS DISTINCT FROM before->'workspace_id'
    OR after->'id' IS DISTINCT FROM before->'id'
    OR after->'creation_sha256' IS DISTINCT FROM before->'creation_sha256'
    OR after->'created_at' IS DISTINCT FROM before->'created_at'
    OR after->'target_kind' IS DISTINCT FROM before->'target_kind'
    OR after->'target_id' IS DISTINCT FROM before->'target_id'
    OR after->'collection_id' IS DISTINCT FROM before->'collection_id'
    OR after->'from_kind' IS DISTINCT FROM before->'from_kind' OR after->'from_id' IS DISTINCT FROM before->'from_id'
    OR after->'to_kind' IS DISTINCT FROM before->'to_kind' OR after->'to_id' IS DISTINCT FROM before->'to_id'
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'organization identity or revision changed' USING ERRCODE='23514';END IF;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first organization revision must be one' USING ERRCODE='23514';END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION research.log_workspace_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
DECLARE value jsonb;identity jsonb;
BEGIN
 value:=to_jsonb(NEW);
 identity:=CASE WHEN value?'id' THEN value->'id' WHEN value?'collection_id' THEN jsonb_build_array(value->'collection_id',value->'target_kind',value->'target_id') ELSE jsonb_build_array(value->'target_kind',value->'target_id') END;
 INSERT INTO research.workspace_organization_history VALUES(TG_TABLE_NAME,identity,NEW.revision,value);RETURN NEW;
END $$;
CREATE TRIGGER workspace_collections_prepare BEFORE INSERT OR UPDATE ON research.workspace_collections FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_organization();
CREATE TRIGGER workspace_collections_history AFTER INSERT OR UPDATE ON research.workspace_collections FOR EACH ROW EXECUTE FUNCTION research.log_workspace_organization();
CREATE TRIGGER workspace_members_prepare BEFORE INSERT OR UPDATE ON research.workspace_collection_items FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_organization();
CREATE TRIGGER workspace_members_history AFTER INSERT OR UPDATE ON research.workspace_collection_items FOR EACH ROW EXECUTE FUNCTION research.log_workspace_organization();
CREATE TRIGGER workspace_views_prepare BEFORE INSERT OR UPDATE ON research.workspace_saved_views FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_organization();
CREATE TRIGGER workspace_views_history AFTER INSERT OR UPDATE ON research.workspace_saved_views FOR EACH ROW EXECUTE FUNCTION research.log_workspace_organization();
CREATE TRIGGER workspace_connections_prepare BEFORE INSERT OR UPDATE ON research.workspace_connections FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_organization();
CREATE TRIGGER workspace_connections_history AFTER INSERT OR UPDATE ON research.workspace_connections FOR EACH ROW EXECUTE FUNCTION research.log_workspace_organization();
CREATE TRIGGER workspace_investigations_prepare BEFORE INSERT OR UPDATE ON research.workspace_investigations FOR EACH ROW EXECUTE FUNCTION research.prepare_workspace_organization();
CREATE TRIGGER workspace_investigations_history AFTER INSERT OR UPDATE ON research.workspace_investigations FOR EACH ROW EXECUTE FUNCTION research.log_workspace_organization();
REVOKE ALL ON research.workspace_collections,research.workspace_collection_items,research.workspace_saved_views,research.workspace_connections,research.workspace_investigations,research.workspace_reflections,research.workspace_organization_history FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_workspace_organization(),research.log_workspace_organization() FROM PUBLIC;
