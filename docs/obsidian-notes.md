# Revision-aware Markdown and Obsidian notes

The web workspace and Python tools share note format version 1. A private reading note targets one stable research record; its identity comes from frontmatter, so renaming or moving its file does not change its target. Version 1 represents the existing one-personal-state-per-record model. Multiple independent notes per source require a later note-entity migration; duplicate files targeting the same record are concurrent copies, not separate server notes.

The frontmatter is a deliberately strict YAML subset: one JSON-valued field per line, surrounded by `---`, followed by a blank line and the exact Markdown note body. Keep this section intact when editing in Obsidian; property editors that rewrite it into general YAML are not supported yet. Unknown versions, duplicate fields, YAML tags, changed context, oversized notes, and invalid reading states fail validation without pushing. Note content uses LF line endings and a 10,000-character limit.

Fields include version, stable record/project IDs, last confirmed server revision, SHA-256 of the base note/reading/screening state, current reading/screening values, and a citation-context snapshot. Context retains available title, source URLs, citation, edition, passage locator, explicit question links, and review limitations. Unknown editions stay unknown. Its checksum detects accidental context edits: note sync cannot silently change scholarly citations or graph assertions. Markdown links in your prose remain prose; they do not automatically become evidenced graph edges.

## One-file pull and push

Export from the owner web workspace, then edit that Markdown file in your vault. Alternatively, seed a file from the hosted app using exact IDs:

```sh
python scripts/sync_note.py pull '/path/to/vault/Source.md' \
  --record-id 'urn:example:source' --project-id 'urn:example:project'
```

This previews the transfer. Add `--apply` to create/update the file. For an existing file its frontmatter supplies the IDs:

```sh
python scripts/sync_note.py pull '/path/to/vault/Source.md' --apply
python scripts/sync_note.py push '/path/to/vault/Source.md'
python scripts/sync_note.py push '/path/to/vault/Source.md' --apply
```

Pull preserves local edits. Push uses compare-and-swap against the recorded revision. Unchanged retries do not create new revisions, and a lost successful response can be reconciled when cloud and local content agree. Before replacing differing content, the tool preserves a private `.research-previous-<hash>.md` copy. Cloud conflicts produce a `.research-cloud-<hash>.md` copy and leave the local draft intact. Exclude these preserved copies from any future batch sync selection.

Inspect both versions. Resolving requires the exact cloud revision you reviewed:

```sh
python scripts/sync_note.py push '/path/to/vault/Source.md' \
  --resolve draft --expected-remote-revision 7 --apply
python scripts/sync_note.py pull '/path/to/vault/Source.md' \
  --resolve cloud --expected-remote-revision 7 --apply
```

Those are alternative choices. Another intervening cloud write conflicts again. Local edits made during a sync are checked before replacement; avoid simultaneous editor saves during the short file-write window because Obsidian does not share an atomic file compare-and-swap protocol. File writes are atomic, initial creation refuses to replace a newly appeared file, and symbolic note paths are refused. Preserved copies and server revision history support recovery. A removed research record leaves its local note intact and disables push; local file deletion never deletes the cloud note. A later pull can recreate it.

This is **explicit one-file synchronization**, not a background vault watcher or a complete vault reconciliation service. Bulk discovery, durable sync cursors, multiple notes, tombstone reconciliation, a full deletion-recovery UI, and richer domain note types remain #40 work. Ordinary Markdown export works independently of this CLI and of any vault.

## Credentials and deployment

Set `RESEARCH_OWNER_ORIGIN` to the exact HTTPS owner origin and provide a short-lived user ID token through `RESEARCH_IAP_ID_TOKEN` in the calling environment. Never put tokens, refresh tokens, OAuth credentials, or these environment files in notes, frontmatter, exports, Git, or command arguments. The client sends the token only as an Authorization header, refuses redirects, bounds responses/timeouts, and does not print response bodies or credentials. It never fabricates the backend's IAP assertion header.

The owner must be configured for programmatic IAP access. Google's [programmatic authentication guide](https://docs.cloud.google.com/iap/docs/authentication-howto) describes a desktop OAuth client/allowlist and user ID-token flow; the default Google-managed OAuth client does not support that human-user flow. A service-account identity is not interchangeable with the application's configured sole human owner. No OAuth registration, token storage/refresh daemon, cloud deployment, or anonymous/agent permission is created here. Live authentication remains a deployment gate.

Tests cover app→file→app with real PostgreSQL and signed test identities, byte-identical browser/Python exports, offline changes, renames, unknown IDs, tombstones, conflicts, late concurrent writes, explicit resolution, lost responses, token boundaries, and inert parsing. Agent search sees a pushed note through the same live private note index. Sync never publishes notes or modifies research review status.
