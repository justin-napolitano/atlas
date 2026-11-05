"""Extract two unchanged verse strings from a pinned official Tanzil download.

Offline only. Keep the complete upstream download in ignored research-library/.
The resulting bounded resource contains attribution and the full source notice.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path

from islam_research.quran_citations import AYAH_COUNTS, PROFILE_ID

SOURCE_SHA256="bf4f57b968d03f4131c070b1e285da9be0e0a108a21c910e872801ca273312c8"
SOURCE_URL="https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true"
PILOT=((4,59),(4,83))


def extract(raw,accessed_on):
    date.fromisoformat(accessed_on)
    if hashlib.sha256(raw).hexdigest()!=SOURCE_SHA256:
        raise ValueError("Upstream bytes changed; review the resource/version before updating the pin")
    decoded=raw.decode("utf-8")
    verses={};observed=[];notice=[]
    for line in decoded.splitlines(keepends=True):
        if line.startswith("#"):
            notice.append(line)
        elif line.strip():
            chapter,ayah,text=line.rstrip("\r\n").split("|",2)
            key=(int(chapter),int(ayah));observed.append(key)
            if key in verses: raise ValueError("Duplicate upstream reference")
            verses[key]=text
    expected=[(chapter,ayah) for chapter,count in enumerate(AYAH_COUNTS,1) for ayah in range(1,count+1)]
    if observed!=expected or "Uthmani, Version 1.1" not in "".join(notice):
        raise ValueError("Upstream structure or declared version does not match the pinned profile")
    rows=[dict(chapter=c,ayah_start=a,ayah_end=a,text=verses[c,a],text_sha256=hashlib.sha256(verses[c,a].encode()).hexdigest()) for c,a in PILOT]
    if any(not row["text"] or len(row["text"])>500 for row in rows):
        raise ValueError("Pilot verse does not fit one exact passage capture")
    return {"format_version":1,"resource_id":"urn:research:quran-resource:tanzil-uthmani-1.1:"+SOURCE_SHA256,
        "label":"Tanzil Uthmani digital text, Version 1.1","publisher":"Tanzil Project","language_tag":"ar","script_tag":"Arab",
        "declared_version":"1.1","text_type":"Uthmani","reading_note":"No qira’ah or manuscript/critical-edition alignment is inferred by this import.",
        "profile_id":PROFILE_ID,"source_url":SOURCE_URL,"source_sha256":SOURCE_SHA256,"accessed_on":accessed_on,
        "attribution_url":"https://tanzil.net/","license_label":"Creative Commons Attribution 3.0 with the upstream verbatim-copy terms",
        "license_url":"https://tanzil.net/docs/text_license","source_notice":"".join(notice),
        "review_limit":"Exact extraction from the identified provider bytes; no independent scholarly review of text, edition, interpretation or commentary coverage.",
        "verses":rows}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input",type=Path)
    parser.add_argument("--accessed-on",required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    value=extract(args.input.read_bytes(),args.accessed_on)
    args.output.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"source_sha256":value["source_sha256"],"verses":[f"{v['chapter']}:{v['ayah_start']}" for v in value["verses"]]}))


if __name__=="__main__": main()
