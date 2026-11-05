#!/usr/bin/env python3
"""Prepare/verify an approved-only container context; never starts Docker."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify"))
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--path", type=Path, default=Path("research-library/public-container-contexts"))
    args = parser.parse_args(argv)
    if args.action == "prepare" and args.artifact is None: parser.error("prepare requires --artifact")
    try:
        from islam_research.public_container import prepare_context, verify_context
        if args.action == "prepare": _, value = prepare_context(args.artifact, args.path, ROOT)
        else: value = verify_context(args.path, ROOT)
        print(json.dumps({"context_id": value["context_id"], "build_id": value["build_id"], "verified": True, "deployed": False}))
        return 0
    except Exception:
        print("Public container context operation failed; no image or deployment was attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__": raise SystemExit(main())
