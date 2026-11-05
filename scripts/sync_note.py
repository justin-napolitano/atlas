#!/usr/bin/env python3
"""Explicit Obsidian/Markdown note pull, push, and revision-aware resolution."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "src"))
from islam_research.note_sync import OwnerHTTP, SyncProblem, transfer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction",choices=["pull","push"])
    parser.add_argument("file",type=Path)
    parser.add_argument("--record-id")
    parser.add_argument("--project-id")
    parser.add_argument("--apply",action="store_true",help="Apply the displayed transfer; default only previews")
    parser.add_argument("--resolve",choices=["cloud","draft"])
    parser.add_argument("--expected-remote-revision",type=int)
    args = parser.parse_args()
    try:
        api = OwnerHTTP(os.environ.get("RESEARCH_OWNER_ORIGIN",""),os.environ.get("RESEARCH_IAP_ID_TOKEN",""))
        result = transfer(api,args.file,args.direction,apply=args.apply,record_id=args.record_id,project_id=args.project_id,
                          resolution=args.resolve,expected_remote_revision=args.expected_remote_revision)
        print(json.dumps(result))
        return 2 if result["status"] == "conflict" else 0
    except (ValueError, OSError, KeyError, TypeError, SyncProblem) as error:
        print(f"Note transfer failed ({type(error).__name__}); retain your draft and verify format, identity, and revision. A lost response can follow a committed save; retry to reconcile it.",file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
