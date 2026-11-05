"""Check/roll back only an unused additive library migration; never runtime DDL."""
import argparse
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from islam_research import database as db
from islam_research.library_rollback import rollback


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',help='Drop only unused additive library tables after checks; defaults to eligibility check')
    args=parser.parse_args()
    dsn=os.environ.get('RESEARCH_MIGRATION_DATABASE_URL')
    if not dsn:parser.error('Configure RESEARCH_MIGRATION_DATABASE_URL for the isolated migration-owner connection')
    try:
        with db.connect(dsn) as c:result=rollback(c,apply=args.apply)
    except (ValueError,PermissionError) as error:
        print(str(error),file=sys.stderr);return 1
    print(json.dumps(result));return 0


if __name__=='__main__':raise SystemExit(main())
