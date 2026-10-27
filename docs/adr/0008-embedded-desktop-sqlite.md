# Embedded SQLite for the local desktop

Owner decision: 2026-10-27. Use SQLite for the next lighter Tauri desktop build.
This supersedes the local PostgreSQL selection in the older desktop contracts.
Hosted authoring and anonymous published projections continue to use PostgreSQL
on GCP under ADR 0002. No automatic cloud synchronization is introduced.

## Storage and migration

The desktop uses Python's embedded SQLite library, a private database file outside
the replaceable app bundle, foreign keys, native CHECK constraints, revision
history and serialized writer transactions. Existing IDs, exact Markdown, source
selectors and revision numbers remain stable. The curated Turtle graph remains
the graph authority; implementation does not review or publish research.

The SQLite baseline maps the schema through PostgreSQL migration 0038. Its
versioned metadata and generated SQL are committed together. A bounded SQLGlot
syntax adapter translates parameterized domain queries; values stay separately
bound. Explicit SQLite callbacks enforce identity, source, selector, hierarchy
and history invariants. PostgreSQL row-locking operations become SQLite writer
transactions, retaining compare-and-swap and retry checks. Unsupported constructs
fail. PostgreSQL's independently tested roles and migrations remain unchanged.

Migration captures all 86 application tables in one PostgreSQL repeatable-read
snapshot. A new SQLite file receives those rows with foreign keys deferred until
commit, preserving imported history rather than generating new revisions. Every
table must match its row count and canonical exact-content SHA-256 fingerprint;
integrity, foreign keys and installed schema must validate. Selection changes
atomically only after verification and an independent reopen. PostgreSQL files
and a consistent PostgreSQL backup remain for recovery. Startup refuses to create
an empty SQLite workspace over an unmigrated PostgreSQL installation.

The native SQLite backup API creates a consistent database snapshot. A private
manifest includes its hash, byte size, table fingerprints and referenced original
file hashes. Restore validates all of these, preserves a backup of current state,
copies into a new database/artifact namespace, and selects it atomically. An
exclusive service lease prevents restore while another SQLite owner API is live.
Backups use the existing native `.dump` selection filter with an engine-specific
manifest; PostgreSQL archives require the retained PostgreSQL recovery runtime.

## Deliberate differences

Rollback journaling (`DELETE`) and `synchronous=FULL` suit the single human owner.
The build's SQLite 3.50.4 is older than the WAL-reset fix; WAL is explicitly
rejected rather than relying on the affected path. See the official
[SQLite WAL documentation](https://sqlite.org/wal.html). Future runtime upgrades
must revalidate the SQLite version and storage contract before changing this.

The ordinary workspace retains its literal search. Advanced lexical search uses
native FTS5 with Unicode tokenization and explicitly reports different ranking
from hosted PostgreSQL. Neither provides Arabic morphology or scholarly quality.
The desktop retains imported publication history but cannot advance public
publication state. Publish through the hosted owner workspace and its PostgreSQL
role boundary. The application still bundles its Python API; this is not a
complete Rust rewrite. Psycopg remains a small compatibility dependency for
existing SQL composition and typed domain errors; no server is bundled or started.

## Boundary and review record

Untrusted renderer input passes the existing loopback session, origin, explicit
write, owner confirmation and typed API validation. The renderer receives no
database path control, credential, SQL execution capability or native database
bridge. File ownership/modes and symlink checks apply before opening storage;
extensions are disabled. Startup verifies the migration and schema fingerprints.
Private content, migration exports, backups and receipts stay in ignored local
storage. Build resources contain runtime/public corpus only.

The new dependency and embedded storage boundary require human review under the
Citizen Developer policy before merge or public distribution. The implementation
remains a draft review; local owner installation is already authorized. Tests
must include independent SQLite behavior and all existing PostgreSQL contracts,
a real PostgreSQL-to-SQLite synthetic migration, frozen copied-bundle recovery,
and actual native WebKit acceptance. Package size and startup timings are
observations of the tested build, not a general performance guarantee.

## Build and recovery

Use the locked `api`, `database`, `desktop-sqlite` and `test` extras plus the
`desktop-build` dependency group. With the frontend dependencies installed:

```sh
python scripts/generate_sqlite_schema.py --check
python -m unittest discover -s tests -p 'test_sqlite*.py' -v
python scripts/build_desktop_runtime.py --sqlite --output research-library/sqlite-resources
cargo build --release --locked --manifest-path desktop/tauri/Cargo.toml
python scripts/package_tauri.py --resources research-library/sqlite-resources --output research-library/sqlite-build/Atlas.app
```

Existing installations must close Atlas normally before running
`scripts/migrate_desktop_sqlite.py --state-dir ~/.local/share/atlas --postgres-bin
<retained-app>/Contents/Resources/offline/postgres/bin`. The migration refuses an
active service lease and never replaces an already selected SQLite database.
Keep the retained PostgreSQL app and its matching pre-migration backup for an
explicit recovery operation; opening the older app is not a reverse migration.

The local checks include 73 SQLite behavioral/storage/research cases, five Rust
boundary cases, 56 selected PostgreSQL regressions and an 86-table synthetic
PostgreSQL migration with exact-content verification. Native copied-bundle
acceptance exercises save/reload/restart, full surah reading, export, unsaved-close
protection, renderer/network isolation and database-plus-artifact recovery. Final
installation evidence is recorded separately without owner content.
