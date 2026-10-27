#!/usr/bin/env python3
"""Move a stopped local Atlas installation to a verified SQLite copy.

Retains the original PostgreSQL database, a PostgreSQL backup and a private
dated migration snapshot. Never prints research, credentials or database DSNs.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import uuid

import local_workspace as local
import desktop_storage as storage
import desktop_sqlite as embedded
import psycopg
from islam_research.sqlite.snapshot import capture_postgres,import_postgres


def migrate_desktop(state,binary):
    state=state.absolute();binary=binary.resolve();storage.private(state,True)
    if (state/'sqlite-config.json').exists():raise ValueError('SQLite is already selected; existing database retained')
    descriptor=os.open(state/'desktop-services.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    started=False
    try:
        storage.private(state/'desktop-services.lock')
        # An open modern owner app/browser holds a shared lease. Refuse to copy
        # around it; the installer must first perform normal guarded app quit.
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        value=local.config(state,binary)
        running=subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
        local.start_database(state,value);started=not running
        backup=storage.backup(state,binary)
        with psycopg.connect(local.admin_dsn(state,value)) as connection:
            connection.execute('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            snapshot=capture_postgres(connection)
        snapshot_path=state/'backups'/('atlas-sqlite-migration-'+uuid.uuid4().hex+'.json')
        local.private_json(snapshot_path,snapshot)
        selected={'format':'atlas-local-sqlite-v1','database':'workspace-'+uuid.uuid4().hex+'.sqlite3','artifact_namespace':value.get('artifact_namespace','artifacts')}
        receipt=import_postgres(snapshot,state/selected['database'])
        # Artifact verification belongs to the same consistent PostgreSQL backup.
        storage.verified_backup(state,state/'backups'/backup['file'])
        local.private_json(state/('sqlite-migration-'+uuid.uuid4().hex+'.json'),{**receipt,'postgres_backup':backup['file'],'snapshot_file':snapshot_path.name,'postgres_retained':True,'cloud_sync':False})
        embedded.select(state,selected)
        return {key:receipt[key] for key in ['verified','tables','rows']}|{'postgres_retained':True,'cloud_sync':False}
    finally:
        if started:subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
        os.close(descriptor)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--postgres-bin',type=Path,required=True,help='Retained PostgreSQL app runtime')
    args=parser.parse_args()
    try:result=migrate_desktop(args.state_dir,args.postgres_bin)
    except Exception:parser.exit(1,'Migration could not be verified. Existing PostgreSQL research and recovery files were retained.\n')
    print(json.dumps(result))


if __name__=='__main__':main()
