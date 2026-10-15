# Isolated public site build and runtime

This packages one [approved release](public-release-export.md) with the
[public viewer](public-viewer.md) and a standalone Node 24 read-only HTTP runtime.
It is a verified portable directory, **not a container image, cloud deployment,
nightly scheduler or completed launch**. No database connection or cloud account
is needed to build or serve it.

## Build and inspect

Use a checkout with Node 24 and the locked dependencies:

```sh
uv sync --frozen --extra semantic
npm ci --prefix web --no-audit --no-fund
uv run --no-sync python scripts/build_public_site.py build --release /path/to/exact/approved/release
uv run --no-sync python scripts/build_public_site.py current
uv run --no-sync python scripts/build_public_site.py verify --path /path/to/exact/build-directory
```

Default output is git-ignored `research-library/public-sites`. `--path` selects an
output/current root, or an exact build directory for `verify`. Build inputs must
be tracked and unchanged relative to `HEAD`; the builder records their hashes and
source commit and checks them again after compilation. Commit intended source
changes on a review branch first. Successful build output is not source approval.
The verifier compares the recorded source-input hashes to its own checkout;
retain the matching tool/source version when archiving an artifact. Rewriting
artifact hashes and its claimed source hashes cannot substitute another runtime
for the reviewed verifier checkout's runtime code.

The compiler uses the locked installed Vite/React dependencies but loads neither
`vite.config.js` nor `.env` files, exposes no `VITE_*` prefix and copies no
`web/public` directory. `config/public-build.json` lists its public module boundary.
The Rollup module graph rejects unregistered local modules, external runtime
imports, symlinked modules and unexpected dependency packages. This prevents an
owner import from silently turning into public JavaScript. Expanding that boundary
requires a reviewed policy/source change.

Only PATH, NODE_ENV and CI reach the compiler subprocess: application database,
cloud identity, NODE_OPTIONS and VITE_* variables are excluded. This minimizes
inputs; it is not an OS sandbox or protection against compromised compiler
dependencies. CI has read-only repository access and no cloud credentials.

## Artifact and verification

`builds/build-<sha256>/` contains:

- `release/`: one exact independently verified approved release, including data,
  public-only semantic model and upstream licenses. No older release is copied.
- `site/`: the public HTML, hashed JS/CSS and module profile. No owner entry points,
  source maps, legacy graph or original source tree are copied.
- `runtime/public-server.mjs`: a standalone server using Node's built-in modules.
- `build-manifest.json`: source commit/input hashes, approved release identity,
  file hashes/sizes and build time. `deployed` remains false.

The theme bootstrap becomes an external hashed script. There is no inline script
exception in the server CSP. Inline styles remain allowed for the graph's dynamic
layout; external connections, scripts, frames, forms, workers and objects are
restricted by the fixed policy.

The independent Python verifier checks the original approved projection contract,
all file identities, public module profile, registered HTML assets, no inline
scripts/handlers/refresh/frames, runtime source provenance, symlinks and byte/file
limits. It rejects contract-invalid content even when an attacker recomputes
hashes. Maximum artifact content is 25 MB and 250 files. Source hashes and build
IDs are integrity/provenance metadata, **not signatures or proof of publisher
authorization**. Trust in approved source/build identity and future immutable image
digests remains a deployment requirement.

Only after verification does the builder install its immutable build directory and
atomically replace `current.json`. Failed validation or compilation retains the
current pointer. Concurrent filesystem edits by an untrusted output-directory
owner are outside the threat model; operator ownership is required. Full
filesystem power-loss durability has not been established. An acknowledgement or
I/O failure can occur after pointer replacement: inspect `current` before retrying
rather than assuming a failed command restored the old pointer. The CLI never
prints compiler errors, private paths, environment values or payload text.

## Runtime

From the exact build directory, run:

```sh
PORT=8080 node runtime/public-server.mjs
```

The runtime verifies build/release hashes and the file inventory before binding.
The Python build verifier supplies the full projection/semantic/HTML contract;
runtime checks protect the bytes it produced, not a newly invented publication
authorization boundary. It preloads at most the bounded artifact into memory and
serves a fixed route map. Requests cannot select filesystem paths. The process
never reads owner schemas, a database URL, storage credentials or private files.

It listens on `0.0.0.0:$PORT`, following the [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).
Cloud Run terminates HTTPS upstream; this local runtime speaks HTTP. Hosting it
directly on an unprotected public interface is not the prepared deployment design.
It permits GET/HEAD, refuses request bodies and mutations, does not issue cookies
or CORS grants, and sets CSP, HSTS, nosniff, frame/referrer/permissions and same-origin
resource headers. Responses use `no-store`; actual CDN invalidation and withdrawal
still require the deployment integration.

There is a 600-request/minute budget per instance, 32-connection cap, 8 KiB header
limit and five-second request/header/idle timeouts. Live/ready health probes are
exempt from the request budget and report verified local availability, not current
database publication freshness. SIGTERM gets a bounded drain. Structured logs
contain method class, route class, status and duration, without URLs, query values,
record IDs, headers or response bodies. Public runtime artifacts contain only
already-approved data; logs remain operational information, not publication inputs.

## Tests and remaining release gates

`uv run --no-sync python scripts/test_public_site.py` builds an actual synthetic
approved export, compiles/verifies the site, tests real HTTP and opens it in owned
headless Chrome. No API interception or production authentication bypass is used
for this public pipeline. The script requires a clean input checkout, free local
loopback ports and Chrome. It temporarily appends known synthetic probes to its
public entry and restores it; run it in an isolated checkout. It refuses to replace
a preexisting environment file and retains concurrently changed source for
inspection. The normal CI job provides that isolated checkout.

Checks cover public-only assets, accidental owner imports, environment/publicDir
exclusion, startup refusal after tampering, headers, method/body/path denial, safe
logs, request limits, source citations, theme bootstrap under CSP, project/record
navigation and mobile layout. Python contracts separately exercise rehashed
malicious additions, private release files, forged profiles, symlinks and last-good
preservation. Existing owner/browser and PostgreSQL/graph checks remain required.

Next delivery work remains explicit: package this exact verified directory in a
reviewed non-root immutable container with a pinned/scanned base; inspect a complete
GCP plan; configure scoped build/deploy identity and runtime resources; revalidate
current approved heads before deploy; implement scheduled jobs, withdrawal/cache
handling, rollback and measured restore. The anonymous runtime must receive no
database IAM or credentials. An older retained artifact cannot be republished
without checking whether its research has since been withdrawn. No billable
resources, cloud permissions or deployment are created by this builder.

Human security/AppSec review of generated public data delivery and runtime controls
remains required before release. The [publication threat model](publication-threat-model.md)
extends to build contamination (high disclosure impact, mitigated by explicit
inputs/module guard and negative tests), artifact tampering (high integrity impact,
mitigated by verification and future trusted immutable image delivery), and public
resource abuse (availability/cost risk, bounded per-instance controls with live
capacity validation pending). No independent review or exception approval is claimed.
