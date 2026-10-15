# Owner reading workspace

`web/workspace.html` is a separate React entry for the signed owner's hosted reading work. It uses same-origin `/v1` requests with IAP-managed identity, cookies, and the API's explicit JSON write header. No tokens or private note copies go into localStorage. Theme and pane-size preferences may be stored there. No local-file daemon, browser-only save fallback, or development authentication bypass is included.

The desktop layout has independently scrolling, resizable result and reading panes. Drag the divider, use Left/Right arrows, Home/End, or double-click to reset. On narrow screens it stacks the panes and focuses the selected reader. Project/record IDs are in the URL for bookmarking and browser Back; unsaved drafts remain in memory when switching records/projects within this page. Lists paginate in batches of 50; search is an explicit bounded query with a separately selected private-note scope.

Opening a question shows its recorded claim summaries, located evidence, and sources. Clicking any trail record opens it without leaving the workspace. Citations, locations, scope, and retained review limitations are displayed when present; missing summaries remain missing. The interface does not create findings, infer support, or mark sources reviewed.

Reading progress and Keep/Skip/Read later choices save immediately to PostgreSQL. Notes save with the button or Cmd/Ctrl+Enter. The status changes to saved only after the server acknowledges a revision. Notes typed during an in-flight request cannot be replaced by its older response. Queued explicit saves use the last confirmed revision.

Stale writes show the current cloud note/revision alongside the retained draft. Choosing the cloud version does not write. Choosing the draft explicitly saves against the displayed revision; a later concurrent change can conflict again. Previous committed revisions stay in database history. Network/sign-in failures retain the draft **in this tab**, with retry/export available. A reload/navigation warning protects unsaved work; memory is not an offline durable store. Markdown export includes stable project/record IDs, base revision and state hash, and read-only citation context. The optional connector in `obsidian-notes.md` performs explicit file pull/push; the page does not run a vault watcher or silently import files.

## Hosting prerequisite

The frontend is prepared for a signed-owner host with **both** the workspace and `/v1` API at the same HTTPS origin. The public static application remains separate and anonymous/read-only. Merely opening `workspace.html` on Vercel or the Vite preview does not configure PostgreSQL, IAP, proxy routing, or owner identity. It will show the unavailable/sign-in state rather than silently save somewhere else. Cloud routing, live sign-in, least-privilege roles, restored backups, and cross-device verification remain release gates in #31/#33/#42. Existing local browser screening experiments and discovery queues are not automatically migrated into hosted records.

```sh
cd web
npm ci
npm test
npm run build
node scripts/review-workspace.mjs
```

The last command launches an isolated headless Chrome profile and local built-site preview. It supplies **synthetic API fixtures in the test browser only**, verifies the actual compiled UI, and shuts both processes down. It never creates an app authentication bypass or touches personal Chrome profiles. Set `CHROME_PATH` if Chrome is elsewhere. The report gives paths to desktop/mobile screenshots. CI runs this browser check as well as the controller's asynchronous write/conflict tests; a separate PostgreSQL workflow verifies durable state, authorization, and direct per-record state reads. A deployed identity/DB/browser integration test remains necessary before calling cross-device hosting complete.
