-- Optional organization references existing note identities; bodies remain canonical Markdown.
CREATE TABLE research.desktop_page_positions (
 entry_id text PRIMARY KEY REFERENCES research.notebook_entries(id),
 parent_id text REFERENCES research.notebook_entries(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(entry_id IS DISTINCT FROM parent_id)
);
CREATE INDEX desktop_page_children ON research.desktop_page_positions(parent_id,entry_id);
CREATE TABLE research.desktop_page_intents (
 request_uuid uuid PRIMARY KEY REFERENCES research.desktop_requests(request_uuid),
 parent_id text NOT NULL REFERENCES research.notebook_entries(id),
 changed_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.desktop_page_history (
 entry_id text NOT NULL REFERENCES research.notebook_entries(id),
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 PRIMARY KEY(entry_id,revision)
);
CREATE FUNCTION research.prepare_desktop_page() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
DECLARE ancestor_depth integer:=0; subtree_depth integer:=0; cycle boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(184514,173121);
 IF TG_OP='UPDATE' THEN
  IF NEW.entry_id<>OLD.entry_id OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'page placement identity or revision changed' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'first placement revision must be one' USING ERRCODE='23514'; END IF;
 WITH RECURSIVE ancestors(id,depth) AS (
  SELECT NEW.parent_id,1 WHERE NEW.parent_id IS NOT NULL
  UNION ALL SELECT p.parent_id,a.depth+1 FROM ancestors a JOIN desktop_page_positions p ON p.entry_id=a.id
   WHERE p.parent_id IS NOT NULL AND a.depth<33
 ) SELECT coalesce(max(depth),0),coalesce(bool_or(id=NEW.entry_id),false) INTO ancestor_depth,cycle FROM ancestors;
 IF cycle OR ancestor_depth>32 THEN RAISE EXCEPTION 'page parent would create a cycle or exceed 32 levels' USING ERRCODE='23514'; END IF;
 WITH RECURSIVE descendants(id,depth) AS (
  SELECT NEW.entry_id,0 UNION ALL SELECT p.entry_id,d.depth+1 FROM descendants d
   JOIN desktop_page_positions p ON p.parent_id=d.id WHERE d.depth<33
 ) SELECT coalesce(max(depth),0) INTO subtree_depth FROM descendants;
 IF ancestor_depth+subtree_depth>32 THEN RAISE EXCEPTION 'page subtree would exceed 32 levels' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION research.log_desktop_page() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN INSERT INTO desktop_page_history VALUES(NEW.entry_id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER desktop_page_prepare BEFORE INSERT OR UPDATE ON research.desktop_page_positions FOR EACH ROW EXECUTE FUNCTION research.prepare_desktop_page();
CREATE TRIGGER desktop_page_log AFTER INSERT OR UPDATE ON research.desktop_page_positions FOR EACH ROW EXECUTE FUNCTION research.log_desktop_page();
REVOKE ALL ON research.desktop_page_positions,research.desktop_page_intents,research.desktop_page_history FROM PUBLIC;
REVOKE ALL ON FUNCTION research.prepare_desktop_page(),research.log_desktop_page() FROM PUBLIC;
