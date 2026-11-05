# Source extraction verification

Verified locally on 2026-11-05:

- Python suite: 518 tests, 288 passed and 230 skipped. Skips require an isolated
  PostgreSQL service or other external integration resources.
- Frontend unit tests: 184 passed. Desktop host/policy tests: 9 passed.
- React application and reader sample builds passed.
- SQLite schema baseline, generated API contracts, semantic metadata and SHACL
  validation passed.
- Real local startup created an empty SQLite workspace in an isolated temporary
  directory. The API rejected unauthenticated requests, accepted a private local
  session, preserved an exact Unicode note and deduplicated retries. Restarting
  the launcher retained that note exactly.
- Headless source intake browser checks passed, including explicit confirmation,
  lost-response retry, source reuse, Unicode excerpt readback and narrow layout.
- Public extraction checks found no forbidden paths or recognized credentials.
- Standalone Gitleaks v8.30.1 scanned the new Git history with zero findings.
- Frontend npm audit reported zero vulnerabilities after updating Vite to 6.4.5.

The private staging repository's Actions jobs did not start: GitHub reported an
account billing/spending restriction. This is not a CI pass. Local PostgreSQL,
container builds/scans, native Tauri compilation, packaged desktop acceptance and
hosted deployment were not verified by this extraction pass.

Publication is a software-source release. It does not publish the original
research, migrate an installed workspace, enable backup synchronization or
deploy cloud infrastructure. Third-party reader resources retain their notices.
