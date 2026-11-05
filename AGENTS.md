# Atlas contributor instructions

Atlas is a local-first workspace for Markdown notes, linked pages, reading,
research, skills and principles. Keep it useful with a completely empty workspace.

- Keep personal research, notes, source imports, credentials, database files,
  backups and runtime configuration outside this repository. Use clearly labeled
  synthetic data in tests and examples.
- Preserve exact writing, stable IDs, Unicode, revision history, provenance,
  conflict handling and verified backup/restore. Never test against an owner's
  live database or enable synchronization without explicit user selection.
- Application storage owns notes; GitHub Markdown is an explicit backup/export.
  Remote edits must not silently replace local writing.
- Keep local services on loopback, enforce the existing origin/session checks,
  and preserve private defaults. Hosted deployment is separate from publishing code.
- SQLite is the selected embedded desktop store; preserve the PostgreSQL
  migration/rollback path. Tauri is the selected shell; Electron remains available.
- Preserve keyboard editing, IME, undo, autosave and accessible navigation.
- Keep quotations distinct from analysis and machine proposals distinct from
  human-reviewed or explicitly published records.
- The `islam_research` Python package and legacy RDF namespace remain compatibility
  identifiers. Use Atlas for product names and the `atlas` CLI in new documentation.
- Run relevant Python, frontend and desktop tests. Record skipped integration
  checks honestly; a build does not establish native application acceptance.
- See README.md, docs/development.md, docs/public-extraction.md and SECURITY.md.
