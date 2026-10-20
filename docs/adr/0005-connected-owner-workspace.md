# ADR 0005: workspace ownership with optional organization

- Date: 2026-10-19.
- Status: accepted; schema/API and frontend implementation merged in #207–211.
  See [delivery evidence and hosted release gates](../features/connected-workspace-delivery.md).
- Delivery: #201; source identity #101; writing #95/#96; organization #139/#205.
- Supersedes: project ownership/required project selection in the target product,
  including project-first organization portions of ADR 0004 and earlier UI plans.
- Preserves: one-owner auth, private authoring, explicit anonymous publication,
  current curated RDF authority and all existing exact-source/save/recovery contracts.

## Context and decision

Research develops across books, questions, traditions and unrelated loose ideas.
Requiring a project to create a source or note makes organization a prerequisite for
thought and encourages copies or artificial topic ownership. A hidden default project
would retain that conceptual/API constraint despite changing the sidebar.

Use one authorized owner workspace as the durable ownership boundary. Sources,
writing, questions, supported research records and connections have stable identities
independent of collections. Manual collections are many-to-many organizational
references. Saved views are versioned query definitions. Projects are removed from
required product flows; a future goal-oriented project could reference existing
research, but no project management feature is required by this decision.

Keep work, edition/translation, representation/version and passage distinct. Reuse
existing note/annotation/record histories and source rigor. Optional roles on writing
or linked extraction into supported records allow ideas to become questions,
interpretations, decisions or principles without forcing every jot into a formal
scholarly claim. Exact quotations and sourced assertions keep their provenance rules.

## Before implementation

1. Inventory actual tables/FKs, global versus tuple IDs, note/save/recovery UUIDs,
   old URLs, provider bindings, progress, active jobs, search/semantic models,
   curated RDF/public approvals and grants. Record the chosen authority per object.
2. Specify ownership, uniqueness, optional collection membership, global request
   contracts, aliases and rollback. This ADR intentionally does not pretend exact
   table/constraint decisions are already verified against all runtime writers.
3. Map each legacy project-qualified target to its original stable source/note and
   version. Existing groupings may map to collections. Preserve conflicting/uncertain
   identity or reading signals for review; no title merge or concatenated notebook.
4. Reconcile global creation/update/search/count/traversal, first source/first note,
   recovery, publication and agent/Obsidian/export paths. Avoid two editable Markdown
   or graph authorities and avoid legacy APIs silently writing into retired ownership.
5. Rehearse synthetic migration, exact-byte/history/Unicode retention, aliases,
   retry/conflicts, rollback refusal after incompatible new activity, and anonymous
   rejection on PostgreSQL 17/18. Keep owner local-preview writing out of test inputs.
6. Ship one coherent UI cutover once the global authority works. Legacy aliases may
   remain for compatibility; do not require a gradual project-first user experience.

## Trust boundaries and consequences

| Risk | Required mitigation / proof |
| --- | --- |
| Global search exposes private writing | Existing owner auth; pre-filter results/counts/intermediates; anonymous published projection only |
| Collection mistaken for access/publication scope | Organization never grants access; explicit publication retains source/edge approval checks |
| Alias conflates two old sources or translations | Explicit origin/version mappings and unresolved duplicates; validate hashes/locators and old links |
| Unlinked capture loses writing or creates duplicates | Global note/recovery authority, frozen UUID and CAS, newer typing/IME preservation |
| Two views edit copied notes | One body/history authority and IDs; views store references/query definitions |
| Semantic processing invents knowledge or returns stale bodies | Derived revision-aware index, coverage/fallback, attributable proposals and explicit review |
| Direct reset discards old state | Inventory and rehearsal; preserve identity/history/Trash and bounded rollback/restore gates |

No database migration, new grant, auth change, embedding provider, dependency or
external integration is authorized merely by this planning artifact. Implementation
of private ownership/data access needs a reviewable threat/permission inventory under
#202 before release. Deleting collections cannot delete objects, publish/withdraw
research, move exact annotations or reset read state.

## Alternatives rejected

- A global-looking union of project-scoped copies: still duplicates writing and scope.
- A required Unfiled/default project: still makes authoring depend on a project.
- One enormous always-visible graph: adds navigation cost; local threads/readable lists
  and independent writing are core.
- Automatic accepted links/types from similarity: conflates discovery with evidence.

Hosting and one-owner operation remain PostgreSQL on GCP under #30; #42 still owns
actual cross-device/backup/public proof. This ADR is not deployed-state evidence.
