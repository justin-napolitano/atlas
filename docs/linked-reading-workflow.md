# Passage connections and durable reading places

The owner reader connects the saved margin passage to the selected verse-range reader and back to the exact source document/annotation. Expand **Link to verse** beside a saved note to classify a located excerpt as scholarship, commentary/tafsir, or linguistic annotation, then explicitly state whether it discusses a verse or records an attributed interpretation. Attribution, scope, rationale and confirmation are required. Exact quotations and owner-recorded paraphrases remain distinguishable. These links do not manufacture an explicit citation or promote scholarly review/publication status.

Following a saved verse link opens a reloadable range view with separately classified source material and its exact quotations, editions, locators, scopes and attributed interpretation wording. The selected range is independent of a translation or edition. The identified Arabic resource is shown only for matching Q 4:59 / Q 4:83 pilot verses; another range does not borrow unrelated Arabic text or invent a translation. Missing-material labels refer only to the loaded owner records. Returning from a material opens its immutable source version and exact annotation. Browser Back/Forward retains this path.

## Cross-device bookmark

**Bookmark this passage** saves the active saved annotation as the project's reading place. When no annotation is active, **Bookmark start of excerpt** explicitly saves the document start. **Resume saved reading** reloads that server bookmark and opens the source/document/annotation. This first slice has one bookmark per project; it does not synchronize unsaved notes, viewport scrolling, comparisons, multiple tabs, or the complete reading desk.

Writes use the last confirmed bookmark revision. A lost response retains the original source, annotation and expected revision for an exact retry. A different bookmark saved from another device is shown as a conflict; retaining the cloud bookmark or replacing it with the original requested bookmark requires an explicit choice. Merely opening a source, following a link or selecting text never silently overwrites the bookmark. A range saved by another client without an annotation can be retained on the server, but this UI explicitly opens its excerpt start and warns that it does not restore that range.

The bookmark UI requires the `reading/desk` backend/migration from the durable-reading-place slice; source links require the verse-material backend. Owner identity remains the authenticated server identity; all writes stay private. No cloud provisioning or live cross-device verification is claimed by these UI changes.

## Verification

Frontend contract tests cover bookmark identity/ranges, frozen unknown-result CAS retries, explicit other-device conflicts and acknowledgement mismatch refusal. The compiled workspace browser flow exercises an actual saved margin note → source-to-verse discussion save → lost response/exact retry → selected Q 2:255 range → exact source return; unrelated Arabic text is absent. It also exercises bookmark save/lost response/retry, reload, source navigation/resume, and another-device conflict with explicit replacement. Fixtures use synthetic data and transport responses; real PostgreSQL/IAP checks are separate backend/release evidence.

Run `npm test`, `npm run build`, `node scripts/review-workspace.mjs`, `node scripts/review-verse-links.mjs`, and `node scripts/review-pilot-reader.mjs` in `web/`. CI includes all reader/intake/pilot/link browser checks and the independent public-artifact checks; no private owner module is added to the public allowlist.
