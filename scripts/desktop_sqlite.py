"""Private embedded desktop storage, consistent snapshots and atomic restore."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import time
import uuid

import local_workspace as local
from desktop_storage import private,digest,artifact_root
from islam_research.sqlite.connection import Connection,migrate
from islam_research.sqlite.snapshot import inventory,verify


def config(state):
    path=state/'sqlite-config.json';private(path)
    value=json.loads(path.read_text())
    if value.get('format')!='atlas-local-sqlite-v1' or not re.fullmatch(r'workspace-[a-f0-9]{32}\.sqlite3',value.get('database','')):raise ValueError('Unknown embedded configuration')
    artifact_root(state,value)
    return value


def select(state,value):
    pending=state/('sqlite-config-'+uuid.uuid4().hex+'.partial')
    local.private_json(pending,value);pending.replace(state/'sqlite-config.json')
    fd=os.open(state,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


@contextmanager
def service_lease(state):
    state.mkdir(parents=True,exist_ok=True,mode=0o700);private(state,True)
    descriptor=os.open(state/'sqlite-service.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        private(state/'sqlite-service.lock')
        fcntl.flock(descriptor,fcntl.LOCK_SH)
        yield
    finally:os.close(descriptor)


def bootstrap(args):
    state=args.state_dir;private(state,True)
    if not (state/'sqlite-config.json').exists():
        # A PostgreSQL installation is never silently replaced by an empty DB.
        if (state/'local-config.json').exists():raise ValueError('Verified PostgreSQL migration required')
        value={'format':'atlas-local-sqlite-v1','database':'workspace-'+uuid.uuid4().hex+'.sqlite3'}
        with Connection(state/value['database'],create=True) as connection:migrate(connection)
        select(state,value)
    value=config(state)
    with Connection(state/value['database']) as connection:migrate(connection)
    session=state/'local-session.json'
    if not session.exists():local.private_json(session,{'launch':secrets.token_urlsafe(48),'session':secrets.token_urlsafe(48)})
    private(session)
    backups=state/'backups';backups.mkdir(mode=0o700,exist_ok=True);private(backups,True)
    receipts=list(backups.glob('atlas-sqlite-*.json'))
    if not receipts or time.time()-max(path.stat().st_mtime for path in receipts)>86400:backup(state)


def backup(state):
    value=config(state);directory=state/'backups';directory.mkdir(mode=0o700,exist_ok=True);private(directory,True)
    target=directory/('atlas-sqlite-'+uuid.uuid4().hex+'.dump')
    descriptor=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(descriptor)
    # SQLite's backup API takes a consistent snapshot even while the API writes.
    with Connection(state/value['database']) as source:
        destination=sqlite3.connect(target)
        try:source.raw.backup(destination)
        finally:destination.close()
    from islam_research.desktop_sources import read_artifact,write_artifact
    with Connection(target) as copy:
        copy.guards.check_schema();counts=inventory(copy)
        rows=copy.raw.execute('SELECT DISTINCT sha256,bytes FROM desktop_artifacts').fetchall()
        if len(rows)>4096:raise ValueError('Artifact manifest exceeds supported bound')
        objects=target.with_suffix('.objects');objects.mkdir(mode=0o700)
        artifacts={}
        for row in rows:
            sha,size=row['sha256'],row['bytes'];data=read_artifact(artifact_root(state,value),sha)
            if len(data)!=size:raise ValueError('Artifact size mismatch')
            write_artifact(objects,data);artifacts[sha]=size
        verify(copy,counts)
    with target.open('rb') as stream:os.fsync(stream.fileno())
    local.private_json(target.with_suffix('.json'),{'format':3,'kind':'atlas-local-sqlite-backup','sha256':digest(target),'bytes':target.stat().st_size,'inventory':counts,'artifacts':artifacts,'created_at':time.time()})
    descriptor=os.open(directory,os.O_RDONLY)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)
    return {'backup_created':True,'file':target.name,'cloud_backup':False,'storage':'sqlite'}


def verified_backup(state,archive):
    target=Path(archive)
    if target.is_symlink() or target.resolve().parent!=(state/'backups').resolve():raise ValueError('Select a backup from this Atlas installation')
    private(target);receipt=target.with_suffix('.json');private(receipt)
    if target.stat().st_size>1_073_741_824 or receipt.stat().st_size>1_048_576:raise ValueError('Backup exceeds supported bound')
    value=json.loads(receipt.read_text())
    if value.get('format')!=3 or value.get('kind')!='atlas-local-sqlite-backup' or value.get('bytes')!=target.stat().st_size or value.get('sha256')!=digest(target):raise ValueError('Backup verification failed')
    with Connection(target) as connection:verify(connection,value['inventory'])
    artifacts=value.get('artifacts')
    if not isinstance(artifacts,dict) or len(artifacts)>4096:raise ValueError('Invalid artifact manifest')
    from islam_research.desktop_sources import read_artifact
    objects=target.with_suffix('.objects');private(objects,True)
    for sha,size in artifacts.items():
        if type(size) is not int or len(read_artifact(objects,sha))!=size:raise ValueError('Artifact verification failed')
    with Connection(target) as connection:
        actual={row['sha256']:row['bytes'] for row in connection.raw.execute('SELECT DISTINCT sha256,bytes FROM desktop_artifacts')}
        if actual!=artifacts:raise ValueError('Artifact manifest differs from snapshot')
    return target,value


def restore(state,archive):
    target,receipt=verified_backup(state,archive)
    # Selection changes only while no owner API is alive. The native host stops
    # its child first; concurrent hosts keep a shared lease and block restore.
    descriptor=os.open(state/'sqlite-service.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        backup(state)
        value={**config(state),'database':'workspace-'+uuid.uuid4().hex+'.sqlite3','artifact_namespace':'artifacts-'+uuid.uuid4().hex}
        destination=state/value['database']
        with os.fdopen(os.open(destination,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as output,target.open('rb') as source:
            shutil.copyfileobj(source,output);output.flush();os.fsync(output.fileno())
        from islam_research.desktop_sources import read_artifact,write_artifact,private_root
        root=private_root(artifact_root(state,value))
        for sha in receipt['artifacts']:write_artifact(root,read_artifact(target.with_suffix('.objects'),sha))
        with Connection(destination) as connection:verify(connection,receipt['inventory'])
        select(state,value)
    finally:os.close(descriptor)
    return {'restored':True,'original_database_retained':True,'cloud_sync':False,'storage':'sqlite'}
