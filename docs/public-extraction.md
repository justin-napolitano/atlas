# Public extraction boundaries

This repository begins with a new Git history. The original repository remains
private with its research, commit history, issues, pull requests and workflow
logs. None of those histories are copied into the public repository.

## Included

Application source, migrations, storage and backup tools, desktop shells,
frontend, tests, generic contracts/templates, semantic schemas and validation
workflows. Attributed third-party reference texts are listed in
THIRD_PARTY_NOTICES.md.

## Excluded or replaced

- Research data CSVs, reading-list workbook and original source files.
- Owner hypotheses, questions, research plans, reports and authored graph.
- Harvested discovery metadata and generated public graph snapshots.
- Research-specific narrative documentation, issue templates and old screenshots.
- Owner-provided article abstract, collection quotations and interpretation notes.
- Original Git history, issues, PRs, releases, workflow logs and repository secrets.

The graph is empty by default. Test graph data, the collection, the source intake
preset and static viewer examples are clearly synthetic. Startup creates an empty
workspace and does not seed those examples.

`islam_research` imports, RDF vocabulary IRIs and database identities remain
technical compatibility identifiers. A code publication must not rewrite an
existing private workspace or silently migrate its data.

The extraction checker rejects disallowed data directories, state files, private
keys, token-like values, workstation paths and the original research snapshot.
This complements manual review; it is not an independent security certification.
