# Islam Research Atlas

A lightweight, static React frontend for the public research graph. It runs without an API server, database, API credentials, or third-party runtime calls. Vite builds ordinary static assets, so the `dist/` output can be hosted on Vercel or any static host.

## Interface

A plain research index with red editorial accents: system type for navigation, Georgia for reading, numbered contents, and ruled lists. Light mode is the default. The light/dark switch saves the palette in this browser and applies it before rendering. Harvest details are under “Snapshot & harvest log” on the contents page.

The map starts with a question and its recorded incoming/outgoing connections. Follow a labeled record, choose one from “Jump to a record,” or use “Read notes” to inspect provenance. Red marks the current thread, not truth, review status, or confidence. The full-network view groups records by recorded links; at overview scale it aggregates inter-group links with exact counts, and opening a group or zooming in reveals individual records. Group anchors name a member; they do not assert a common topic or scholarly consensus.

Drag the graph background to pan, use the +/− and Fit controls to zoom, or focus the diagram and use arrow keys, +/−, and 0 (fit). Record buttons work with Enter/Space. Mobile starts at a readable scale and provides a connected-record list below the diagram. A text connection list is available on every screen size. “Copy link” saves the current root and view in the URL. The map uses native SVG with deterministic local geometry and no running simulation or new dependencies.

## Run locally

```sh
cd web
npm install
npm run dev
```

Create a production build with `npm run build`; preview it locally with `npm run preview`.

## Public data boundary

The app reads `public/data/projects.json` and each project's graph snapshot at runtime. Static JSON keeps nightly literature updates out of the JavaScript bundle. The project manifest includes only real, configured workspaces; add a project only when it has a public data source. Refresh a graph snapshot locally with:

```sh
python3 -m pip install -e '.[graph]'
python3 web/scripts/export_public_graph.py --run-id 20261014T155152Z-080d85
```

The exporter reads the committed canonical `graph/research.ttl` plus one selected `research-library/searches/<run-id>/candidates.jsonl` queue. It does not copy a run directory. Candidate export is allowlisted to title, providers and provider IDs, DOI, authors, year, venue, work type, external landing URL, search query/rank provenance, retrieval time, and the fixed `candidate_unreviewed` status. Abstracts, full text, local paths, screening decisions, credentials, and private run notes are excluded.

Discovery records remain separate from the curated RDF graph. Their search query and provider ranks show how they were found; they do not imply relevance, quality, scholarly support, or consensus. Review candidates before adding sources, claims, or edges to the canonical graph. The map only displays relationships authored in `graph/research.ttl`. The public index retains up to 5,000 recent leads and merges provider provenance between builds.

Candidate screening controls save relevant, not relevant, and read-later decisions in this browser's local storage. Those decisions are not uploaded or included in public snapshots. Clearing browser storage clears the screening decisions.

Before refreshing or deploying a new data snapshot, inspect the generated JSON diff and confirm every exported field is public-safe. Never point the exporter at a private corpus or add unreviewed material to `graph/research.ttl` merely to make the visualization denser.

## Daily harvesting and nightly builds

`.github/workflows/nightly-research.yml` runs the 48-query seed plan daily at 05:17 UTC. The providers are queried sequentially with a 60-second per-host cooldown; one run can take several hours. It exports only the public allowlist and a small health summary (provider success, zero-result, and error counts; new and repeated lead counts; last full run), tests and builds the site, then commits changed public data to `main`. When a harvest completes with provider errors, it retains the existing lead index while reporting the attempted run status and last successful run. A Git-connected Vercel project then deploys that commit automatically. The workflow needs the repository's default `GITHUB_TOKEN` with `contents: write`; it does not need literature-provider secrets. Run it manually from the Actions tab with `workflow_dispatch`.

The harvested queue and screening files stay ephemeral on the GitHub runner. Only the sanitized, bounded public snapshot is committed. Search candidates remain unreviewed and are never converted to curated graph claims by automation.

## Vercel

Import this repository into Vercel and set the project root directory to `web`. Enable Git deployments from `main`; nightly data commits will then trigger a fresh deployment. The included `vercel.json` builds with `npm run build` and serves `dist/` as a static site. There are no serverless functions or runtime API secrets. Vercel Hobby currently offers free personal-use hosting with a 100 GB/month transfer allowance ([pricing and terms](https://vercel.com/pricing)); quotas and eligibility can change, so verify them before deployment. The generated `dist/` folder is also portable to Google Cloud Storage or any static web host.

This project has not been deployed by this change.
