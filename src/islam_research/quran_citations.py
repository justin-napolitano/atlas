"""Offline reference proposals from an exact, private captured passage.

Detection establishes neither interpretation nor that a source was reviewed.
Offsets are Unicode code points relative to the unchanged selected quotation.
"""
from __future__ import annotations

import hashlib
from importlib.resources import files
import json
import re


PARSER_VERSION = "quran-candidates-1"
STRUCTURE = json.loads(files("islam_research").joinpath("resources/quran-structure-v1.json").read_text(encoding="utf-8"))
PROFILE_ID = STRUCTURE["profile_id"]
AYAH_COUNTS = tuple(STRUCTURE["ayah_counts"])

# Keep the exact spelling and positions; Python decimal digits include Arabic
# and Persian digits. Never normalize or replace the quoted source text.
_DASH = r"[-–—]"
_ITEM = rf"\d+(?:\s*:\s*\d+)?(?:\s*{_DASH}\s*\d+(?:\s*:\s*\d+)?)?"
_JOIN = r"\s*(?:,\s*(?:and\s+)?|and\s+)"
_LIST = rf"{_ITEM}(?:{_JOIN}{_ITEM})*"
_QURAN = r"(?:Qur[’'ʾʼ‘]?ān|Qur[’'ʾʼ‘]?an|Koran|القرآن|القران)"
_CUE = re.compile(rf"(?<!\w)(?:{_QURAN}|s[uū]ra(?:h|t)?)(?!\w)", re.IGNORECASE)
_NUMERIC = re.compile(
    rf"(?<!\w)(?:Q\.?|{_QURAN})\s*(?P<items>\d+\s*:\s*{_LIST})(?!\w)",
    re.IGNORECASE,
)
_NARRATIVE = re.compile(
    rf"(?<!\w)verses?\s+(?P<items>{_LIST})\s+(?:of|in)\s+"
    r"(?P<chapter_word>chapter|s[uū]ra(?:h|t)?)\s+(?P<chapter>\d+)(?!\w)",
    re.IGNORECASE,
)
_ITEM_RE = re.compile(_ITEM)
_PART = re.compile(r"^(?:(?P<chapter>\d+)\s*:\s*)?(?P<verse>\d+)$")


def reference(chapter: int, start: int, end: int | None = None) -> dict:
    """A local structural identifier, independent of edition or translation."""
    end = start if end is None else end
    if any(type(value) is not int for value in (chapter, start, end)):
        raise ValueError("Reference positions must be integers")
    if not 1 <= chapter <= len(AYAH_COUNTS):
        raise ValueError("Chapter outside the declared structure profile")
    if not 1 <= start <= end <= AYAH_COUNTS[chapter - 1]:
        raise ValueError("Ayah range outside the declared structure profile")
    label = f"Q {chapter}:{start}" + (f"–{end}" if end != start else "")
    return {
        "id": f"urn:research:quran:{PROFILE_ID}:{chapter}:{start}-{end}",
        "profile_id": PROFILE_ID, "chapter": chapter, "ayah_start": start,
        "ayah_end": end, "label": label,
        # A landing link for the first verse, never a coverage/wording claim.
        "start_verse_url": f"https://quran.com/{chapter}/{start}",
    }


def _proposal(text: str, start: int, end: int, kind: str,
              chapter: int, first: int, last: int, cross_chapter: bool) -> dict:
    target = None
    if cross_chapter:
        status, reason = "unsupported", "Cross-chapter ranges require manual resolution"
    else:
        try:
            target = reference(chapter, first, last)
            status, reason = "candidate", "Owner confirmation required"
        except ValueError as error:
            status, reason = "invalid", str(error)
    identity = [PARSER_VERSION, kind, start, end, text[start:end], chapter, first, last, cross_chapter]
    key = hashlib.sha256(json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return {"key": key, "parser_version": PARSER_VERSION, "detector_kind": kind,
            "match_start": start, "match_end": end, "matched_text": text[start:end],
            "status": status, "reason": reason, "reference": target,
            "proposed": {"chapter": chapter, "ayah_start": first, "ayah_end": last},
            "review_status": "unreviewed_reference_candidate"}


def _items(text: str, match: re.Match, kind: str, chapter: int | None) -> list[dict]:
    result = []
    for index, item in enumerate(_ITEM_RE.finditer(match.group("items"))):
        parts = re.split(rf"\s*{_DASH}\s*", item.group(), maxsplit=1)
        first = _PART.fullmatch(parts[0].strip())
        explicit = int(first["chapter"]) if first["chapter"] else None
        chapter = explicit if explicit is not None else chapter
        # Both grammars provide a chapter before a proposal can be emitted.
        assert chapter is not None
        last = _PART.fullmatch(parts[-1].strip())
        final_chapter = int(last["chapter"]) if last["chapter"] else chapter
        start = match.start() if index == 0 else match.start("items") + item.start()
        # Narrative references share their complete phrase as evidence: the
        # chapter follows the verse list. Keys also include each distinct target.
        end = match.start("items") + item.end()
        if kind == "english_narrative":
            start, end = match.span()
        result.append(_proposal(text, start, end, kind, chapter, int(first["verse"]),
                                int(last["verse"]), final_chapter != chapter))
    return result


def detect(text: str) -> dict:
    """Propose explicit references in at most one saved 500-code-point quote.

    Bare '4:59', named-surah-only references, implied references, and other
    languages' narrative syntax are deliberately left for owner mapping.
    """
    if not isinstance(text, str) or len(text) > 500 or "\x00" in text:
        raise ValueError("Expected a captured quotation of at most 500 code points")
    candidates = []
    for match in _NUMERIC.finditer(text):
        candidates.extend(_items(text, match, "explicit_numeric", None))
    for match in _NARRATIVE.finditer(text):
        if _CUE.search(text) or match["chapter_word"].lower() != "chapter":
            candidates.extend(_items(text, match, "english_narrative", int(match["chapter"])))
    candidates.sort(key=lambda row: (row["match_start"], row["match_end"], row["key"]))
    return {"parser_version": PARSER_VERSION, "structure_profile": STRUCTURE,
            "candidates": candidates, "limitations": [
                "Reference detection is a proposal, not scholarly review or an interpretive link.",
                "Bounds use the declared Tanzil metadata profile; wording and edition are not verified.",
                "Bare numbers, named-surah-only references, and implied citations require owner mapping.",
                "English narrative syntax requires a Qur’an or surah cue within the selected quotation.",
            ]}
