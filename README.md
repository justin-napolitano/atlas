# Atlas

A local-first workspace for connected thinking: Markdown notes, linked pages,
sources, reading, questions, skills and principles.

Atlas grew from a research workbench into an extensible personal knowledge
application. This repository contains the reusable software and synthetic
examples. Your writing and imported documents belong in your private workspace.

## What is here

- Keyboard-first Markdown capture, page links, backlinks, folders and properties.
- Source reading beside notes, exact passage anchors and revision-aware saves.
- A personal library, questions, graph exploration and source provenance.
- Embedded SQLite desktop storage, backups and verified restore; PostgreSQL
  support for hosted authoring and migration.
- Tauri and Electron shells, a React interface and a Python API/CLI.
- Explicit GitHub backup/export and task tools. Connecting an account and
  selecting data for export remain deliberate user actions.

This is evolving software distributed as source. Native packaging, hosted
deployment and synchronization have separate requirements; this publication
does not install or deploy a service.

## Start an empty local workspace

Requires Python 3.12+, Node.js 22+ and [uv](https://docs.astral.sh/uv/).
The desktop shells currently target macOS. The source launcher below uses SQLite
and opens the authenticated workspace in your browser.

```sh
git clone https://github.com/justin-napolitano/atlas.git
cd atlas
uv sync --frozen --extra api --extra database --extra desktop-sqlite
npm ci --prefix web
uv run --no-sync python scripts/atlas_local.py
```

The launcher builds the frontend, creates an empty SQLite workspace under
`~/.local/share/atlas-open-source`, and opens a local authenticated session. Stop
it with Ctrl+C. It does not import bundled examples or connect a GitHub account.
Use `--state-dir /absolute/private/path` to choose another workspace and
`--no-open` to start without opening a browser. Keep the state directory outside
the checkout. The original Atlas installation uses a separate default directory.

## Development

See [development and verification](docs/development.md),
[public extraction boundaries](docs/public-extraction.md), and
[security reporting](SECURITY.md).

The `atlas` CLI provides research and graph tools. `islam-research` and the
`islam_research` Python import remain compatibility aliases from the original
implementation. These names do not restrict the subjects you can work on.

The graph starts empty. An explicit synthetic example is available at
`tests/fixtures/example-research.ttl`; it is never automatically imported.
Atlas ships without a built-in scripture reader or bundled source texts. Add the
sources you choose to your private library.

## License

Atlas-authored code and synthetic examples are provided under the [MIT license](LICENSE).
Third-party code and schemas retain their respective licenses
and notices. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
