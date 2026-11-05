# Development

Install locked development dependencies:

```sh
uv sync --frozen --extra api --extra database --extra test --extra desktop-sqlite --extra graph
npm ci --prefix web
```

Run local checks:

```sh
uv run --no-sync python -m unittest discover -s tests
npm test --prefix web
npm test --prefix desktop
uv run --no-sync python scripts/generate_sqlite_schema.py --check
uv run --no-sync python scripts/export_api_schema.py --check
uv run --no-sync python scripts/validate_semantic.py
uv run --no-sync atlas validate
uv run --no-sync python scripts/check_public_extraction.py
```

PostgreSQL integration tests require `RESEARCH_TEST_DATABASE_URL` pointing to a
disposable isolated database. Never use an owner's live workspace. Tests skip
those cases when the variable is absent.

The local SQLite launcher is `scripts/atlas_local.py`. It shares the production
local owner/session adapter, SQLite store and desktop bootstrap/backup code.
Its state directory is separate from the original installation's default.

To explore only the synthetic graph:

```sh
uv run --no-sync python scripts/explore_graph.py \
  --graph tests/fixtures/example-research.ttl \
  --start https://islam-research.local/id/example-question
```

Native builds use `scripts/build_desktop_runtime.py --sqlite` followed by the
Tauri packaging tools under `desktop/tauri` and `scripts/package_tauri.py`.
Native toolchains and packaging are additional checks. Electron is retained
as a compatibility shell; installing its dependencies downloads Electron.

The hosted API, publication exporter, read-only public viewer and GCP templates
are reusable components. They do not have deployment credentials and the
repository does not automatically provision cloud resources.
