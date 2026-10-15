# Reading library and bounded pilot integration

The authenticated `workspace.html` now provides three library actions:

- **Add a source** opens explicit source identity/access/rights review and optionally imports a located permitted excerpt. On successful, verified readback, the workspace opens that exact document rather than whichever document sorts first.
- **Read the Sirry article** offers the existing bounded Sirry article preset. It is a manual transcription of the first four sentences of the owner-provided abstract screenshot, not a publisher extraction or full-article reading. Edition, wording, identity, storage basis and confirmation remain owner choices. A retained intake draft is never overwritten by the preset.
- **Start Qur’an pilot** previews the identified Q 4:59 and Q 4:83 Arabic resource returned by the owner API, together with the full source notice, attribution, provider/version label and review limits. Each exact UTF-8 verse digest is checked before showing it. Adding a verse is an explicit private write and opens its verified immutable reading document and annotation, where margin notes, source marks, definitions and reference capture are available.

Library panels have reloadable URL `view` values (`add-source`, `article-pilot`, `pilot`), and browser Back/Forward restores the panel or reading view. Drafts are scoped to project and retained only in page memory; unsaved work prompts before page unload. Successful saves are durable in PostgreSQL. These panels do not promise that unsaved drafts sync across devices.

The pilot can page through separately classified recorded material for either verse and return to an exact source annotation and document. A changed underlying citation decision remains a visible review warning. Missing translation/commentary statements refer only to loaded recorded material; they are not claims about the literature or complete coverage. Verse reading resources are separate from interpretive claims, scholarly review and public publication. No translation or tafsir text is silently downloaded or bundled.

## Verification

`npm test` covers bounded resource digests, preserved Arabic text, source/document/annotation readback, source notice, retained unknown-result request bodies, initial validation versus uncertain retries, and project/range isolation. The compiled Chrome checks are:

```sh
cd web
npm test
npm run build
node scripts/review-workspace.mjs
node scripts/review-source-intake.mjs
node scripts/review-pilot-reader.mjs
```

The standalone component fixtures use explicitly synthetic API adapters and synthetic Arabic test text. They exercise browser behavior and exact retry/navigation contracts, not production authentication or live PostgreSQL. The owner backend PRs supply real database/API tests. Live cross-device authentication, deployment and restoration still need their own release evidence.

## Integration dependencies and remaining work

The workspace requires the reviewed source-intake backend, including `intake_context` provenance, the identified pilot import/verse-material backend, and the source notice/mark-style reader backend. Runtime grants and migrations must be deployed together. The new owner modules remain excluded from the allowlisted anonymous public artifact.

Source-to-verse material classification/editing, an actual side-by-side translation/commentary selection surface, durable cross-device reading-place controls, fuller source ingestion, live hosted verification and substantive reviewed commentary population are separate follow-ups. A verse panel containing only an imported Arabic resource is not a completed scholarly commentary corpus.
