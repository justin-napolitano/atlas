# Qur’an reader resources and notes

## Source access evidence — 2026-10-18

The official Tanzil Uthmani 1.1 text and official Talal Itani ClearQuran God edition (publisher update 2026-10-09) were actually downloaded and validated against all 6,236 numbered ayahs. Their original bytes, embedded notices and SHA-256 pins ship in package resources. No runtime provider calls, scraping, API credentials or automated text updates occur. A changed pin, missing or duplicate verse fails closed.

- Tanzil: https://tanzil.net/docs/text_license — CC BY 3.0 with verbatim-copy conditions. Source notice is retained in the original file and reader attribution.
- Talal Itani: https://blog.clearquran.com/download — CC BY-ND 4.0; publisher expressly permits format conversion and selected verses with unchanged words and attribution. Plain text: https://d.clearquran.com/text/clearquran-god-edition.txt . Wrapped paragraphs are retained inside their numbered verse; no HTML or footnotes are injected.

**ClearQuran by Talal Itani is not Mustafa Khattab’s The Clear Quran.** Khattab and Saheeh are explicitly unavailable pending configured provider access and reuse authorization. They are never silently substituted. The resource catalog exposes the actual named edition. This is text availability, not an assessment of translation quality or scholarly verification.

## Security and authority review

The resource routes inherit the owner router’s signed-owner boundary; they are not added to the public snapshot runtime. Inputs use explicit resource allowlists and bounded canonical chapter/ayah validation. Responses are plain JSON text; the UI must render text nodes, never provider HTML. No remote URL input or SSRF path is introduced. Runtime source validation is cached and offline; no per-verse upstream traffic.

Personal source bindings and notes remain owner/project scoped, never promote RDF claims or automatically publish. Immutable resource hashes distinguish edition wording from edition-independent ayah references. Existing exact quotation capture, notebook CAS, history and Trash remain authoritative. Hosted release still requires its existing IAP/PostgreSQL deployment verification; local fixtures are not proof of that deployment.
