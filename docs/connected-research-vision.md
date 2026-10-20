# One connected research workspace

Owner-approved product direction: 2026-10-19. Implementation is tracked in #207–211; see the [delivery ledger](features/connected-workspace-delivery.md)
for shipped code, verification and remaining release gates. Delivery epic [#201](https://github.com/justin-napolitano/islam-research/issues/201).
[Roadmap](second-brain-roadmap.md), [interaction contracts](features/connected-workspace-contract.md),
and [ownership decision](adr/0005-connected-owner-workspace.md) govern implementation.

## Purpose

A personal academic second brain centered on reading, writing and developing ideas.
The researcher can start with a source, a question, an unrelated thought, or nothing
more than a blank page. Islam, philosophy and religion are the initial interests;
their boundaries are not ownership boundaries. Constitutional law, literature and
other fields can connect later through actual source/locator requirements.

Everyday loop: read → notice something → write → connect it when useful → return
with a better question. Capturing an unrelated idea is equally complete work. A note
needs no source, project, collection, title, tags, classification, template, AI or
Obsidian. Leaving writing unorganized indefinitely is supported.

## Product decisions

- One private owner workspace owns the research. Remove Projects from the main
  product navigation and required authoring flows. Make one coherent product reset;
  compatibility aliases underneath preserve old data and links.
- Sources, editions, representations, exact passages, notes and research records
  keep stable identities. A book can inform any number of investigations without
  copying its text or its notebook. Existing uncertain duplicates need reconciliation,
  not automatic title matching.
- Organization is optional. Manual collections and saved views reference global
  objects; an object may appear in several or none. Removing a collection/view
  never deletes the objects, resets reading, changes review or publishes anything.
- Writing is the starting point. Question, personal interpretation, objection,
  decision and principle can develop later. Source claims remain attributed records;
  personal judgments and agent suggestions never silently become scholarly findings.
- Connections explain meaning: comments on, asks about, defines, supports, challenges,
  qualifies, or a clearly personal association. A shared tag or similar embedding
  establishes no argument, agreement or historical influence.
- A question can gather linked sources, passages, objections, notes and provisional
  answers. It is an investigation, not a compulsory new container for every thought.
- Preserve changing understanding: what was believed, what changed, why, and which
  sources prompted the revision. Earlier writing remains available. Personal
  chronology, source publication dates and historical claims are different records.
- Keep deterministic searching/reading/writing fully useful. Agents prepare proposals
  or locate candidates; the owner can do every core action without them.

## What exists and how it relates

| Object or view | Meaning | Identity rule |
| --- | --- | --- |
| Source/work | The bibliographic work being studied | Once when equivalence is verified; uncertain duplicates stay explicit |
| Edition/translation | A named textual realization | Distinct from other translations/editions |
| Representation | Retained immutable text/version or supported format | Hash, provenance and rights/availability retained |
| Passage | Exact quotation or structural reference | Original edition/version/Unicode selector; never shifted automatically |
| Note | Ordinary Markdown writing, optionally linked | One body, revision history and recovery authority |
| Question | An open investigation or a developed thought | Existing supported record/note authority; explicit promotion/extraction mappings |
| Concept | A scoped idea/term with meanings in context | Senses, periods, speakers and source usages stay distinguishable |
| Decision/principle | A personal choice or provisional position | Optional role/record, reasons and dated revisions; not verified source truth |
| Connection | Named relation between existing objects | Direction, provenance/reason and appropriate uncertainty/review state |
| Collection | Optional manual organization | Many-to-many references; no content ownership or publication permission |
| Saved view | Versioned search/filter definition | A live result projection, not copied content |

These are conceptual distinctions, not a mandate for a new universal object table.
Reuse the working note, source, annotation, graph and editorial authorities.

## Interface

One sidebar: **Continue · Library · Notes · Questions · Explore**. Global search
and a persistent New note action are always reachable. Optional collections appear
below these destinations. Account, appearance and truthful sync/storage status stay
quietly at the bottom. No required project switcher or nested notebook explorer.

Continue returns to confirmed reading places and recent writing. Library opens the
selected edition directly. Notes opens documents, including loose ideas. Questions
opens investigations. Explore first provides readable bounded connections; a large
whole-graph visualization is optional later work.

Retain the approved charcoal/ivory/red tokens, comfortable typography, live Markdown,
resizable source/margin context, keyboard access and mobile drawer/sheet behavior.
This is an organization/interaction reset, not another decorative visual redesign.

## Quick capture

New note or one documented app-scoped shortcut focuses a blank body immediately.
Meaningful writing autosaves privately. The first meaningful line supplies its display
title until the owner names it. Empty drafts do not create a library of empty notes.
No forced Inbox processing, metadata form or classification stage follows capture.

From a reader, capture preserves the exact reading place, selected text and unfinished
margin writing. It is unlinked by default. The owner may explicitly attach it to the
current source later; no quote selector is fabricated. Free margin writing remains a
separate action with its intended reading context.

Later actions are optional: [[link]] another thought/source/concept, develop a question,
add to a collection, explain a relationship, or leave the note alone. Recent Notes and
global search must find it before any of those actions exist.

## Research rigor and privacy

One workspace does not imply public content. One verified owner writes; anonymous
visitors see only explicitly selected public projections. Public source availability
cannot expose private notes, reading history, counts, suggestions or backlinks.

Source text, translations, commentary, personal interpretation and hypotheses stay
separate. Exact citations retain provenance/version/locator. Semantic similarity and
citation counts are discovery signals. Publication, scholarly review, question state,
personal familiarity, read state and agreement remain independent.

## Boundaries

Deliver global ownership/compatibility, effortless capture, Continue and optional
organization before elaborate graph layouts or new catalog breadth. Preserve Qur’an
and Gutenberg reading and existing note/recovery features. Continue #95 for the
primary book notebook, #101 for reviewed source reconciliation, #168/#196 for catalog
retention, #38 for application-state search and #40/#54 for later sync/archive.
Owner reading acceptance (#146) and hosted two-device/backup proof (#42) remain real
checks. The implementation was validated on synthetic databases and browser fixtures.
No live owner database was migrated, service deployed or owner writing read.
