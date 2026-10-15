# A bounded, real reading collection

This collection gives the Q 4:59 / 4:83 pilot actual located material to read and compare. It is an agent-prepared reading aid pending human/editorial review, not a new reviewed graph or a comprehensive account of Islamic authority. The canonical Turtle source identities and their existing review scope remain unchanged.

## What was checked on 2026-10-15

| Reading | Identified representation and location | Included material |
| --- | --- | --- |
| Q 4:59 and Q 4:83 | [Rodwell translation, digital catalog #3434](https://www.gutenberg.org/ebooks/3434), updated 2021-01-08; SURA IV.–WOMEN [C.], the paragraphs beginning “O ye who believe! obey God” and “And when tidings” | Two complete English verse renderings, retaining paragraph-internal line breaks and wording; CRLF becomes LF |
| Al-Tabari on Q 4:59 | [KSU Arabic transcription](https://quran.ksu.edu.sa/tafseer/tabary/sura4-aya59.html), the author’s preferred position after report 9875 and before 9876 | Eleven-word Arabic quotation, plus a separately labeled English analyst paraphrase of the preference and its limits |
| Al-Tabari on Q 4:83 | [KSU Arabic transcription](https://quran.ksu.edu.sa/tafseer/tabary/sura4-aya83.html), lexical explanation before report 9996 and adjacent reports 9996–10006 | Brief Arabic quotation containing *mustanbiṭ*, plus a separately labeled contextual/lexical paraphrase |
| Tabataba’i on Q 4:59 | [Al-Islam.org’s Al-Mizan excerpt](https://al-islam.org/who-are-ulul-amr-sayyid-muhammad-husayn-tabatabai/who-are-ulul-amr), credited to volume 8 and translated by Sayyid Sa’eed Akhtar Rizvi; section “O You Who Believe! Obey Allah And Obey The Messenger” | Nineteen-word English quotation; separate paraphrase of the unrestricted-obedience argument and its later identification of those in authority |

The Arabic comparison distinguishes al-Tabari’s recorded alternative reports from his own preference. The translated Al-Mizan comparison attributes its theological argument to its author instead of adopting it. Neither comparison establishes universal Sunni/Shi’i positions, historical consensus, or the reliability of the reported hadith chains.

The contextual cards give located reading help: distinguishing reported voices from an author’s conclusion, identifying Rodwell and Rizvi as named translators, a passage-specific *istinbāṭ* gloss, and a bounded *tafsīr*/exegesis gloss. These are explicit analyst paraphrases with source URLs, locators, scope, and related source/reading IDs. They are not complete biographies, school affiliations, concept histories, or automatically created concept records. Rodwell’s lifespan is supplied by the archive catalog; other unsupported dates and affiliations are omitted.

## Edition, translation, and reuse limits

Rodwell is a historical nineteenth-century non-Muslim translator, not an unnamed or authoritative default. The digital title page identifies Rev. J. M. Rodwell and the introduction writer Rev. G. Margoliouth. The precise underlying print impression is not established. The ebook orders suras chronologically and labels Sura IV as 175 verses; this collection manually aligns these two passages by wording/context to canonical Q 4:59 / 4:83 rather than counting paragraphs or assuming identical edition numbering. No Arabic manuscript/critical-edition alignment is claimed.

The [archive catalog](https://www.gutenberg.org/ebooks/3434) identifies US public-domain status. That is not a global rights conclusion. Only public-domain Rodwell text excerpts are reproduced, with source acknowledgements in metadata; this is not an archive-branded ebook or redistribution of its introduction/notes. The [archive’s reuse policy](https://www.gutenberg.org/policy/license.html) distinguishes public-domain text, trademark use, and reference/acknowledgement links. Future publication still needs its own rights review for the deployment and audience.

KSU’s underlying modern print edition/editor and general transcription-redistribution license were not established. Al-Islam.org identifies non-commercial hosting by permission, which is not a general license to republish the work. Commentary quotations remain short; English findings remain separately attributed analyst paraphrases. No full copyrighted text is committed or sent as a default import.

The Sirry publisher page returned HTTP429 during this pass. No retry loop or full-article review is claimed. The existing user-screenshot abstract preset remains separately identified; it is not promoted to full-argument coverage. Tabataba’i’s Q 4:83 commentary, additional modern Muslim translations, manuscript alignment, and broader tradition coverage remain explicit gaps.

## Resource and import contract

`reader_collection.collection_resource()` loads the pinned UTF-8 JSON, validates source identities, allowed evidence origins, reuse categories, exact-text hashes, bounded verse targets, pending review, and source-backed context links, then returns fresh data plus the artifact digest. Existing package-data rules include `resources/*.json`; no new dependency or migration is needed.

The resource has `sources`, `readings`, `context_cards`, `review_limit`, and `coverage_gaps`. Each reading contains an exact `text` quotation and its hash, a stable reference, edition/source/location scope, and a **separate** `finding` with `wording_mode: analyst_paraphrase`. Cards carry `kind: person|term`, `wording_mode`, scope, evidence URL/locator, and related source IDs. Structural validation is not scholarly verification.

`collectionPreset(collection, reading)` in `web/src/readerCollectionClient.js` maps a selected resource reading into the existing explicit source-intake flow. It imports only the exact quotation; never the analyst finding as source text. Its bounded `intake_context` preserves the resource digest, capture method, attribution/reuse notice, coverage, and labeled finding, including when the owner deliberately reuses an existing canonical source. Initial confirmation is false. Rendering or opening the collection performs no mutation or publication. The containing application supplies the owner-only API route and reader composition.

The first KSU Q 4:59 and Al-Mizan representations can suggest the existing canonical source IDs for deliberate reuse. Q 4:83 and Rodwell have no invented canonical IDs. Title/URL matches never merge editions automatically. The application must preserve its existing unresolved-save/draft guard before switching to another preset.

## Evidence and verification

Raw upstream bytes are retained only in ignored `research-library/collection-evidence`. `scripts/verify_reading_collection_evidence.py --evidence-dir research-library/collection-evidence` verifies pinned full-file hashes and quote anchors for the Rodwell file and both KSU pages. HTML verification collapses visible-text whitespace and omits script/style text; text wording is otherwise retained. A changed source hash or absent quote fails rather than silently updating the resource.

The Al-Islam.org content was inspected through the web reader, including the selected argument and author/translator credits. Its direct raw download returned an access-challenge page. The resource therefore declares `web_reader_visible_text` with **null** raw snapshot hash/filename; the offline verifier reports it separately instead of claiming raw-byte verification.

Python tests cover actual translation/comparison coverage, attribution, exact quote hashes, missing evidence, false review promotion, source/verse mismatches, bounded quotations, and located context. Frontend tests map every actual reading through the existing intake payload and ensure quoted text and analyst findings remain separate with complete bounded provenance and explicit confirmation.
