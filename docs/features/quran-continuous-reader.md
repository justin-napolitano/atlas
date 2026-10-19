# Qur’an reader resources and notes

## Source access evidence — 2026-10-18

The official Tanzil Uthmani 1.1 text and official Talal Itani ClearQuran God edition (publisher update 2026-10-09) were actually downloaded and validated against all 6,236 numbered ayahs. Their original bytes, embedded notices and SHA-256 pins ship in package resources. No runtime provider calls, scraping, API credentials or automated text updates occur. A changed pin, missing or duplicate verse fails closed.

- Tanzil: https://tanzil.net/docs/text_license — CC BY 3.0 with verbatim-copy conditions. Source notice is retained in the original file and reader attribution.
- Talal Itani: https://blog.clearquran.com/download — CC BY-ND 4.0; publisher expressly permits format conversion and selected verses with unchanged words and attribution. Plain text: https://d.clearquran.com/text/clearquran-god-edition.txt . Wrapped paragraphs are retained inside their numbered verse; no HTML or footnotes are injected.

**ClearQuran by Talal Itani is not Mustafa Khattab’s The Clear Quran.** Khattab and Saheeh are explicitly unavailable pending configured provider access and reuse authorization. They are never silently substituted. The resource catalog exposes the actual named edition. This is text availability, not an assessment of translation quality or scholarly verification.

## Security and authority review

The resource routes inherit the owner router’s signed-owner boundary; they are not added to the public snapshot runtime. Inputs use explicit resource allowlists and bounded canonical chapter/ayah validation. Responses are plain JSON text; the UI must render text nodes, never provider HTML. No remote URL input or SSRF path is introduced. Runtime source validation is cached and offline; no per-verse upstream traffic.

Personal source bindings and notes remain owner/project scoped, never promote RDF claims or automatically publish. Immutable resource hashes distinguish edition wording from edition-independent ayah references. Existing exact quotation capture, notebook CAS, history and Trash remain authoritative. Hosted release still requires its existing IAP/PostgreSQL deployment verification; local fixtures are not proof of that deployment.


## Reading and writing

Open `/workspace.html?project=YOUR_PROJECT&view=quran` to resume, or add `&chapter=4&ayah_start=59` for an exact starting verse. Choose a surah, enter `4:83`, or continue scrolling. All 114 surahs have identified Arabic and English coverage; the chapter request never substitutes an unavailable translation. Navigation names come from pinned official Tanzil metadata, with the same structural counts and retained attribution.

Arabic and English have independent visibility, sizing and fonts. Appearance is a device preference; the signed-owner PostgreSQL reading place uses a canonical chapter/ayah and selected representation, with CAS and explicit conflict/retry handling. No screen number is treated as a mushaf page.

Click an ayah number for its margin. Shift-click a later ayah for a range; a range snapshot is limited to 12,000 Unicode code points. Ayah/range notes, surah notes and whole-Qur’an notes are distinct. Surah/source notes have no fabricated document, quotation or position selector. Their context is recorded beside the ordinary notebook entry; their source/version remains immutable. First-note source/document/entry creation commits together and retries reuse one creation UUID. Simply reading does not import thousands of bibliography records.

Select words and choose **Highlight & note**. Unicode-safe selection is capped at 500 code points. Persisted highlights open their exact passage note beside the continuous text. Those notes autosave in the Qur’an sidebar; existing general-reader behavior remains available. Marks are queried only for the currently pinned resource identity and verified against the immutable document hash and exact wording before rendering. A highlight is never projected onto the other language or a changed edition. Range annotations remain accessible in their original range snapshot rather than being split into invented per-ayah selectors.

Notes support the existing Markdown renderer, notebook search, history, recovery and Trash. Unconfirmed first-note saves retain their original UUID and payload while newer typing remains queued. Private recovery copies retain unfinished text; recovery is distinct from a confirmed note and may require comparing another device’s revision. Notebook notes offer a direct return to their canonical Qur’an context; original exact source snapshots remain available alongside the notebook.

The commentary disclosure uses actual owner-recorded verse material, including its edition, locator, attribution and review limits. It makes no claim of comprehensive tafsir coverage. No text or personal writing is promoted into the curated/public research graph automatically.

## Verification and remaining release gates

`web/scripts/review-quran-reader.mjs` builds the real components with an explicit synthetic API boundary and the real pinned resource bytes. It checks complete An-Nisa, actual computed font changes, working-tab control visibility, first-note atomic response handling, lost acknowledgement plus newer typing, Arabic/English isolation, exact highlight/Markdown autosave, surah/source scopes, semantic resume and phone overflow. `tests/test_quran_workspace.py` runs against real PostgreSQL 17/18 in CI, including unprivileged owner/public roles, rollback, idempotency, scoped notes, immutable versions and resume conflicts. API boundary tests cover sign-in, public route absence, CSRF and rejected forged/oversized input.

The local preview still uses its durable local review adapter, not hosted PostgreSQL/IAP. Apply the normal database migrations and runtime grants before deploying this owner API. The owner’s actual reading session (#146), hosted two-device/backup/public-release checks (#42), full scholarly pilot (#15), and additional licensed translation/provider connections (#19) remain separate work. Khattab and Saheeh availability is an explicit resource gap, not a silent fallback.

The existing Tanzil pilot uses the same official resource ID, source identity, edition label and verbatim notice as continuous Arabic reading. Its saved document and annotation IDs are reused; legacy Arabic highlights remain visible rather than becoming a second disconnected copy. A real PostgreSQL regression test imports through the original pilot endpoint and verifies the continuous binding and marks retain those IDs.
