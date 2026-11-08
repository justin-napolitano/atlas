# Personal research experience

Atlas keeps the notebook, collections, general source reader and Gutenberg library
in one workspace. Library and Notebook remain the primary navigation; Continue,
Questions and Explore remain under Research. Connection maps are optional disclosures
beside the explained connections rather than a replacement for them.

## Writing and recovery

The editor remains the existing CodeMirror document/session authority, preserving
exact Markdown, Unicode, IME composition, undo and mounted working surfaces. `Saved`
means that the exact note body and metadata have been acknowledged. `Recovery copy
saved · note not yet saved` only confirms the separate recovery payload. Failed or
conflicting saves remain visible and retain the existing exact retry/comparison flow.

Use Note properties to inspect revision history. Expand a revision to inspect its
exact body, then choose **Use this writing as a new revision**. This is disabled
while current writing is unresolved. The action submits the inspected body through
the existing revision-guarded session; it retains the current note identity,
relationships and source anchor. It does not rewind the database or delete history.

## Properties and search

Frontmatter supports custom string types, tags, aliases and unknown fields without
reserializing the Markdown. Known research types retain their existing classification;
a custom type such as `essay` stays in the document without changing source provenance
or adding an unsupported API thought type.

The main search accepts `type:essay tag:reading`, `alias:"Close reading"`, and
`property.status:"in progress"`. Values match frontmatter strings or list members,
case-insensitively. Invalid/unfinished frontmatter never matches a property filter.
Ordinary prose search keeps its existing cross-research scope. Property queries use
the existing notebook endpoint and inspect one page at a time; **Check more notes**
continues until all pages are checked. The result text identifies that bounded scope.
Property searches are not offered as saved views because the current saved-view
contract cannot represent these filters.

## Links and exports

Saved notes offer **Copy stable link** from properties. The link contains the note ID
and drops transient search/context parameters. **Export current Markdown** downloads
the exact current editor body, including unsaved writing and frontmatter.

Saved source reading details offer **Copy link to this place**, binding the source,
document version, exact annotation when selected, and code-point reading position.
Catalog browsing continues to use Gutenberg's existing version/place flow; it does
not expose a source link to an unsaved virtual source. **Export saved reading text**
downloads the exact saved text, while the existing edition, attribution and source
notices remain available in the reader. Existing JSON-LD annotation export remains.

## Synthetic verification

Run `npm test --prefix web`, `npm run build --prefix web`, and
`node web/scripts/review-workspace.mjs`. The workspace browser fixture starts empty
and exercises exact Unicode/frontmatter writing, custom-type classification isolation,
revision inspection/restoration, property search, reopening and 390px layout. The
existing `review-margin-writing.mjs` and `review-gutenberg.mjs` exercise reader anchors,
writing and place retention using isolated synthetic material.

These checks do not establish native desktop acceptance, hosted recovery, live owner
data compatibility or deployment readiness. No owner database, API service or provider
content is needed for the synthetic checks.
