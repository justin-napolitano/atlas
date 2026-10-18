# Qur’an reader candidate — 2026-10-18

**Status:** Local implementation prepared for owner review under #172, #173, #174, and #164. No deployment, publication, human reading session, or editorial promotion has occurred.

## Bounded resources

The continuous reader covers complete Surahs 1 (7 ayat) and 4 (176 ayat). The Arabic display is an exact extraction from Tanzil Uthmani 1.1, official numbered text, source SHA-256 `bf4f57b968d03f4131c070b1e285da9be0e0a108a21c910e872801ca273312c8`. `scripts/build_quran_reader_resource.py` checks that hash and every ayah number; the generated JSON retains the source copyright notice and per-ayah text hashes. The owner UI shows the notice and links to [Tanzil](https://tanzil.net/) and its [license](https://tanzil.net/docs/Text_License). This validates digital identity and structural completeness, not a critical edition or any interpretation.

English options are provider-labeled **English Translation - Noor International Center** (`english_saheeh`, version 1.1.2 observed 2026-10-18) and **Rowwad Translation Center** (`english_rwwad`, version 1.0.19 observed 2026-10-18) from [QuranEnc](https://quranenc.com/en/home/api/). Despite its API key name, the first is not labeled “Saheeh International” in the provider catalog. The displayed label and version come from the live catalog. Each requested surah must return every verse in order; an outage or incomplete response leaves Arabic readable and marks English unavailable. The Clear Quran preference in #172 remains an explicit resource gap; no licensed edition was verified for this implementation.

QuranEnc's API terms request unmodified translation display, clear provider/translator/version credit, current updates, and reporting of translation notes. The application displays provider text and metadata without editing it, fetches the provider's current resource, and stores only exact private verse snapshots when a user starts a note or highlight. **Before any public rollout, the owner should review those terms against the intended private annotation and redistribution behavior**, particularly the translation-note reporting clause. No QuranEnc translations are bundled or published by this change.

## Reading and writing behavior

`Sources → Reading tools → Read the Qur’an` opens continuous Arabic/English reading with surah and ayah navigation, shareable verse location, display toggles and sizes, source identity, translation footnotes, and attributed linked context. A note or selected-text highlight associates its exact displayed verse with a private source and immutable reading document automatically. The backend rechecks resource identity and text hash before saving; changed wording is rejected so an old note cannot silently move to a new translation. Existing private reader annotations, recovery, revision history, and publication boundaries apply. An uncertain highlight retains its UUID and exact payload for retry. The server reading bookmark is an explicit **Save place** action, with **Resume** across reloads and revision conflict handling. Scrolling alone does not save a place.

This does not add a commentary corpus, glossary, or all 114 surahs. Existing Q 4:59 / Q 4:83 linked materials keep their own attribution and coverage limits. No machine-supplied source acquires a human-reviewed or public status.

## Verification and acceptance

The local tests cover Arabic hashes and completeness, provider label/version/order and failure behavior, owner API isolation, PostgreSQL association idempotence and permissions, translation corrections, and existing frontend behavior. The owner OpenAPI contract is regenerated. See `docs/reading-desk-checkpoint.md` for the actual 30-minute session required by #146. Browser/device interaction and recovery during a real session still require observation; synthetic tests cannot close #146. The inspected Q 4:59 source comparison is a separate proposal in `reports/pilot-ulul-amr-review-proposal-2026-10-18.md`; owner editorial decisions and any curated graph update are still required for #15.
