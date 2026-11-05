-- Dated reasons must point at an actual immutable note revision, not a guessed number.
ALTER TABLE research.workspace_reflections ADD CONSTRAINT workspace_reflection_revision
 FOREIGN KEY(entry_id,entry_revision) REFERENCES research.notebook_revisions(entry_id,revision);
CREATE FUNCTION research.guard_workspace_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,research AS $$
BEGIN RAISE EXCEPTION 'workspace provenance is append-only' USING ERRCODE='23514';END $$;
CREATE TRIGGER workspace_reflection_immutable BEFORE UPDATE OR DELETE ON research.workspace_reflections FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_append_only();
CREATE TRIGGER workspace_legacy_alias_immutable BEFORE UPDATE OR DELETE ON research.workspace_legacy_collections FOR EACH ROW EXECUTE FUNCTION research.guard_workspace_append_only();
REVOKE ALL ON FUNCTION research.guard_workspace_append_only() FROM PUBLIC;
