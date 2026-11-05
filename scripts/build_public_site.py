#!/usr/bin/env python3
"""Build/verify a public-only artifact. Does not query a database or deploy."""
import argparse
import json
from pathlib import Path
import sys

CHECKOUT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CHECKOUT / "src"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "verify", "current"))
    parser.add_argument("--release", type=Path, help="Exact independently verified approved release directory")
    parser.add_argument("--path", type=Path, default=Path("research-library/public-sites"),
                        help="Output/current root, or exact build directory for verify")
    args = parser.parse_args(argv)
    if args.action == "build" and not args.release:
        parser.error("build requires --release")
    try:
        from islam_research.public_site import build_site, current_site, verify_site
        if args.action == "build":
            _, manifest = build_site(args.release, args.path, CHECKOUT)
        elif args.action == "current":
            _, manifest = current_site(args.path, CHECKOUT)
        else:
            manifest = verify_site(args.path, CHECKOUT)
        print(json.dumps({"build_id": manifest["build_id"], "release_id": manifest["release_id"],
                          "verified": True, "deployed": False}, sort_keys=True))
        return 0
    except Exception:
        print("Public site operation failed; inspect current before retrying. No deployment was attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
