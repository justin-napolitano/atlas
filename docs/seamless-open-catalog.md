# One catalog, direct reading, durable notes

Owner direction, 2026-10-17: the catalog spans open collections. Finding, reading,
and taking notes should feel continuous. Import is a fallback or an implementation
detail, not a required user workflow.

Delivery tracking: #168 is the shared catalog contract; #170 is Gutenberg; #169 is
Open Library; #166 is arXiv. These extend #84/#88/#100/#101.

This is a proposed delivery contract. It is not a claim
that the current excerpt-based application already supplies federated full-text reading.

## User flow

1. Search once across connected catalogs. Results show a title, responsible people,
   edition/language, and a small availability indicator. Provider attribution and
   alternative editions remain accessible without a provider-choice wizard.
2. Open an available supported text directly in the reader. Adding it to a project,
   manually entering bibliography, and importing a file are not prerequisites.
3. Highlight, write in the margin, or add source-level commentary. Saving the first
   note establishes its durable source/version association behind the scenes.
4. Find the note through the notebook or search; return to the same reading location.
   Save to library, associate with another project, and offline storage are optional
   actions rather than gates before reading.

Use Read for an actual supported readable representation. A provider-only viewer,
borrowable item, unavailable text, or metadata-only record needs an honest concise
alternative. A remote provider page does not automatically support our inline marks;
source-level notes can still accompany the reference. Do not display working-looking
annotation tools over a representation the application cannot anchor.

## Catalog and collection boundaries

The public discovery catalog, the owner's saved library/project memberships, readable
representations, and private notes are distinct. Searching or opening a public result
does not add curated RDF nodes, confirm bibliographic ambiguity, mark it read, or
publish anything. A single work can have multiple editions/translations and available
representations from multiple providers. Provider records retain their provenance;
title similarity alone does not establish that two editions are interchangeable.

The owner's first save can atomically ensure the necessary project/source membership,
representation identity, and private note through an idempotent owner action. Reuse
known external identities where verified; prompt only when ambiguity blocks a reliable
target. Keep earlier work/edition/annotation IDs resolvable. This requires the #101
identity design and the existing private authoring boundary; it cannot be implemented
by silently treating public search hits as authenticated project records.

## Preserve anchors without demanding imports

Store note content, source identity, edition/version, retrieval provenance and location.
For exact annotations retain the selected quotation, context and verified selectors,
plus a content/version fingerprint where available. Reuse the W3C Web Annotation
model already selected in ADR 0001. A useful quotation does not require mirroring a
whole book. Free source-level commentary does not require an invented quotation.

Fetching, parsing or caching may be necessary internally for EPUB/PDF/HTML reading.
Resolve/cache permitted content on demand with explicit size/time/storage limits.
Use persistent version references and only the material needed for dependable anchors;
retain a full representation when supported and justified by reading/offline needs.
Evicting a cache must not delete notes or pretend their quotations remain verified.
If the upstream text changes or disappears, preserve the note and original citation,
explain unavailable or unresolved anchors, and require review before relocating marks.

The current API anchors exact annotations to immutable saved reading documents.
This design must extend or automatically establish that authority safely. It does
not remove document/hash verification, invent successful remote annotations, or
replace the canonical curated RDF graph with a second source of truth.

## Provider plan and standards

| Provider | Catalog/reading approach | Important distinction |
| --- | --- | --- |
| Project Gutenberg | Published machine-readable catalog/OPDS and permitted ebook acquisition paths; begin with supported plain text/HTML | Digital ebook identity and release date do not establish a specific print edition. |
| Open Library | Search/catalog identifiers plus reading-availability resolution | Exact versus related edition matches and access/borrowing states remain distinct. |
| arXiv (#166) | Metadata/version lookup plus a supported available representation | A newer preprint version does not replace the one attached to existing notes. |
| Further open collections | Add adapters for candidate catalogs such as Wikisource, Standard Ebooks, and open-access scholarly collections | Verify access terms, version locators, formats and API availability per provider before promising direct reading. |

Use OPDS acquisition/navigation links where provided, supporting actual feed versions
rather than requiring providers to adopt OPDS 2.0. Normalize provider-specific APIs
behind the same result/edition/availability model. OPDS helps discovery/distribution;
it is not a renderer, identity-matching oracle, rights clearance, or note-sync protocol.
Reuse existing bibliography, provenance and W3C annotation contracts instead of
inventing a universal replacement format.

Gutenberg publishes machine-readable catalog data and asks automated clients to use
its designated machine access paths, not crawl the human-facing website. Its catalog
also documents the distinction between digital releases and print provenance.
Sources: [catalog documentation](https://www.gutenberg.org/ebooks/offline_catalogs.html),
[machine access policy](https://www.gutenberg.org/policy/robot_access.html).

Open Library supplies availability lookup and provider access states as well as
catalog metadata. Respect its request policy and attribute retrieval provenance.
Sources: [Read API](https://openlibrary.org/dev/docs/api/read),
[API policy](https://openlibrary.org/developers/api).

Discovery standard: [OPDS 2.0](https://specs.opds.io/opds-2.0.html).
Candidate expansion references: [Wikisource offline reading](https://en.wikisource.org/wiki/Help:Reading_offline),
[Standard Ebooks help](https://standardebooks.org/help),
[PMC open-access resource service](https://pmc.ncbi.nlm.nih.gov/tools/oa-service/).
The expansion list is not a claim of implemented adapters or unrestricted availability.

## Provider pacing, privacy and delivery

Use cached catalog indexes or published dumps when suitable, incremental refreshes,
per-provider queues/backoff, bounded concurrency, and the previously requested polite
round-robin scheduling. One slow provider should not block all results. Show partial
coverage and unavailable providers; do not silently fabricate a complete search.
Do not transmit private notes or personal research text to catalog providers.

Public catalog reads stay separate from owner-only notes and library writes. A resolver
accepts validated provider identities/known acquisition routes, not unrestricted URLs
to internal services. Apply redirect, content, XML parsing, network and extraction
limits; keep remote HTML/scripts inert. External integrations and new reading formats
need their existing security review and tests before release.

Deliver a Gutenberg search-to-first-note slice, then Open Library discovery/availability
through the same catalog, while #166 proves paper versions. Test supported reading,
missing text, related editions, partial provider failure, interrupted saves, duplicate
retries, changed upstream content, exact-note return, public/private isolation and
mobile use. User-defined files/manual capture remain supported fallbacks.
