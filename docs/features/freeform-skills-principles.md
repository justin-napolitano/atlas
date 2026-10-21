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

## Using it

Cmd/Ctrl+N opens a new blank page from anywhere in the workspace, including an
active editor. File → New Page exposes the native accelerator in Electron.
Existing writing stays in its own session; the new page receives writing focus.
The older Cmd/Ctrl+Shift+. shortcut remains supported.

Open Notebook, then Skills or Principles, then New skill/New principle. Write in
the same blank Markdown editor. All pages also remain in All, the folder explorer
and global literal search. Note properties can change the optional type later;
existing body, placement and identity stay intact. Global New note is unchanged.

Type `[[` and choose an existing page to link a skill to a principle, another skill
or an ordinary note. The stable link and backlink reuse the existing page authority;
no hierarchy or rationale form is required. Existing passage/source references and
advanced Connections remain available when evidence is useful. Those advanced
scholarly relations retain their original attribution/review requirements.

## Implementation and evidence

PR #239 implements #237/#238 under #236. Additive migration
`0034_freeform_skills.sql` extends the entry type constraint and the existing
recovery trigger's allowed types, preserving its baseline/anchor/revision guards.
No old migration, body, history, receipt digest or source is rewritten. No new
endpoint, privilege, dependency, assessment, score or progress table is added.

- Five new isolated database tests pass: standalone saves and UUID replay,
  conversion/CAS/history and placement, durable draft retry, filtered pagination
  and saved views, stable backlinks and exact original evidence references.
- Owner HTTP tests pass, including skill/principle creation/filtering, anonymous
  rejection and rejection of assessment/stage/proficiency/score fields.
- 174 frontend unit tests and the production frontend build pass.
- Full isolated PostgreSQL 17 regression: 400 tests passed, with one expected skip.
  Owner OpenAPI contracts were regenerated for the additive type; public schema
  stayed unchanged. API contract drift checking passes after regeneration.
- Copied frozen runtime, fresh isolated PostgreSQL and sandboxed native Electron
  pass the actual blank-page create/write/filter/search flow, skill-to-principle
  completion and backlink navigation, reversible type conversion, background save
  after navigation, reload with retained type filter and 390px layout.
- That native run also verifies typed bodies/links/revisions after service restart
  and database-plus-original-file restore, along with conflict/tamper rejection.
  Synthetic screenshots stay ignored in `research-library/testing/freeform-skills/`.

Full PostgreSQL regression, CI and signed-package acceptance are recorded on the
PR when complete. Owner usability review remains separate from synthetic tests.
New optional types affect private data/API validation; normal review should inspect
that migration and boundary. No external security approval is claimed.
