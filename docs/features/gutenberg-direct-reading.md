# Gutenberg: search, read, annotate

Delivery: #170 under catalog contract #168, stacked after keyboard reading #190.
This implements the first plain-text provider; Open Library, EPUB/HTML rendering,
cross-provider identity matching and public catalog browsing remain separate.

Sources contains an explicit Gutenberg title/author search. Search is submitted,
not sent on every keystroke. Results open directly into the existing workspace.
The single sidebar holds book contents; Previous/Next move between bounded reading
sections. Existing appearance, exact Unicode highlights, free margin writing,
Markdown notebook links and source-version return apply. No bibliography form or
project save is required before opening a supported book. Save to project is optional;
the first real note atomically creates its private source and immutable section.
Recovery writes may establish that section before the actual note, preserving drafts.

## Source and storage contract

Official OPDS 1.x search supplies catalog results. Per-book RDF supplies creators,
translators, languages, digital release/update and reuse metadata. The provider must
declare “Public domain in the USA.” and offer UTF-8 plain text. Acquire the generated
text from `gutenberg.pglaf.org`, a Gutenberg-listed mirror. Unsupported formats and
other rights states get a provider link, never working-looking inline annotations.
This US status is not worldwide copyright clearance. Digital release is never
presented as original print publication. Provider summaries are not scholarly findings.

Recognized Gutenberg start/end markers isolate the body. Preserve every body code
point after CRLF/CR→LF; retain original header/license alongside the representation.
Raw SHA-256 identifies the acquired release; each section has its own text hash.
Uppercase CHAPTER/BOOK/PART/SECTION/LETTER lines are navigation hints. Long text is
split at paragraph boundaries into ≤10,000-code-point sections; these are not pages
or verified print chapters. Selecting a quotation uses existing W3C/Unicode selectors.

`gutenberg_books` retains public versioned text independently of project membership.
It is bounded to 128 versions, ≤4 MB acquired bytes each. No bulk ingestion runs.
There is no automatic eviction in this slice; maintenance/archival beyond that limit
is future work. Retained sections used by notes also become existing immutable
`reading_documents`, so their anchors survive upstream failure and catalog maintenance.
Normal saved-source/note links reopen those exact documents, rather than fetching a
new provider version. Cached books are reused; automatic daily content upgrades and
version switching are deferred. No replacement/reanchoring happens silently.

`gutenberg_places` stores a private per-project/book version, section and Unicode
position with CAS revisions. Debounced scroll/section movement saves place, not
completion or scholarly review. Exact lost-response retries are idempotent. Newer
scrolling queues behind the original write; a competing device requires choosing
the saved or requested place. No note content or private position is sent to Gutenberg.
Existing draft ownership and recovery remain authoritative, not browser storage.

## Integration threat model and review

Public provider bytes cross into an authenticated owner API. Private project
membership, writing, recovery and resume remain owner-only; public runtime does not
register these routes or receive table privileges. No new dependencies, credentials,
CORS exposure or deployment settings are introduced. Review this API/egress change
before release under the Citizen Developer security policy.

| Threat | Risk | Mitigation / evidence required |
| --- | --- | --- |
| SSRF / redirect to internal services | High | Numeric ebook IDs; fixed HTTPS origins/routes; redirects refused; provider URLs never become fetch arguments |
| Malicious XML/HTML / script execution | High | Bounded UTF-8 XML; reject DTD/entities/NUL; plain-text React rendering only; no remote covers/images/scripts or HTML injection |
| Resource exhaustion / impolite crawling | Medium | 4 MB text / 1 MB metadata; socket timeout; serialized misses, two-second pacing, 30-second failure backoff, 12-entry memory cache and 128 retained versions; existing owner rate limit |
| Edition drift / misplaced private notes | High | Immutable raw/section hashes, deterministic project/version IDs, server-verified selection; first-note transaction; original saved snapshot on note return |
| Private content leakage / public mutation | High | No notes in provider requests; authenticated existing owner/CSRF boundary; no public tables/routes; error bodies exclude network/provider details |
| Lost saves / duplicate notes / competing resume | Medium | Existing frozen UUID note retries/recovery/CAS; serialized position queue and explicit conflict choices |

References checked during implementation: [machine access policy](https://www.gutenberg.org/policy/robot_access.html),
[OPDS and machine-readable metadata](https://www.gutenberg.org/ebooks/offline_catalogs.html),
[listed mirrors](https://www.gutenberg.org/MIRRORS.ALL), [license](https://www.gutenberg.org/policy/license.html).

## Verification

Validation is in progress. Use synthetic projects/writing for automation. Never
inspect or copy the owner's local-preview state. A separate loopback preview port
must not restart or mutate the owner's ongoing Qur’an reading session on 5183.
