# Qur’an first; reading structures as needed

Owner priority, 2026-10-17: start with the Qur’an because that is the text being
read now. Gutenberg, Open Library and arXiv remain catalog goals; they do not come
before a useful Qur’an reading session. Extend the platform through real reading
needs rather than building a general reader framework first.

## First reading flow

Open the Qur’an → choose a surah or jump to an ayah → read continuously → write
a note or inspect commentary → continue from the same place.

- Use Quran.com as the interaction reference: readable verse-by-verse content,
  Arabic and a named translation, with related study material available in context.
- Keep a quiet header with the current surah/reference and reading controls. Offer
  compact surah navigation and direct reference entry. Avoid cards and repeated
  source/review labels around every ayah.
- Make Arabic and translation visibility/font sizing independent. Preserve script
  rendering appropriate to the identified text resource. Reflow must not redefine
  verse references or pretend a screen is a numbered mushaf page.
- Proposed English starting preference: Mustafa Khattab’s The Clear Quran, with
  Saheeh International as a comparison option where supported. These are named
  choices, not a universal authoritative English translation. Confirm resource
  access/terms through #19 before including either; do not silently substitute the
  existing historical Rodwell excerpts as the modern reading default.
- Reading has no mandatory source-import form. The first note can establish its
  durable source/resource association through the owner/identity contract.
- Clicking a verse/highlight opens its notes or related commentary in the same
  optional sidebar. Preserve the reading position and unfinished writing. A free
  margin note can attach to the current verse/location without selecting a quote.
- Keep whole-surah/source notes, verse/range notes, and exact selected-text notes
  distinct. Notes on a translation retain that translation’s exact text/version.
- Restore the surah, ayah, reading resource choices, position and open note. Public
  readers cannot write the owner's notes; private writing stays private by default.

## Locators and commentary

Surah/ayah/range is a domain reference independent of the displayed Arabic resource,
translation or tafsir. A displayed quotation also has an immutable resource/version
and verified text selector. Switching translation preserves the domain reference;
it does not relocate an exact highlight onto different wording.

Commentary can address an ayah range. Preserve author, work, language, edition,
coverage and source location; the provider exposes grouped tafsir ranges, so do not
force one commentary entry per verse. Distinguish a scripture citation, discussion,
and an attributed interpretation. Display only actual linked material, with honest
coverage gaps. Showing full reading text is not reviewing the whole Qur’an or
claiming comprehensive tafsir coverage under the scholarly pilot.

The current application supplies bounded Q 4:59/4:83 Arabic and reading excerpts.
It is not a complete continuous Qur’an reader. First prove a complete supported
surah from an identified permitted resource, including direct navigation to 4:59
where available, a durable note, commentary return, and resume. Expand resource
coverage through #19 without fabricating missing verses or source access.

## Reuse a few composable reading patterns

| Pattern | Navigation/location | First use |
| --- | --- | --- |
| Numbered units | Parent unit plus stable numbered subunits/ranges | Surah/ayah now; other numbered texts only with their own domain rules |
| Hierarchical prose | Book/article outline, chapter, section, paragraph | A real prose book or article after the Qur’an flow works |
| Fixed pages | Identified file/edition page plus supported text/region selector | PDF or scanned book when needed; may also have a chapter outline |
| Lines/stanzas | Edition-specific line or stanza identifiers | Add for an actual poetry/drama reading need |

These are useful starting patterns, not an exhaustive taxonomy or four separate
apps. Navigation structure and rendering can combine: a paginated book may also
have chapters, and a numbered text can reflow. Reuse the reader shell, notes,
search, sidebar, safe source identity, recovery and history. Add the smallest real
outline/locator/rendering seam needed by the next text. Keep #92/#104 for later
domain validation; do not build a speculative plugin system or replace current IDs.

## Tracking and acceptance

Build under #45 with provider work #19 and shared sidebar #164. The no-import
catalog contract #168 and stable library identity #101 remain applicable. Defer
general catalog provider slices #170/#169 and paper reading #166 until this core
reading loop is useful.

Verify continuous reading, direct ayah links, next/previous navigation, independent
Arabic/translation typography, keyboard/mobile use, free and exact margin notes,
translation switching, linked commentary/ranges, interrupted save/retry, changed
resource, reload/resume, and public/private isolation. Perform the real owner
reading-session check #146; fixture tests alone do not establish reading quality.

References:
- [Quran.com reading example](https://quran.com/4/59)
- [Quran.com reading settings](https://quran.com/tr/explore/build-your-personalized-quran-experience)
- [Quran Foundation resource fields and grouped tafsir ranges](https://api-docs.quran.com/docs/api/field-reference/)
