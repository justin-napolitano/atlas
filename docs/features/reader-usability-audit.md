# Reading workspace audit and repair

Reference: [Quran.com reading](https://quran.com/4/59), its
[customization guide](https://quran.com/tr/explore/build-your-personalized-quran-experience),
and the user's three screenshots. Focus: reading first, reachable controls, and
source-to-notes continuity. This is an improvement of the existing app, not a
clone or a new source authority.

## Captured flow and findings

1. **Quran.com reference — healthy reading hierarchy.** The captured live verse
   view places reading text, context and study tools close together. Source:
   `01-quran-reference.png` in the local audit artifacts. Its help guide describes
   independent Arabic/translation sizes, reading views and light/dark/sepia.
2. **Existing full workspace — broken sizing, excessive preamble.** At 1440px,
   actual article text began at y=601.625. The full app computed 24.48px before
   and after clicking Increase, while its counter changed. Screenshot:
   `02-workspace-before.png`; control state: `03-size-control-before-fix.png`.
   Higher-specificity fixed font sizes in atlasWorkspace.css overrode reading
   preferences on desktop and mobile. The isolated component harness missed it.
3. **Repaired full workspace — functional and more direct.** The same bounded
   article starts at y=414.8125. Actual source sizing changes 22px to 24px, and
   zoom changes actual glyph layout, not just a stored preference. Screenshot:
   `04-workspace-after.png`; controls: `05-working-size-control.png`.

Before artifacts (ignored local evidence):
`research-workspace-artifacts-gcge0q` in the system temporary directory.
After artifacts: `research-workspace-artifacts-zjtANh` in that directory.
These screenshots were opened and inspected during this run. They are not public
research artifacts or material to republish with the corpus.

## Changes

- Remove workspace-level fixed reading size/spacing, leaving the reader's bounded
  preferences as the typography authority.
- Plain Smaller/Larger buttons show effective rendered pixel size; Text & page
  includes a direct reading-size slider. Range tracks/thumbs have explicit,
  contrasting styling. Notes and library actions describe what they affect.
- Compact the source title, remove the duplicate excerpt preamble, move annotation
  access into the reading toolbar and research actions after the text. Continuous
  reading uses the outer reading surface rather than an extra source scroll box.
- Remove oversized empty-sidebar instructions; retain its direct note composer.
- Preserve source bytes, Unicode selection, note anchors, edition/review metadata,
  private/public boundaries and existing autosave/recovery.

## Verification and limits

The full compiled workspace browser test now checks default sizing, a real size
button, 180% zoom, actual glyph-bound height growth, source text integrity, mobile
CSS behavior, and reset. It loads the production app's full stylesheet cascade.
Existing reading, highlighting, notebooks, publication and mobile checks remain.
The separate component suite continues to cover Markdown, notes and appearance.
Screenshots alone do not establish accessibility compliance. Functional checks
cover keyboard/zoom/reflow behavior; owner reading review remains useful.
