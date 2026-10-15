# Editorial review and corrections

The owner is the initial editor. An owner-reviewed record is not externally peer reviewed. Programs can check structure and propose research changes; they cannot establish interpretive correctness or turn inaccessible/unread material into verified scholarship.

## What is being reviewed?

| Object | Required review | A successful check does not establish |
| --- | --- | --- |
| Source/work and representation | Identity, author/attribution, source role, edition/translation, identifier/URL, access/rights, dating uncertainty | That the full work was read or its argument accepted |
| Passage/annotation | Original context, precise locator, representation/version, accurate quotation or fair paraphrase, language/translation | That a cited passage supports every linked claim |
| Claim/definition/relation | Atomic scoped assertion, who says it, located evidence/rationale, relation meaning/direction, competing readings and limits | Universal truth, consensus, or an unqualified historical influence |
| Article/synthesis | Claim-level traceability, source-role distinctions, disagreements, coverage, uncertainty, and review scope | Comprehensive corpus coverage or specialist peer review |

## Editorial states

Keep these axes separate in storage and UI:

- Processing: discovered, extracted, or proposed; include tool, activity, and source provenance.
- Review: pending, needs-follow-up, reviewed-with-scope, disputed, or withdrawn; record reviewer, time, rationale, and reviewed portions.
- Publication: private/draft versus explicitly published revision; never infer public visibility from review status.
- Personal progress: unread/reading/read, and separate screening Keep/Skip/Read later. These are not source evaluations.

Existing graph status strings retain their original meanings during migration. Map their actual scope rather than converting every occurrence of “verified” into “fully reviewed.” A new review must not inherit the authority of an unrelated prior review.

## Claim discipline

Identify whether a statement is a primary-text observation, historical claim, attributed interpretation, normative/metaphysical argument, owner inference, or hypothesis. State who/what/when/where and the limits needed to understand it. Normative or metaphysical arguments are not mislabeled as empirically tested findings.

Every substantive assertion must have located support and attribution, or be clearly labeled as an inference, proposal, or evidence gap. A citation to an entire book is insufficient when the assertion depends on a specific passage. A source's explicit statement, a dictionary gloss, an analyst paraphrase, and a proposed definition are different assertions.

Legal, theological, philosophical, devotional, and institutional affiliations may overlap, change, or be disputed. Preserve attribution/date/scope. A shared name or school does not prove identity, teacher/student contact, agreement, transmission, or influence.

## Reading and representation

Read the cited passage with enough surrounding context to represent the source fairly. Name the translation and mark uncertainty where wording matters. Keep short quotations exact, attributed, and located; indicate omissions and do not place a paraphrase in quotation marks. Distinguish a source's argument from the owner's evaluation.

Record the actual evidence checked. Reading an abstract supports claims about that abstract's stated scope/argument; it does not verify all detailed examples in the paper. An extraction result is not a completed reading. If source access fails, preserve that limitation.

Evaluate source role, edition, method, specialist context, perspective coverage, and relevant disagreement. Do not replace these with citation counts, prestige, graph centrality, provider ranking, personal Keep decisions, or a universal quality score. Difficulty is a separate description of reading demands and personal preparation.

## Review checklist

1. Open the actual source representation and locate the passage; check identity, context, language, and version.
2. Check the assertion and its attributed speaker; compare the locator to the precise wording or fair paraphrase.
3. Identify the assertion type, scope, method, uncertainty, and evidence that could revise it.
4. Inspect significant alternative readings/counterevidence without manufacturing a false balance or treating one author as an entire tradition.
5. Check the proposed relation/definition and whether the cited material actually supports it.
6. Record reviewer/time, scope, rationale, remaining gaps, and a revision. Structural validators report only structural checks.
7. Review privacy/rights and explicitly choose the revision to publish. Missing source access or unchecked interpretation stays visible.

The template `templates/editorial-review.md` records this evidence. Prioritize review by consequential claims and evidence gaps so one editor can maintain the work.

## Corrections, disputes, and withdrawal

A correction creates a new revision linked to the prior one, recording reason, author, time, changed evidence, and affected records. Preserve original assertions and review history. Mark a disputed or withdrawn assertion explicitly; do not silently delete its provenance or imply the replacement was always known.

Find dependent claims, definitions, relations, notes, articles, and public snapshots and queue them for impact review. Personal notes may reference a superseded source without adopting its claim. Unpublishing must update public exports and cache behavior while retaining private editorial history. An agent may propose this change set; the owner decides publication.

For the first pilot, use the existing Q 4:59 report as a bounded starting record. Check the existing locators again when producing a new article revision and preserve the outstanding full-argument and print-edition questions. Do not mark that future recheck complete merely because this policy exists.
