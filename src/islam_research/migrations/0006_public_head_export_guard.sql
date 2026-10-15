-- A restricted publisher can hold the shared form of this transaction lock while
-- reading/validating/activating a bounded release. Head changes take the exclusive
-- form automatically; no publisher table-write capability is introduced.
CREATE FUNCTION research.guard_public_head_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(184512,1);
    RETURN NULL;
END $$;
CREATE TRIGGER public_head_export_guard BEFORE INSERT OR UPDATE OR DELETE ON research_public.publication_heads
    FOR EACH STATEMENT EXECUTE FUNCTION research.guard_public_head_change();
REVOKE ALL ON FUNCTION research.guard_public_head_change() FROM PUBLIC;
