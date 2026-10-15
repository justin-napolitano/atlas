# ADR 0002: hosted research workspace and Apache Ossie semantic contracts

- Status: architecture accepted; implementation pending
- Date: 2026-10-15
- Supersedes: ADR 0001 decisions 7 and 9 for application storage and access. Local research tools remain supported.

## User requirements

The published application is a research workspace available from any machine, with one authorized human editor: the owner. Anonymous visitors can read explicitly published research but cannot write. Projects, notes, reading progress, screening decisions, and research relationships persist across sessions and devices. Obsidian and agents are additional clients of the same research records. Browser storage and files on one Mac cannot be the authoritative application database.

Use Apache Ossie for portable semantic definitions. Make ranking and graph navigation explicit, configurable, explainable, and consistent across clients. Keep source-grounded scholarship distinct from personal notes and automated proposals.

## Standards and execution boundary

[Apache Ossie (incubating)](https://github.com/apache/ossie), formerly Open Semantic Interchange, defines semantic model exchange. Its [core specification](https://github.com/apache/ossie/blob/main/core-spec/spec.md) covers datasets, fields, relationships, metrics, and extension metadata. Its [ontology specification](https://github.com/apache/ossie/blob/main/ontology/ontology.md) describes concepts, relationships, and mappings. These are definition formats; adopting them does not itself supply our hosted database, access control, ranking executor, graph algorithms, or synchronization service.

The upstream core currently identifies its main-branch specification as mutable `0.2.0.dev0`. Before implementation, select and pin an upstream revision and its corresponding schemas. Validate models against that exact schema in CI. Record which ontology features are experimental and test upgrades explicitly; do not bind production behavior to an unpinned main branch.

Retain stable graph IRIs and the RDF/SKOS/PROV-O/SHACL research meanings from ADR 0001. Map them explicitly into Ossie definitions and database views. SQL join relationships and scholarly assertions have different meanings: a dataset join does not assert that a source supports a claim. Keep that distinction in both schemas and API responses.

## Hosted records and clients

Use PostgreSQL hosted on GCP as the authority for application records and revision history. Target Cloud SQL for PostgreSQL with Cloud Run services/jobs, subject to concrete cost, provisioning, recovery, and access-control checks. Supabase is not the selected application backend. Public graph snapshots remain generated publications. Preserve the existing curated Turtle graph as an import/export and validation artifact; introduce hosted authoring only with an explicit mapping and migration, rather than silently establishing two editable authorities.

Common entities: workspace, project, research question, source/work, source edition, passage, claim, evidence, annotation/note, research activity, relation assertion, personal reading state, and screening decision. Every entity has a stable ID. Distinguish a work's external identifiers from edition-specific locators and a person's reading state.

Notes are Markdown bodies attached to IDs, with revision numbers, timestamps, author, visibility, and links to sources/questions/passages. Reading state is `unread`, `reading`, or `read`; it is independent of screening and source verification. A read timestamp records personal progress, not evaluation of scholarship.

The app edits these records through authenticated APIs. An Obsidian connector exchanges Markdown and metadata using the same IDs and revisions. A stale update must return a conflict and preserve both versions; never resolve concurrent edits solely by client clocks. Export/import is useful portability but must not be described as automatic synchronization.

Agents access the same permission-scoped APIs using revocable, scoped credentials. Public access exposes only explicitly published material. Filters, pagination, scores, counts, and graph traversal must all enforce workspace visibility before processing results. Semantic model metadata is not an authorization mechanism.

## Versioned ranking definitions

Define named ranking profiles as research-platform configuration, linked to the semantic model. When interchange requires them inside an Ossie document, use a clearly named extension rather than inventing standard core fields. The backend implements and tests their execution.

Separate three uses:

1. **Discovery relevance:** how closely a candidate matches a stated question, query, subject, or scope.
2. **Reading priority:** a personal queue, considering unread status, explicit interests, available source text, and missing coverage.
3. **Graph structure:** degree, betweenness, or other documented connectivity measures over an explicit edge set.

Each profile declares feature definitions, applicability by source role, weights, normalization, missing-value treatment, filters, deterministic tie breaking, version, and evaluation fixtures. Return the component values and explanation with each score. Reproduce a ranking using the profile version and input snapshot/revision. Unknown features are not silently scored as negative evidence.

Do not turn citation counts, centrality, provider rank, personal Keep decisions, or numbers of sources into truth, consensus, or universal scholarly-quality scores. Citation-based features, if deliberately added, must be labeled as coverage-dependent discovery signals. Coverage and counterevidence remain inspectable dimensions.

## Typed linkages and graph traversal

Define each research predicate's meaning, endpoint types, direction, allowed inverse traversal, evidence/provenance requirements, and review status. Map to existing graph predicates before adding new ones. Store who asserted a relation and on what basis. Do not substitute a generic similarity edge for supports, challenges, derives-from, addresses-question, or a private reading association.

Named traversal profiles declare allowed predicates, start/end types, direction, depth, node/edge limits, cycle handling, and publication/review filters. Initial useful queries:

- Question → attributed claims → located evidence → edition/source.
- Claim → supporting, challenging, and qualifying evidence, with actual relation labels.
- Source → recorded findings, my reading state, notes, and linked questions.
- Note → explicitly referenced passages/sources and related project questions.

Return the exact recorded path, directions, locators, provenance, truncation status, and model/profile versions. A path indicates connectivity with its stated meaning; it does not create a new entailment. Evidence trails exclude broad topic links and common author/activity provenance unless a caller explicitly requests a different exploration profile.

Run bounded graph queries in the hosted backend; the frontend graph is an exploration view of those results. Start with typed relation tables and bounded SQL queries before introducing another graph service. The existing client-side algorithms may support display but do not define cross-client semantics independently.

## Research protocol and agent interface

Reusable project workflow: question and scope → search plan → discovery and deduplication → screening → reading and located annotations → attributed findings → claims/counterevidence → synthesis and open gaps.

Expose model discovery, structured search, source lookup, note search, ranking explanation, evidence trails, and research-job status through one versioned API; optionally expose those operations through MCP. Search indexes source metadata, reviewed findings, notes, reading state, and typed relationships within the caller's access scope. Explicitly distinguish lexical search, embedding similarity, and graph retrieval when those capabilities are implemented.

Workers follow stored search plans, provider cooldowns, resumable queues, and resource budgets. Record inputs, source IDs, tool/model versions, output provenance, and failures. Machine proposals remain separate from human-reviewed findings. Jobs must not publish private notes or promote candidates into accepted evidence automatically.

## Implementation sequence and acceptance gates

1. Hosted identity, project membership, durable notes/reading/screening records, revision conflicts, and migration of existing browser decisions. Verify persistence from two independent signed-in browsers and denial of cross-user access.
2. Pinned Ossie schemas/models, explicit RDF mappings, ranking/traversal profile validation, and fixtures. Verify that schema validation and supported execution behavior are separate checks.
3. Authenticated search/ranking/traversal API and application integration. Verify score reproducibility, correct evidence paths, permission filtering before ranking, and bounded cyclic/disconnected traversals.
4. Background research jobs and an agent client using the same API. Verify resumability, cooldowns, proposal statuses, and published/private boundaries.
5. Obsidian connector using stable IDs and revision-aware updates. Verify edits from either client, renames, interrupted sync, concurrent changes, and deletion handling without silent data loss.

The current local inbox prototype does not satisfy the hosted persistence gate and must not be presented as the completed architecture. Deployment requires provisioning the hosted service and configuring sign-in; no hosted persistence or automatic Obsidian sync has been deployed by this decision.

Implementation is tracked in [roadmap #30](https://github.com/justin-napolitano/islam-research/issues/30), with dependency-linked issues #31–42. Start with infrastructure/cost design and PostgreSQL records, then owner/public authorization and the durable workspace.
