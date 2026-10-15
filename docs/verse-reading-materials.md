# Verse reading materials

Implementation in progress for #45. Stable verse/range IDs use the declared
`tanzil-structure-1.0` profile and remain separate from displayed wording,
translation, commentary, or scholarly interpretation.

## Identified pilot text

The bounded Arabic resource retains Q 4:59 and Q 4:83 exactly from Tanzil's
numbered Uthmani download, declared Version 1.1. The official
[download page](https://tanzil.net/download/) identifies that version; the
[text terms](https://tanzil.net/docs/text_license) permit verbatim use with
attribution, a Tanzil link, and the copyright notice. The resource embeds the
complete notice from the actual downloaded bytes, including its displayed year,
and records the exact download URL, options, source SHA-256, access date, and each
verse's UTF-8 checksum. The script does not remove diacritics, alter letters,
infer a reading tradition, or equate alternative numbering/edition traditions.

`scripts/extract_quran_pilot.py` runs offline against one pinned full download.
It verifies all 6,236 explicit chapter/ayah markers against the existing structure
profile and retains only the two unchanged verse strings. The full upstream file
stays ignored. Provider verification language inside its notice remains the
provider's statement, not this project's independent scholarly review.

Q 4:83 is a bounded text expansion. Its presence does not establish that any
commentary or interpretation for that verse has been checked. No translation
wording or copyrighted commentary is bundled. Translations and located source
excerpts retain their own attribution, version, locator, rights context, and
review limitations when explicitly added to private application state.

## Private source-linked material contract

Reading materials distinguish Arabic text, translations, tafsīr, linguistic
annotation, and secondary scholarship. The material's source is an immutable
captured annotation with its edition, locator, document identity, checksum, exact
quote and code-point positions; source attribution and scope are required.
Reference resolution is not interpretive evaluation.

Arabic/translation representations are separate from source links classified as
explicit citation, discussion, or attributed interpretive claim. Citation links
retain a confirmed reference resolution or an owner-identified exact citation
marker. A current citation change must surface as needing review rather than
silently moving the material to a different verse. Owner-identified markers are
declared assertions, not parser-verified citations. Interpretive statements retain
quotation/paraphrase mode, source attribution, scope and rationale and remain
pending review. Shared keywords do not create any of these links automatically.

Period, tradition/school, and reading notes are source-specific declared metadata.
Nonempty historical/traditional claims require a located evidential/context note;
unknown context remains unknown. These fields do not classify all Muslims or
assert intellectual influence. Material classification and original verse/source
binding retain their identity; mutable context corrections compare revisions and
preserve history. Public publication and canonical RDF remain separate gates.

The API/storage and reader acceptance will be recorded after verification. This
design does not claim a deployed reader, reviewed exegesis, authorized public
translation coverage, a completed pilot article, or full-corpus completeness.

## Paused implementation checkpoint — 2026-10-15

Branch `feat/verse-reading-materials`, based on PR #83. The first commit
`0d053d7` contains the reproducible, attributed pilot resource. Five local
resource tests passed, including reproduction against the ignored original
download. The original complete download remains outside version control.

The next checkpoint contains **unverified backend work**, not a completed
reader: migration `0009_private_verse_materials.sql`, `verse_store.py`, narrow
owner grants, owner-only API routes, generated owner OpenAPI, and eight real
PostgreSQL tests. Python compilation passed, and the static SQL/profile test
passed. The eight database tests were skipped locally because no test database
is running; their behavior is not yet verified. No new PR, CI run, deployment,
cloud provisioning, or merge was performed for this backend checkpoint.

Resume with:

1. Add HTTP boundary and real-database API roundtrip coverage, including public
   route exclusion, strict owner confirmation, paging, conflicts and lost replies.
2. Add the typed verse-material dataset and project-scoped joins to the pinned
   Ossie model; validate that these remain metadata, never executable caller SQL.
3. Run actual PostgreSQL 17/18 checks in GitHub Actions, inspect all failures,
   and verify immutable evidence, exact quotations, citation changes, history,
   role grants, and publication exclusion before calling the backend delivered.
4. Implement and test explicit pilot import and the verse-reading interface:
   identified Arabic resource, separately selected translation, resizable
   commentary comparison, source/annotation links in both directions, URL/back
   navigation, mobile/keyboard support, drafts and recovery. Preserve the full
   attribution/notice wherever the bundled Arabic text is reproduced/exported.
5. Verify Q 4:59 pilot coverage against actual located sources; keep Q 4:83
   coverage bounded and unreviewed. Missing translations/commentaries stay visible.
6. Update release evidence and issue #45 with actual results, then open focused
   reviewable PR(s). Issue #45 remains incomplete. The larger #30 roadmap also
   remains active; this checkpoint is not a completion claim for other issues.

## Resumed implementation

The resumed pilot branch now includes strict owner HTTP boundary and real-database
roundtrip tests, public route exclusion, and a fourteenth private Ossie dataset
with project-scoped source/annotation/citation lineage. The model exposes the
original citation snapshot separately from the mutable current resolution;
dataset joins establish lineage, not interpretive support. Local HTTP boundary
and semantic validation pass; real PostgreSQL verification is delegated to CI.
Pilot import, the verse reader, and the real content workflow remain in progress.
