# Approved public viewer

The existing React atlas can now consume the approved release format from
[public-release-export.md](public-release-export.md), as well as the existing
canonical RDF snapshot. This does not build/deploy a public runtime image or
change which records are approved.

## Browsing

The project picker and Contents project buttons load that project's graph. URL
parameters `project` and `record`, together with the view hash (for example
`#records`), preserve the selected project and record across reload and browser
Back/Forward. A record ID is always interpreted inside its selected project;
identical IDs in separate graphs cannot reuse the previous project's details.
Graph component state and filters reset on project change. An aborted or late
load cannot install another project's data over the active selection.

Records provides a searchable text list for every published record type, including
concepts, lexical forms, editions, schools and articles. Sources includes sources,
works and editions. Existing graph exploration and attributed argument views stay
available. Details expose approved citation, locator, source role, attributed
people, source revision, origin and each review limitation. An implementation or
visibility approval never upgrades source review status.

Approved mode shows published record counts and read-only navigation. It excludes
the legacy browser-local discovery screening controls; discoveries are not in an
approved bundle. It makes GET requests only to public data files, with credentials
omitted. It does not query owner APIs. Theme preference remains local. Legacy RDF
mode retains its existing separate discovery screen and browser-local screening.

An all-withdrawn release shows an intentional empty state and loads no graph.
Unknown projects, failed graph loads, project identity mismatches and malformed
indexes show an unavailable state. They never fall back to `public-graph.json` or
another project's data. Where an index is valid, the picker remains available to
recover by selecting another published project.

## Artifact boundary

Client validation checks index/version/path shape, selected project identity,
graph identities/endpoints and approved-mode invariants. It is defense against
broken/mixed delivery, not publication authorization: anything served as JSON is
already public regardless of what React displays. The exporter and subsequent
image builder must independently verify the exact allowlisted projection before
serving it. Source links are rendered as inert text/HTTP(S) links; script/data
URLs, embedded credentials and query-bearing links are refused.

Deploy a complete verified immutable bundle as one unit. Browser requests use
`cache: no-store`, but this does not invalidate a CDN or remove data already read
in an open tab. Remote deploy freshness, cache withdrawal, public-only image
construction, removal of owner entry points/legacy data from that image and live
GCP operation remain #41/#42 gates. The normal development build still contains
both owner and public entry points and the legacy snapshot; do not describe it as
an isolated approved-only production artifact.

The public export details label records an export time and published project
count. It does not reinterpret the exporter's `deployed: false` as a live deployment
claim, display an unrelated harvest log, or imply scholarly quality.

## Verification

`npm test` runs loader/path/identity/route/link contracts. Build with `npm run build`
then run `node scripts/review-workspace.mjs` from `web/` for owned Chrome checks.
The harness uses synthetic public fixtures and intercepted synthetic owner APIs;
there is no production authentication bypass. Existing private reading, passage,
note-conflict and publication checks still run.

The checked-in `web/scripts/fixtures/approved-release.json` is synthetic data made
by the actual approved bundle exporter. A Python test reconstructs that bundle,
compares every public data file, stages it and runs the independent verifier.
Browser tests exercise multiple projects, the same record ID across projects,
reload/Back/Forward, citations/limits, inert markup, dark/mobile layouts, anonymous
GET-only browsing, wrong-project refusal, all-withdrawn output, unsafe index paths,
unknown-project recovery and legacy RDF compatibility. These checks do not prove
real GCP deployment, specialist scholarly review or complete accessibility and
older-Mac performance acceptance.

Security-sensitive public data delivery still needs the human review described in
the [publication threat model](publication-threat-model.md). No new dependency,
external data provider, cloud resource, publication approval or security exception
is introduced by the viewer integration.
