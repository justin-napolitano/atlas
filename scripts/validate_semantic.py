"""Validate pinned semantic metadata and profile definitions offline."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from islam_research.semantic import validate_directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / "semantic")
    args = parser.parse_args()
    try:
        result = validate_directory(args.directory)
    except Exception as error:
        print(f"Semantic validation failed ({type(error).__name__}); inspect the local contract files", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
