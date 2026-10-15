# Portable research semantics

This is an offline, pinned Ossie interchange model and a versioned research-policy companion. It describes shared meanings and proposed operations. It is not a database/query engine, an authentication layer, a source-quality oracle, or an implementation of article-complexity extraction.

## Upstream selection and attribution

The official repository exposes tag `osi-0.1.1-rc1`, resolved to commit `faf581054dcf7964d5fe0ceae7d6f415c8ce32a5`. Its core document version is `0.1.1`; this does **not** turn the release candidate into a final stable release. We use the immutable tagged shape for metadata exchange instead of silently following the mutable `0.2.0.dev0` development format. Future upgrades require a reviewed schema/model migration and compatibility tests.

The unmodified schema, LICENSE, LICENSE-Docs, and NOTICE are retained in `vendor/apache-ossie/`. Attribution: Open Semantic Interchange, copyright 2026, upstream [Apache Ossie repository at the pinned commit](https://github.com/apache/ossie/tree/faf581054dcf7964d5fe0ceae7d6f415c8ce32a5). Upstream licenses code under Apache-2.0 and specification/documentation under CC-BY-4.0; retain both notices/license files with the schema. `upstream.lock.json` records their checksums and original source. Checksums detect local drift; they are not a claim that we independently verified a release-signing key.

At this pinned revision, model documents contain a `semantic_model` array and custom-extension vendor values are enumerated. Our one-model export uses `COMMON` with a `research_platform` namespace inside its JSON string. We do not invent a new core vendor value or add unsupported core datatype/ontology fields. The newer ontology work remains under assessment; mappings not implemented in our canonical RDF are marked reserved in the companion rather than claiming conformance to a draft ontology.

## Contents and meaning

| File | Role |
| --- | --- |
| `research.ossie.json` | Four PostgreSQL datasets with keys, scoped fields, composite joins, and two descriptive metrics |
| `research-policy.json` | RDF kind/predicate mappings and named ranking/traversal definitions |
| `upstream.lock.json` | Immutable upstream identity, release status, licenses, and file checksums |

The dataset joins describe storage grain. For example, a relation's `(project_id, from_id)` joins the record's declared `(project_id, id)` key. That join does not mean scholarly support or intellectual influence. The explicit predicate and located provenance carry research meaning. Personal reading/screening is separate from review and publication, and the private model is not the anonymous publication projection.

Current path definitions:

- `question_evidence_trail`: incoming addresses-question, outgoing evidence, then outgoing source. Each step composes typed endpoints and preserves original direction. A broad topic link cannot replace a located evidence step.
- `claim_attribution`: direct attribution to a source/person, explicitly different from a located evidence argument.

Limits, cycle handling, and authorization-before-traversal are declared, not implemented by a JSON schema. The backend must execute only registered operations under its own identity/policy checks and return exact paths, provenance, review scope, and truncation/no-path information. Never execute arbitrary SQL from a loaded semantic model or treat `ai_context` as permission.

Ranking definitions cover discovery relevance, personal reading priority, article reading demands, personal preparation, and unique-neighbor connectivity. Features/weights are explicit, total weight is one, missing required observations propagate an unknown score, and ties use stable IDs. They are marked `definition_only` until the actual feature extraction/executor/evaluation fixtures land in #36/#55. In particular, absent full text or sparse history metadata is not an easy article, and unfamiliar Arabic names/transliterations are not an inherent quality penalty.

## Validation and upgrade workflow

```sh
uv sync --frozen --extra semantic
uv run --no-sync python scripts/validate_semantic.py
uv run --no-sync python -m unittest discover -s tests -p test_semantic.py -v
```

Validation verifies hashes, upstream JSON Schema, unique names, table/field bindings, declared composite grain, typed path composition, bounded traversal policies, mapped/reserved kinds, and supported finite normalized weights. Remote schema retrieval is disabled. It does not execute expressions, connect to PostgreSQL, rank sources, generate definitions, or verify scholarly truth.

For an upstream upgrade: select an immutable revision, retain its original notices, inspect breaking changes, update the manifest/model adapter, and run negative compatibility tests before accepting the new contract. Do not edit the vendored schema to make our model pass. The later main-branch flat document format is deliberately rejected by this pinned adapter until explicitly migrated.

See #34 for interoperability, #36/#55 for ranking/extraction, #37 for runtime graph traversal, #38 for authenticated model discovery, and #50 for editorial interpretation/review.
