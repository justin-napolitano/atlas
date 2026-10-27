#!/usr/bin/env python3
"""Frozen offline owner service. No checkout, interpreter or network bootstrap."""
import argparse
from pathlib import Path
import sys

import local_workspace as local
import desktop_storage as storage


def resources():
    # Frozen executable is resources/runtime/atlas-service/atlas-service.
    return Path(sys.executable).resolve().parent.parent.parent if getattr(sys,'frozen',False) else Path(__file__).resolve().parents[1]/'research-library/desktop-resources'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--archive',type=Path)
    parser.add_argument('command',choices=['serve','backup','restore'])
    args=parser.parse_args()
    if args.port!=0 and not 1024<=args.port<=65535:parser.error('Invalid local port')
    root=resources();args.postgres_bin=root/'postgres/bin';args.frontend=root/'frontend'
    args.desktop_managed=True;args.quiet=True
    try:
        with storage.service_lease(args.state_dir,args.postgres_bin,shutdown=args.command=='serve'):
            storage.bootstrap(args)
            if args.command=='backup':
                import json
                print(json.dumps(storage.backup(args.state_dir,args.postgres_bin)),flush=True)
            elif args.command=='restore':
                import json
                print(json.dumps(storage.restore(args.state_dir,args.postgres_bin,args.archive)),flush=True)
            else:local.serve(args)
    except Exception:
        # Credentials and owner content must never enter native logs or errors.
        parser.exit(1,'Atlas could not start its private local storage. Existing research is unchanged.\n')


if __name__=='__main__':main()
