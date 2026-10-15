# Located Qur’an reference candidates

This implementation supports roadmap #43 and #45. A reference proposal is not a
claim about the meaning of a verse, source quality, scholarly review, or rights to
publish the selected passage. It must retain the original source record, edition,
locator, snapshot hash, and captured quotation when integrated with the reader.

`islam_research.quran_citations.detect` operates offline on one saved quotation
of at most 500 Unicode code points. It recognizes explicit `Q 4:59`, Qur’an-prefixed
numeric forms, same-chapter ranges, and comma/and lists. Arabic and Persian decimal
digits retain their spelling and positions. It also recognizes bounded English
phrases such as “verses 59 and 83 of chapter 4” when a Qur’an/surah cue occurs in
that selected quotation. Each narrative proposal retains the complete phrase,
including the chapter; different proposed verses have different candidate keys.

Every proposal preserves its exact marker and zero-based code-point offsets
within the captured quotation. Repeated references at different positions remain
separate occurrences. Candidate keys incorporate parser version, marker, positions,
and proposed target. Do not use these keys as permanent scholarly entity IDs.

Bare `4:59` is ambiguous and is not automatically interpreted as Qur’anic.
Named-surah-only references, implicit allusions, other narrative languages, and
cross-chapter ranges need manual resolution. Invalid chapter/verse bounds and
cross-chapter ranges remain unresolved proposals rather than being silently
truncated to a valid verse. Detection never changes a record's review status or
creates curated graph edges.

## Reference structure and attribution

The bundled `resources/quran-structure-v1.json` derives only chapter indices and
ayah counts from [Tanzil Quran Metadata v1.0](https://tanzil.net/docs/quran_metadata),
[source XML](https://tanzil.net/res/text/metadata/quran-data.xml), accessed
2026-10-15. The source identifies `(C) 2008-2009 Tanzil.info`, license `cc-by`
without a license version. The derived resource records that attribution, source
URL, source SHA-256, access date, and the limited transformation. No Qur’an text,
translation, names, historical classification, or interpretive metadata is copied.

The identifier `urn:research:quran:tanzil-structure-1.0:4:59-59` is a local,
versioned reference identifier. Its bounds are specific to that declared structure
profile. It is independent of edition and translation; it does not establish a
universal numbering system or equate other numbering traditions. A future profile
requires explicit, evidenced mappings rather than silently reusing these IDs.

Validated references include a link to the first verse at Quran.com. For a range,
this link opens only its first verse. This is a navigation link, not a verified
edition, translation, commentary, API result, or claim of commentary coverage.

## Durable private resolution and retrieval

The authenticated owner API exposes:

- `GET /v1/reading/scripture-candidates?project_id=…&annotation_id=…`: pure
  detection plus saved owner decisions for an active, anchored source snapshot.
- `PUT /v1/reading/scripture-citation`: explicit confirmation or dismissal,
  candidate key (or `manual`), proposed resolved chapter/range, rationale, literal
  owner confirmation, and expected revision. The backend derives the marker and
  source binding itself. Clients cannot supply them or impersonate the actor.
- `GET /v1/reading/scripture-citations?project_id=…&chapter=4&ayah_start=59&ayah_end=59`:
  confirmed, overlapping reference links in that project with source identity,
  edition, locator, selected quotation, snapshot hash, and annotation identity.
  Pages are bounded to 25 with stable cursors. Deleted sources are excluded.

The private `research.scripture_citations` table separates immutable original
marker/proposal provenance from editable owner resolution and rationale. Bounds
and source/selector integrity are enforced in PostgreSQL as well as Python.
Column grants prevent the runtime owner from rewriting the original provenance;
history is trigger-written and immutable to the runtime. Updates compare revisions.
An exact retry after a lost response returns the committed revision without adding
duplicate history. Other stale writes return a scoped conflict for explicit choice.

There is one editable manual mapping per captured annotation, clearly labeled as
an owner connection rather than a source's explicit citation. Distinct detected
occurrences have independent decisions. Additional manual connections can be
captured as separate annotations; multi-mapping slots are not implemented here.
Parser version and original marker remain stored. A future parser change needs
a compatibility/migration policy before previous-version candidates can be edited.

The reader offers these controls under **Link Qur’an references** on each saved
passage. Drafts survive record navigation in page memory, failed saves retain the
typed decision, and cloud conflicts require an explicit comparison/choice. Closing
the page before saving loses a draft after the existing unload warning. Confirmed
decisions and dismissals persist in PostgreSQL and reload from the owner API.
Neither notes nor decision drafts enter browser localStorage.

**Find linked passages** provides reverse verse navigation back to the original
source and exact captured passage. It displays the first 25 matches; the API cursor
supports further pages, while the current UI asks for a narrower range. The original
edition, locator, and full excerpt version remain separate from the verse identity.

Private annotation JSON-LD includes namespaced reference-resolution objects,
original marker offsets within the selected quotation, source hash, detector/mapping
kind, owner decision, revision, rationale, structure profile, and resolved stable
reference ID. The parent W3C annotation retains its source selectors and bounded
prefix/suffix context. This is export, not bidirectional import or publication.

The private Ossie model now describes reading snapshots, captured annotations,
and reference decisions with project-scoped composite relationships through to
source records. Full excerpt text is excluded from its metadata fields. These are
discoverable contracts, not executable SQL. `/v1/research-operations` advertises
the registered reference endpoints, limits, and their lack of review/graph/publication
effects. There is no free-form query execution or automatic agent approval.

## Verification and remaining work

`uv run --no-sync python -m unittest discover -s tests -p test_quran_citations.py -v`
checks all 114 chapter boundaries, Unicode offsets/digits, source-abstract narrative
syntax, repeated occurrences, false-positive boundaries, and unresolved invalid
and cross-chapter ranges. The detector performs no network requests.

Real PostgreSQL 17/18 CI tests exercise restricted owner/publisher logins,
confirmation/retry/CAS/history, manual mapping/dismissal, reverse lookup, invalid
selectors/bounds, wrong projects, and private JSON-LD export. HTTP tests separately
verify signed-owner/CSRF requirements, strict confirmation, forbidden client fields,
and absence of every new route in public mode. The browser harness exercises exact
capture, navigation-retained drafts, reload, lost acknowledgements, conflicts,
reverse links, dismissal, mobile overflow, and private-storage boundaries with
synthetic API responses. A browser fixture is not proof of a live hosted login.

This slice does not supply scripture/translation texts, a comparative commentary
reader, named-surah resolution, alternative numbering alignment, publication of
resolved links, an agent proposal service, or Obsidian reference import. Those
remain in #43/#45 and the wider roadmap. Actual release evidence is recorded in
`docs/hosted-release-evidence.md`; no cloud resources are provisioned by this work.
