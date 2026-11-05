"""Generate deterministic API contracts without loading credentials or connecting to storage."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from islam_research.api import Settings, create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "docs/api-contracts")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for mode in ("owner", "public"):
        settings = Settings("synthetic-offline-schema-only", mode=mode, owner_subject="synthetic-owner",
                            iap_audience="/projects/123456789012/locations/us-central1/services/synthetic-owner",
                            owner_origin="https://research.example.invalid")
        text = json.dumps(create_app(settings).openapi(), ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        path = args.output_dir / f"{mode}.openapi.json"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                print(f"API contract drift: {path.name}", file=sys.stderr)
                return 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    print("API contracts checked" if args.check else "API contracts generated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
