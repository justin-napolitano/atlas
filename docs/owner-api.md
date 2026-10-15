# Owner and public research API

This service adds the hosted application boundary over the PostgreSQL store. It is not yet a deployed sign-in flow or the complete reader UI. One human owner edits; the public runtime exposes only published snapshots and has no owner routes.

## Run and configuration

```sh
uv sync --frozen --extra graph --extra database --extra api --extra test
# Inject the settings below through your local or managed environment.
uv run --no-sync uvicorn islam_research.api:create_app --factory --host 127.0.0.1 --port 8080 --no-access-log
```

Required environment configuration:

| Variable | Meaning |
| --- | --- |
| `RESEARCH_DATABASE_URL` | Private PostgreSQL connection configuration; never browser-visible or logged |
| `RESEARCH_MODE` | `owner` (default, fail-closed) or `public` |
| `RESEARCH_OWNER_SUBJECT` | Exact stable subject from a verified IAP token; required in owner mode |
| `RESEARCH_IAP_AUDIENCE` | Exact IAP resource audience, required in owner mode |
| `RESEARCH_OWNER_ORIGIN` | One exact HTTPS browser origin, required in owner mode |
| `RESEARCH_VERSION` | Release identifier for bounded operational logs |

Use GCP IAP for the owner service. The backend validates its signed `x-goog-iap-jwt-assertion`, ES256 signature, trusted key ID, issuer, audience, issued/expiry times, maximum lifetime, and configured owner subject. It does not trust unsigned email/user headers. The audience for Cloud Run has the form `/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME`; consult [Google's signed-header specification](https://docs.cloud.google.com/iap/docs/signed-headers-howto) for the actual deployment value. A valid identity belonging to somebody else receives 403.

Signing keys come only from Google's fixed IAP public-key endpoint with a five-second timeout, response-size bound, five-minute cache, and bounded refresh/cooldown. Crypto verification is provided by the pinned PyJWT/cryptography libraries, not custom signature code. No production environment switch bypasses authentication; tests inject ephemeral synthetic keys through Python only. The browser does not store or manage a reusable API token.

Writes require `X-Research-Write: 1`, JSON content type, and an exact matching Origin when supplied. No cross-origin CORS permission is granted. This permits a properly authenticated non-browser client with the explicit header without allowing cross-site forms. IAP cookie/session settings, owner IAM access, connector identity, direct-ingress behavior, logout/revocation, and actual sign-in still require live deployment verification under #33.

## Operations

Owner-only routes:

- `GET /v1/me`, `/v1/projects`, `/v1/records`, `/v1/record`, `/v1/personal-states`, `/v1/schema`.
- `POST /v1/projects` creates a scoped project.
- `PUT /v1/records` creates/updates an owner record with expected revision.
- `PUT /v1/personal-states` saves reading progress, screening, and private notes with expected revision.

Lists use bounded keyset pagination (maximum 100) and `next_cursor`; record IDs remain stable strings rather than path components. The schema endpoint is owner-authenticated. Generated OpenAPI files can be produced offline with `scripts/export_api_schema.py`.

Public mode registers only `GET /v1/public/snapshots/{snapshot_id}` and health routes. Every published read verifies that its database role can SELECT the public snapshot table, cannot write it, and has no private schema access. A public service accidentally supplied with owner/admin credentials refuses reads and readiness. It cannot create or edit projects, notes, graph records, or schema. Snapshot creation/allowlisting remains the explicit publisher implementation in #41; this service cannot turn arbitrary private records public.

Both modes provide `/health/live` and `/health/ready`. Readiness checks storage; public readiness also checks the read-only boundary. Health is not authentication. A Cloud Run deployment must use dedicated identities and bounded service concurrency/connection limits; do not expose the migration identity through either runtime.

## Failure and privacy contracts

Expected revisions are mandatory for updates: zero means create, otherwise send the current server revision. A stale write returns 409 with the current owner-visible record, allowing the client to preserve its draft and resolve the conflict. Reading progress is independent of review/publication; the server assigns read timestamps.

Validation returns field/type identifiers without echoing submitted notes. Unexpected failures return a generic problem response and request ID; operational logs contain route templates, method, status, duration, release, and error class, not queries, bodies, tokens, source passages, or exception text. Disable default server access logs, which could include private query text. Never add full payload capture for debugging.

Streamed request bodies have a 64 KiB limit and five-second read timeout. The current per-instance rate bounds are 120 owner requests/minute and 600 public requests/minute, excluding liveness. They are local capacity guards, not distributed quotas; review them with runtime max-instance/concurrency/pool settings before launch. Security headers apply to JSON/API responses. This strict API CSP must be adapted for a separately reviewed frontend-serving configuration, not weakened globally to run arbitrary inline scripts.

## Verification and limits

```sh
uv run --no-sync python -m unittest discover -s tests -v
uv run --no-sync python scripts/export_api_schema.py --check
```

HTTP/signature tests use real ES256 signing and the maintained verifier against ephemeral synthetic keys. Transport fakes cover error/auth boundaries only. With `RESEARCH_TEST_DATABASE_URL`, integration tests also use real PostgreSQL for durable multi-session writes, stale conflicts, and a restricted publication-reader login. The role-creation fixture requires an isolated administrator-owned test database with local trust authentication, as supplied by CI; never run these tests on production.

The current schema/import rules are retained: canonical RDF records cannot be edited through the store until authoring authority is explicitly migrated. The owner API does not yet provide source acquisition, public publication writes, agent credentials, Obsidian sync, or full domain-specific claim validation. GCP project/owner configuration, SQL runtime grants, container/runtime rollout, frontend integration, live sign-in and security review remain release requirements; passing these tests is not a production-readiness claim.
