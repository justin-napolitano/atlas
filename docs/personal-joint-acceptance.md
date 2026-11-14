# Personal Atlas joint acceptance

On 2026-11-08 UTC, the final joint browser fixture passed in **21.88 seconds**
(Go package: **22.114 seconds**). It used disposable PostgreSQL 17.11, verified
synthetic signed JWTs, the real loopback Go bridge, two independent native SQLite
profiles, Playwright 1.64.1 and installed Chromium 1234. No owner workspace,
production credentials, hosted deployment or external source connection was used.

## Tested inputs

- MU checkout: `ad991d0cccc891b48b24b8fde9e8ebd1635ebaf6`, including runtime
  replay-authority regression `4f21c512501410f8241787d14b2fcb01403d733a`.
- Atlas component baseline: `982376cde76220f011e956ffe423b5100efb1c6a`;
  browser scenario commit: `f85bd1f`. The final launcher, app entry and CSS were
  working-tree changes awaiting the integration commit during this run; the
  baseline alone does not identify those changes.
- Final executable SHA-256:
  `4c807f971d4a22215f0d4bffb3e4c9aee7639e1872a5b367d174ed72841f8d3c`.
- Browser scenario SHA-256:
  `f60338d0a07306a8df29a9e3936c7def2954baf974cb507cca5cf5e58db0d226`.
- Built workspace HTML SHA-256:
  `32fe783141d448a5ddb2453f265e6fc17bdc7aeced6ad0d93840f98b190f7980`.
- Go: pinned local 1.26.10 executable; its SHA-256:
  `5742f0004c49c005313d88cd06df964b09cad6bcf2eac4506bdb90abc923b1f4`.

Local review artifacts: `/private/tmp/atlas-final-joint-browser.log`, complete
input checksums `/private/tmp/atlas-final-joint-inputs.sha256`, desktop screenshot
`/private/tmp/atlas-final-joint-browser.png`, mobile screenshot
`/private/tmp/atlas-final-joint-browser.png.mobile.png`, and mobile layout evidence
`/private/tmp/atlas-final-joint-browser.png.layout.json`. These temporary artifacts
are not repository files. The layout check reported width 390, document width
390 and no overflowing elements. Child diagnostics and fixture secrets were
withheld; credentials crossed the fixture's private stdin and trusted Go bridge
boundaries, never browser storage, URLs or test logs.

## Reproduction command

Run from the MU checkout with Go 1.26.10 on `PATH`. Replace the tool and checkout
placeholders with explicitly selected local paths. The command preserves the
tested flags; fixture identities and tokens are generated inside the test.

```sh
set -o pipefail
ATLAS_CHECKOUT=/path/to/atlas
CHROMIUM_EXECUTABLE='/path/to/installed/chromium'
MUTHER_RUN_POSTGRES_TEST=1 \
MUTHER_TEST_RESEARCH=1 \
FATHUR_WORKSPACE_BROWSER_SCRIPT="$ATLAS_CHECKOUT/web/src/federation/workspace.browser.mjs" \
ATLAS_WORKSPACE_BINARY=/path/to/compiled-launcher \
ATLAS_WORKSPACE_ASSETS="$ATLAS_CHECKOUT/web/dist" \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" \
ATLAS_WORKSPACE_SCREENSHOT=/private/tmp/atlas-final-joint-browser.png \
GOTOOLCHAIN=local go test \
  ./internal/storage/postgres -run '^TestRuntimePostgresHTTP$' -count=1 -v \
  2>&1 | tee /private/tmp/atlas-final-joint-browser.log
```

## Accepted scenarios and limits

Notes covered explicit account/brain selection, exact untouched CRLF/Unicode,
lost local-create receipt retry, two-client concurrent edits and reviewed
three-way merge, native undo, IME save deferral, offline local writing and
reconnect, search filters, Markdown archive, attributed history, stable links,
tombstones, revocation with retained pending writing and credential boundaries.

Research covered explicit loading, a shared group and source, exact selected
Unicode source text, source/version/hash-bound passage annotation, private
annotation and reading progress for each actor, absence of the other actor's
private state, and an explicitly shared annotation visible to the second actor.
The fixture also passed narrow-role PostgreSQL, JWT authorization, replay,
conflict, generation preconditions and commit-time rollback checks.

This is synthetic web/Go/PostgreSQL acceptance. It does not establish native
Tauri/Electron acceptance, real SSO, research offline-cache behavior, production
operations, a security audit or hosted deployment approval. The existing owner
e-reader and research workspace were preserved; this run did not operate on
owner data or migrate it into a shared brain.
