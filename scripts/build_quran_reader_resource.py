"""Extract the bounded Arabic reader corpus from the official Tanzil download.

Usage: python3 scripts/build_quran_reader_resource.py /path/to/quran-uthmani.txt
The input is the unmodified Tanzil Uthmani 1.1 txt-2 download. Never guess
missing verses or normalize its Arabic wording.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

EXPECTED_SOURCE_SHA256 = "bf4f57b968d03f4131c070b1e285da9be0e0a108a21c910e872801ca273312c8"
COUNTS = {1: 7, 4: 176}
OUTPUT = Path(__file__).resolve().parents[1] / "src/islam_research/resources/quran-reader-arabic-v1.json"


def build(raw: bytes) -> dict:
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_SOURCE_SHA256:
        raise ValueError("Tanzil download hash differs from the recorded Uthmani 1.1 source")
    source_lines = raw.decode("utf-8").splitlines()
    notice_start = source_lines.index("# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK")
    source_notice = "\n".join(source_lines[notice_start:]).strip()
    groups = {chapter: [] for chapter in COUNTS}
    for line in source_lines:
        if not line or line.startswith("#"):
            continue
        chapter_s, ayah_s, text = line.split("|", 2)
        chapter, ayah = int(chapter_s), int(ayah_s)
        if chapter in groups:
            groups[chapter].append({"ayah": ayah, "text": text,
                                    "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()})
    for chapter, count in COUNTS.items():
        if [row["ayah"] for row in groups[chapter]] != list(range(1, count + 1)):
            raise ValueError(f"Surah {chapter} is incomplete or out of order")
    return {"format_version": 1, "resource_id": f"urn:research:quran-resource:tanzil-uthmani-1.1:{digest}",
            "label": "Tanzil Uthmani digital text, Version 1.1", "publisher": "Tanzil Project",
            "language_tag": "ar", "script_tag": "Arab", "declared_version": "1.1",
            "source_url": "https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true",
            "source_sha256": digest, "license_url": "https://tanzil.net/docs/Text_License",
            "attribution_url": "https://tanzil.net/", "source_notice": source_notice,
            "coverage": {str(k): v for k, v in COUNTS.items()},
            "chapters": {str(k): v for k, v in groups.items()},
            "review_limit": "Provider text extraction and structural checks only; no scholarly edition or interpretation review."}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    OUTPUT.write_text(json.dumps(build(Path(sys.argv[1]).read_bytes()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT)
