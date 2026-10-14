# Islam Research Atlas

A lightweight, static React frontend for the public research graph. It runs without an API server, database, API credentials, or third-party runtime calls. Vite builds ordinary static assets, so the `dist/` output can be hosted on Vercel or any static host.

## Run locally

```sh
cd web
npm install
npm run dev
```

Create a production build with `npm run build`; preview it locally with `npm run preview`.

## Public data boundary

`src/data/public-graph.json` is the only data bundled in the site. Refresh it intentionally with:

```sh
python3 -m pip install -e '.[graph]'
python3 web/scripts/export_public_graph.py --run-id 20261014T155152Z-080d85
```

The exporter reads the committed canonical `graph/research.ttl` plus one selected `research-library/searches/<run-id>/candidates.jsonl` queue. It does not copy a run directory. Candidate export is allowlisted to title, providers and provider IDs, DOI, authors, year, venue, work type, external landing URL, search query/rank provenance, retrieval time, and the fixed `candidate_unreviewed` status. Abstracts, full text, local paths, screening decisions, credentials, and private run notes are excluded.

The 196 discovery records currently in the bundle remain separate from the curated RDF graph. Their search query and provider ranks show how they were found; they do not imply relevance, quality, scholarly support, or consensus. Review candidates before adding sources, claims, or edges to the canonical graph. The map only displays relationships authored in `graph/research.ttl`.

Before refreshing or deploying a new data snapshot, inspect the generated JSON diff and confirm every exported field is public-safe. Never point the exporter at a private corpus or add unreviewed material to `graph/research.ttl` merely to make the visualization denser.

## Vercel

Import this repository into Vercel and set the project root directory to `web`. The included `vercel.json` builds with `npm run build` and serves `dist/` as a static site. There are no serverless functions or environment secrets. Vercel Hobby currently offers free personal-use hosting with a 100 GB/month transfer allowance ([pricing and terms](https://vercel.com/pricing)); quotas and eligibility can change, so verify them before deployment. The generated `dist/` folder is also portable to Google Cloud Storage or any static web host.

This project has not been deployed by this change.
