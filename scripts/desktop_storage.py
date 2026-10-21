"""Local offline boot, snapshot backups and non-destructive restore."""
import hashlib
from importlib.resources import files
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import time
import uuid

import local_workspace as local


def artifact_root(state,value):
    namespace=value.get('artifact_namespace','artifacts')
    if not re.fullmatch(r'artifacts(?:-[a-f0-9]{32})?',namespace):raise ValueError('Invalid artifact namespace')
    return state/namespace


def snapshot_artifacts(connection,state,value,directory):
    from islam_research.desktop_sources import read_artifact,write_artifact
    if not connection.execute("SELECT to_regclass('research.desktop_artifacts')").fetchone()[0]:return {}
    rows=connection.execute('SELECT DISTINCT sha256,bytes FROM research.desktop_artifacts ORDER BY sha256').fetchall()
    if len(rows)>4096:raise ValueError('Artifact archive needs a larger reviewed manifest')
    manifest={}
    for sha,size in rows:
        data=read_artifact(artifact_root(state,value),sha)
        if len(data)!=size:raise ValueError('Artifact size mismatch')
        write_artifact(directory,data);manifest[sha]=size
    return manifest


def private(path,directory=False):
    info=path.lstat()
    if (info.st_uid!=os.getuid() or info.st_mode&0o077 or
            not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))):
        raise ValueError('Private local storage required')


def database_counts(connection):
    from psycopg import sql
    return {name:connection.execute(sql.SQL('SELECT count(*) FROM research.{}').format(sql.Identifier(name))).fetchone()[0]
        for name, in connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='research' ORDER BY tablename").fetchall()}


def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def backup(state,binary):
    import psycopg
    value=local.config(state,binary);directory=state/'backups'
    directory.mkdir(mode=0o700,exist_ok=True);private(directory,True)
    name='atlas-desktop-'+uuid.uuid4().hex+'.dump';target=directory/name
    partial=target.with_suffix('.partial')
    with psycopg.connect(local.admin_dsn(state,value),autocommit=True) as c:
        c.execute('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        snapshot=c.execute('SELECT pg_export_snapshot()').fetchone()[0]
        counts=database_counts(c)
        objects=target.with_suffix('.objects');objects.mkdir(mode=0o700)
        # The immutable objects referenced by this DB snapshot cannot be deleted.
        # Uncommitted/orphan objects are deliberately excluded from the archive.
        artifacts=snapshot_artifacts(c,state,value,objects)
        with os.fdopen(os.open(partial,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as stream:
            subprocess.run([str(binary/'pg_dump'),'--host',str(state/'socket'),'--port','55432',
                '--username',value['admin'],'--dbname',value.get('database','atlas_research'),
                '--snapshot',snapshot,'--format=custom','--no-owner','--no-acl'],stdout=stream,stderr=subprocess.DEVNULL,check=True)
            stream.flush();os.fsync(stream.fileno())
    partial.rename(target)
    local.private_json(target.with_suffix('.json'),{'format':2,'kind':'atlas-local-backup','postgres_major':17,
        'sha256':digest(target),'bytes':target.stat().st_size,'counts':counts,'artifacts':artifacts,'created_at':time.time()})
    return {'backup_created':True,'file':name,'cloud_backup':False}


def verified_backup(state,archive):
    target=Path(archive)
    if target.is_symlink() or target.resolve().parent!=(state/'backups').resolve():raise ValueError('Select a backup created by this Atlas installation')
    private(target);receipt=target.with_suffix('.json');private(receipt)
    if target.stat().st_size>1_073_741_824 or receipt.stat().st_size>1_048_576:raise ValueError('Backup exceeds supported size')
    value=json.loads(receipt.read_text())
    if (value.get('format') not in {1,2} or value.get('kind')!='atlas-local-backup' or value.get('postgres_major')!=17
            or value.get('bytes')!=target.stat().st_size or value.get('sha256')!=digest(target)
            or not isinstance(value.get('counts'),dict)):raise ValueError('Backup verification failed')
    if value['format']==1:
        if value['counts'].get('desktop_artifacts',0):raise ValueError('Legacy snapshot cannot contain external artifacts')
    else:
        from islam_research.desktop_sources import read_artifact
        artifacts=value.get('artifacts')
        if not isinstance(artifacts,dict) or len(artifacts)>4096:raise ValueError('Invalid artifact manifest')
        objects=target.with_suffix('.objects');private(objects,True)
        for sha,size in artifacts.items():
            if type(size) is not int or len(read_artifact(objects,sha))!=size:raise ValueError('Artifact verification failed')
    return target,value


def restore(state,binary,archive):
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    from islam_research import database as db
    from islam_research.sql_permissions import configure
    target,receipt=verified_backup(state,archive);value=local.config(state,binary)
    # Preserve the current state and the original database before selecting another.
    backup(state,binary)
    name='atlas_restore_'+uuid.uuid4().hex
    with psycopg.connect(make_conninfo(local.admin_dsn(state,value),dbname='postgres'),autocommit=True) as c:
        c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        c.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(name)))
        c.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO atlas_owner,atlas_public').format(sql.Identifier(name)))
    subprocess.run([str(binary/'pg_restore'),'--host',str(state/'socket'),'--port','55432','--username',value['admin'],
        '--dbname',name,'--no-owner','--no-acl','--exit-on-error',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
    namespace='artifacts-'+uuid.uuid4().hex
    selected={**value,'database':name,'artifact_namespace':namespace}
    from islam_research.desktop_sources import read_artifact,write_artifact,private_root
    restored_root=private_root(state/namespace)
    for sha in receipt.get('artifacts',{}):write_artifact(restored_root,read_artifact(target.with_suffix('.objects'),sha))
    with psycopg.connect(local.admin_dsn(state,selected)) as c:
        if database_counts(c)!=receipt['counts']:raise ValueError('Restored record counts did not match the snapshot')
        if c.execute("SELECT to_regclass('research.desktop_artifacts')").fetchone()[0]:
            rows=c.execute('SELECT DISTINCT sha256,bytes FROM research.desktop_artifacts').fetchall()
            if dict(rows)!=receipt.get('artifacts',{}):raise ValueError('Restored artifact manifest did not match the database')
    with db.connect(local.admin_dsn(state,selected)) as c:
        db.migrate(c)
        # --no-acl excludes old machine/role grants. PostgreSQL otherwise gives
        # restored functions default PUBLIC EXECUTE; restore the original deny
        # boundary before applying and auditing the explicit runtime grant plan.
        c.execute('REVOKE ALL ON SCHEMA research,research_public FROM PUBLIC')
        c.execute('REVOKE ALL ON ALL TABLES IN SCHEMA research,research_public FROM PUBLIC')
        c.execute('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA research,research_public FROM PUBLIC')
        c.execute('REVOKE ALL ON ALL SEQUENCES IN SCHEMA research,research_public FROM PUBLIC')
        configure(c,'atlas_owner','atlas_public',apply=True)
    # Commit selection only after all checks. Neither original nor failed DB is deleted.
    pending=state/('config-'+uuid.uuid4().hex+'.partial')
    local.private_json(pending,selected);pending.replace(state/'local-config.json')
    return {'restored':True,'original_database_retained':True,'cloud_sync':False}


def bootstrap(args):
    import psycopg
    state=args.state_dir
    if state.exists():private(state,True)
    for name in ['postgres-data','socket','backups']:
        if (state/name).exists() or (state/name).is_symlink():private(state/name,True)
    new=not (state/'local-config.json').exists()
    major=state/'postgres-data/PG_VERSION'
    if major.exists() and major.read_text().strip()!='17':raise ValueError('A reviewed PostgreSQL major upgrade is required')
    if not new and major.exists():
        private(state/'local-config.json');private(state/'local-session.json')
        value=local.config(state,args.postgres_bin);local.start_database(state,value)
        with psycopg.connect(local.admin_dsn(state,value)) as c:
            known={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files('islam_research').joinpath('migrations').iterdir() if p.name.endswith('.sql')}
            applied=dict(c.execute('SELECT name,sha256 FROM research.schema_migrations').fetchall())
            if any(known.get(k)!=v for k,v in applied.items()):raise ValueError('Database requires a newer or reviewed application')
        if set(known)-set(applied):backup(state,args.postgres_bin)
    local.initialize(args)
    if new:local.private_json(state/'desktop-owned-cluster.json',{'format':1})
    # Keep daily recovery points outside the replaceable application bundle.
    backups=list((state/'backups').glob('atlas-desktop-*.json')) if (state/'backups').exists() else []
    if not backups or time.time()-max(p.stat().st_mtime for p in backups)>86400:backup(state,args.postgres_bin)


def stop_owned(state,binary):
    # Earlier browser workspaces have no marker and must remain running.
    if not (state/'desktop-owned-cluster.json').exists():return
    import psycopg
    value=local.config(state,binary)
    with psycopg.connect(local.admin_dsn(state,value)) as c:
        others=c.execute('SELECT count(*) FROM pg_stat_activity WHERE datname IS NOT NULL AND pid<>pg_backend_pid()').fetchone()[0]
    if not others:subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
