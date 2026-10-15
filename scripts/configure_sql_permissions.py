"""Preview post-migration grants; --apply is an explicit transactional write."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from islam_research import database as db
from islam_research.sql_permissions import configure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-role", required=True)
    parser.add_argument("--publisher-role", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    dsn = os.environ.get("RESEARCH_BOOTSTRAP_DATABASE_URL")
    if not dsn:
        parser.error("Set RESEARCH_BOOTSTRAP_DATABASE_URL outside the repository; never pass credentials as arguments")
    try:
        with db.connect(dsn) as connection:
            statements = configure(connection, args.owner_role, args.publisher_role, apply=args.apply)
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    except Exception:
        # Driver errors can contain connection details or SQL. Keep them private.
        parser.exit(1, "Database permission setup failed; no grant transaction was committed. Inspect private operator diagnostics.\n")
    print(json.dumps({"applied": args.apply, "statements": statements}, indent=2))


if __name__ == "__main__":
    main()
