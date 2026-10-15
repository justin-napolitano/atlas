"""Verify retained private source bytes and bounded quote anchors; no fetching."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from islam_research.reader_collection import collection_resource


class VisibleText(HTMLParser):
    def __init__(self):super().__init__();self.items=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in {"script","style"}:self.skip+=1
    def handle_endtag(self,tag):
        if tag in {"script","style"}:self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip:self.items.append(data)


def verify(directory):
    collection=collection_resource();verified=[];web_only=[]
    for source in collection["sources"]:
        evidence=source["evidence"]
        if evidence["method"]=="web_reader_visible_text":web_only.append(source["id"]);continue
        raw=(directory/evidence["filename"]).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=evidence["sha256"]:raise ValueError("Source bytes changed; inspect rather than silently replacing evidence")
        text=raw.decode("utf-8-sig").replace("\r\n","\n").replace("\r","\n")
        if evidence["method"]=="html_visible_text_whitespace_collapsed":
            parser=VisibleText();parser.feed(text);text=" ".join(" ".join(parser.items).split())
        for reading in collection["readings"]:
            if reading["source_id"]==source["id"] and (reading["text"] not in text or reading["exact_anchor"] not in text):
                raise ValueError("Stored quotation not found in retained source representation")
        verified.append(source["id"])
    return {"verified_raw_sources":verified,"web_reader_only_sources":web_only,"interpretations_verified":False,"scholarly_review":"pending"}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--evidence-dir",type=Path,required=True);args=parser.parse_args()
    print(json.dumps(verify(args.evidence_dir),ensure_ascii=False))
