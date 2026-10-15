"""Explicit migration/import commands. A connection URL is read only from the environment."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from islam_research import database as db


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    project = sub.add_parser("create-project")
    project.add_argument("id")
    project.add_argument("title")
    intake = sub.add_parser("import-turtle")
    intake.add_argument("project_id")
    intake.add_argument("path", type=Path)
    intake.add_argument("--actor", required=True)
    intake.add_argument("--apply", action="store_true", help="Apply after inspecting the default dry-run report")
    args = parser.parse_args()
    dsn = os.environ.get("RESEARCH_DATABASE_URL")
    if not dsn:
        parser.error("Set RESEARCH_DATABASE_URL through your local/managed environment")
    try:
        with db.connect(dsn) as connection:
            if args.command == "migrate":
                print(json.dumps({"applied": db.migrate(connection)}))
            elif args.command == "create-project":
                row = db.create_project(connection, args.id, args.title)
                print(json.dumps({"id": row["id"], "graph_authority": row["graph_authority"]}))
            else:
                from islam_research.database_import import import_turtle
                print(json.dumps(import_turtle(connection, args.path, args.project_id, actor=args.actor, dry_run=not args.apply)))
    except (ValueError, db.RevisionConflict) as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        # Connection errors may contain credentials or private network details.
        print("Database operation failed; inspect configuration and service health without logging secrets", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
