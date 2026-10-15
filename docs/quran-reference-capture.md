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

## Verification and remaining integration

`uv run --no-sync python -m unittest discover -s tests -p test_quran_citations.py -v`
checks all 114 chapter boundaries, Unicode offsets/digits, source-abstract narrative
syntax, repeated occurrences, false-positive boundaries, and unresolved invalid
and cross-chapter ranges. The detector performs no network requests.

Durable owner confirmation, manual mapping/correction, revision history, reverse
verse lookup, reader controls, and private JSON-LD export are the next integration
steps. This module alone does not deliver those flows or a commentary reader.
