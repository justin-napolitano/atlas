# Sources, Questions, and Notes

The owner workspace uses one project sidebar for three direct destinations. **Add source**, **New question**, and **New note** are visible actions. Search and Agents remain in the shared header. The old duplicated Reading/Notebook navigation and nested Study tools disclosure are removed. Comparison, the reading collection, Qur’an pilot, article preset, all research records, and saved reading place remain accessible as direct sidebar actions. Settings/publication remain in More.

## Sources

The catalog requests actual source, work, and edition records from the existing owner API, with independent further-page loading. Sources with no loaded reading excerpt remain references and can still be opened or extended through the confirmed source-intake workflow. Saved editions link to their immutable document IDs. The catalog exposes title/description filtering of loaded records and a saved-text view of the loaded reading library; More sources and More saved readings extend those respective scopes. Counts explicitly describe shown/loaded material. Read by you is shown only when backed by loaded owner reading state; it is separate from the record's scholarly review status.

## Questions

New private working questions reuse `notebook_entries` with `thought_type=question`; they are not a new canonical authority. The page starts a scoped Markdown outline for scope, working answer, unresolved issues, and evidence to investigate. The owner supplies the actual answer, source connections, and explanation. Save question uses the existing signed-owner UUID/CAS/retry/history contract. Entry selection is reloadable through the notebook entry identifier in the Questions URL.

New-question drafts use a distinct page-memory key from new freeform notes. Starting a question cannot overwrite an unfinished note. Questions remain available as typed entries in the broader private notebook and search. They are not automatically published, reviewed, marked answered, or inferred to support a claim. Custom question stages and notebook folder metadata are not introduced by this pass.

Existing questions from the research graph are listed separately with their recorded review status. Opening one shows its actual recorded evidence trails and context inside the contained panel, preserving the private writing page. Missing evidence is shown as a gap. Following a located source keeps the same writing context. Curated statements and private working answers remain distinct.

## Notes and connections

Notes retain independent writing, Markdown preview, deliberate wiki links, backlinks, the private note graph, revision-aware saves, and contained passage citations. The Connect surface is visible directly instead of living inside another disclosure. Search results resolve existing stable IDs; adding a connection still requires a reason and an explicit note save. ID linking and revision history remain advanced disclosures. New creation actions prepare drafts without posting automatically.

The reading edition control shows a compact edition/location label. Clicking it reveals the actual version picker with full provenance. The stored edition, locator, document ID, and immutable bytes are unchanged. Annotation actions still appear on text selection. Global Agents opens an unanchored brief from inventory/writing destinations rather than silently borrowing the last opened source; model execution is not added.

## Validation and limits

The compiled notebook browser suite covers source/work records including metadata-only references, saved-text filtering, direct source intake, private-question creation/readback, question/note draft isolation, recorded questions/evidence gaps, and mobile widths. The existing full workspace and search/brief regressions remain required. Unit coverage checks compact edition labels without mutating provenance. Local review uses the same explicitly labeled loopback adapter; it does not demonstrate hosted identity or multi-device sync.

No migration, new dependency, canonical RDF change, hosted deployment, remote source fetching, or background model worker is introduced. Related implementation issues: #125, #126, #127, #128. This follows the connected notebook/reader work in PR #124.
