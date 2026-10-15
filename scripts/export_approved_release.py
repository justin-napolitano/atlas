#!/usr/bin/env python3
"""Export or independently verify approved public files; never deploy a site."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("export", "current", "verify"))
    parser.add_argument("--path", type=Path, default=Path("research-library/public-releases"),
                        help="Export/current root, or exact release directory for verify")
    args = parser.parse_args(argv)
    try:
        from islam_research.public_release import current_bundle, verify_bundle
        if args.action == "export":
            from islam_research.public_release_store import export_approved
            dsn = os.environ.get("RESEARCH_PUBLISHER_DATABASE_URL")
            if not dsn:
                print("Set RESEARCH_PUBLISHER_DATABASE_URL through private environment injection.", file=sys.stderr)
                return 2
            directory, identifier = export_approved(dsn, args.path, Path(__file__).resolve().parents[1] / "semantic")
            manifest = verify_bundle(directory, expected_id=identifier)
        elif args.action == "current":
            _, manifest = current_bundle(args.path)
        else:
            manifest = verify_bundle(args.path)
        print(json.dumps({"release_id": manifest["release_id"], "verified": True,
                          "projects": sum(h["status"] == "published" for h in manifest["heads"]),
                          "withdrawn_projects": sum(h["status"] == "withdrawn" for h in manifest["heads"]),
                          "deployed": False}, sort_keys=True))
        return 0
    except Exception as error:
        # Driver errors, validation errors and paths can contain private values.
        # Offline checks require only the semantic extra, not a database driver.
        uncertain = type(error).__name__ == "ActivationUncertain"
        print("Export activation uncertain; verify current before retrying." if uncertain else
              "Public release operation failed; no deployment was attempted.", file=sys.stderr)
        return 3 if uncertain else 1


if __name__ == "__main__":
    raise SystemExit(main())
