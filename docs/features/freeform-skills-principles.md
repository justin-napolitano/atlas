# Freeform skills and principles

Owner direction (2026-10-21), epic #236; storage #237 and interface/acceptance #238.
Extend #96/#87/#97. Local Electron delivery; no hosted deployment or cloud sync.

## Contract before implementation

- Skills and principles are ordinary Markdown notebook pages, with optional types.
  A page needs no source, parent, project, folder, title, template or connection.
  Write first. No assessments, scores, proficiency levels, stages or practice forms.
- Principle is an existing note type; add skill to the same authority. Do not create
  another body store, a skill graph table or a parallel export format. Preserve IDs,
  anchors, source hashes, bodies, revisions, folders, Trash, privacy and publication.
- Additive migration extends accepted note/recovery types. Existing migrations and
  historical receipt/revision bodies remain unchanged. Skills round-trip through
  normal API saves, durable drafts, retries, conflicts, history and saved searches.
  Rollback refuses unsupported data rather than losing or reclassifying it.
- Notebook gains compact All / Skills / Principles filters and contextual New skill
  or New principle. Global New note remains unchanged. Filter state is navigable;
  pagination/search stay scoped. Conversion uses existing optional note properties
  and is reversible without changing identity, body, placement or anchors.
- Same live Markdown editor, completion and backlinks. A skill can link a principle,
  source or exact passage with existing stable links; links are optional, reciprocal
  discovery does not imply hierarchy, and ordinary links require no explanation.
  Existing advanced scholarly connections keep rationale/evidence/review rules.
  A personal page or link never becomes a reviewed claim or published evidence.
- Use no new dependencies, endpoints, privileges, external integrations or browser
  content storage. Server validation and owner/CSRF/public boundaries remain intact.
  Normal review should inspect the additive data/API validation and migration.

## Acceptance

Use isolated synthetic PostgreSQL only. Verify independent skill/principle saves,
UUID replay, type conversion/history/conflicts, durable recovery, literal search,
typed pagination/views, stable Markdown links/backlinks, and unknown-type rejection.
Verify existing owner/public boundaries and reading regressions. In native Electron,
exercise the actual editor, filters, links, retained writing, narrow layout and
fresh database restart/backup restore. Prepare a separate review app without
replacing or restarting the running owner app; never use owner notes as fixtures.
