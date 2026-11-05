#!/usr/bin/env python3
"""Check or apply owner-workspace rollback with an externally injected migration DSN."""
import argparse
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from islam_research import database
from islam_research.workspace_rollback import rollback

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        with database.connect(os.environ['RESEARCH_MIGRATION_DATABASE_URL']) as c:result=rollback(c,apply=args.apply)
        print(json.dumps(result))
    except Exception as error:
        print(f'Workspace rollback refused ({type(error).__name__}); inspect migration ownership, exact artifact and retained activity without printing private payloads.',file=sys.stderr)
        raise SystemExit(1)
