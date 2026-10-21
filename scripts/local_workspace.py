#!/usr/bin/env python3
"""Start the real owner API against a private native PostgreSQL development cluster.

No Docker, cloud resources, IAP bypass flag, fixture API or browser content store.
The production server does not import this local-only launcher.
"""
import argparse
import getpass
import hashlib
import json
import logging
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import threading
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
DEFAULT_STATE = Path.home()/'.local/share/atlas'


def private_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(value,stream);stream.flush();os.fsync(stream.fileno())


def config(state,postgres_bin=None):
    path=state/'local-config.json'
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('Local config must be an owner-private regular file')
    value=json.loads(path.read_text())
    if value.get('format')!='atlas-local-postgres-v1':raise ValueError('Unknown local configuration')
    if not re.fullmatch(r'atlas_research|atlas_restore_[a-f0-9]{32}',value.get('database','atlas_research')):raise ValueError('Unknown local database')
    if postgres_bin is not None:value={**value,'postgres_bin':str(postgres_bin)}
    return value


def admin_dsn(state,value):
    from psycopg.conninfo import make_conninfo
    return make_conninfo(host=str(state/'socket'),port=55432,dbname=value.get('database','atlas_research'),user=value['admin'])


def start_database(state,value):
    binary=Path(value['postgres_bin'])
    running=subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False).returncode==0
    if not running:
        subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'-l',str(state/'postgres.log'),'-w','start'],check=True,stdout=subprocess.DEVNULL)


def initialize(args):
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    from islam_research import database as db
    from islam_research.sql_permissions import configure
    state=args.state_dir.resolve();state.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(state,0o700)
    path=state/'local-config.json'
    if not path.exists():
        if (state/'postgres-data').exists():raise ValueError('Existing unrecognized cluster; refusing initialization')
        value={'format':'atlas-local-postgres-v1','admin':getpass.getuser(),'postgres_bin':str(args.postgres_bin.resolve()),
            'owner_password':secrets.token_urlsafe(48),'publisher_password':secrets.token_urlsafe(48)}
        private_json(path,value)
    value=config(state,args.postgres_bin.resolve());binary=Path(value['postgres_bin'])
    data=state/'postgres-data';socket=state/'socket';socket.mkdir(exist_ok=True,mode=0o700);os.chmod(socket,0o700)
    if not (data/'PG_VERSION').exists():
        subprocess.run([str(binary/'initdb'),'-D',str(data),'--encoding=UTF8','--locale=C','--auth-local=peer','--auth-host=reject','--username='+value['admin']],check=True,stdout=subprocess.DEVNULL)
        with (data/'postgresql.conf').open('a') as stream:
            stream.write("\nlisten_addresses = ''\nport = 55432\nshared_buffers = '32MB'\nmax_connections = 16\nwork_mem = '2MB'\nmaintenance_work_mem = '16MB'\nmax_wal_size = '128MB'\nmin_wal_size = '32MB'\npassword_encryption = 'scram-sha-256'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\nlog_parameter_max_length = 0\nlog_parameter_max_length_on_error = 0\n")
            stream.write("unix_socket_directories = '"+str(socket).replace("'","''")+"'\nunix_socket_permissions = 0700\n")
        (data/'pg_hba.conf').write_text('local all '+value['admin']+' peer\nlocal all all scram-sha-256\n')
    start_database(state,value)
    name=value.get('database','atlas_research')
    with psycopg.connect(make_conninfo(host=str(socket),port=55432,dbname='postgres',user=value['admin']),autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname=%s",(name,)).fetchone():c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        for role,key in [('atlas_owner','owner_password'),('atlas_public','publisher_password')]:
            if not c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(value[key])))
        c.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(name)))
        c.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO atlas_owner,atlas_public').format(sql.Identifier(name)))
    with db.connect(admin_dsn(state,value)) as c:
        migrations=db.migrate(c)
        configure(c,'atlas_owner','atlas_public',apply=True)
    if not (state/'local-session.json').exists():private_json(state/'local-session.json',{'launch':secrets.token_urlsafe(48),'session':secrets.token_urlsafe(48)})
    if not getattr(args,'quiet',False):print(json.dumps({'storage':'native_postgresql','new_migrations':len(migrations),'runtime_role':'atlas_owner','database_network_listener':False}))


def build(args):
    state=args.state_dir.resolve();config(state)
    output=state/'frontend'/str(time.time_ns())
    subprocess.run([sys.executable,str(ROOT/'scripts/build_owner_frontend.py'),'--output',str(output)],cwd=ROOT,check=True)
    manifest=json.loads((output/'owner-manifest.json').read_text())
    for name in ('workspace.html','publish.html'):
        path=output/name
        path.write_text(path.read_text().replace('<head>','<head><meta name="research-storage-mode" content="local-postgres">',1))
        data=path.read_bytes();manifest['files'][name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    (output/'owner-manifest.json').write_text(json.dumps(manifest))
    (state/'current-frontend').write_text(str(output))
    print('Local PostgreSQL frontend built.')


def serve(args):
    import uvicorn
    from psycopg.conninfo import make_conninfo
    from islam_research.local_owner import LocalOwner
    state=args.state_dir.resolve();value=config(state,getattr(args,'postgres_bin',None));start_database(state,value)
    credentials_path=state/'local-session.json'
    if credentials_path.is_symlink() or credentials_path.stat().st_mode & 0o077:raise ValueError('Local session file must be private')
    credentials=json.loads(credentials_path.read_text())
    dsn=make_conninfo(host=str(state/'socket'),port=55432,dbname=value.get('database','atlas_research'),user='atlas_owner',password=value['owner_password'])
    managed=getattr(args,'desktop_managed',False)
    listener=None
    if managed:
        listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        try:listener.bind(('127.0.0.1',args.port))
        except OSError:
            if not args.port:raise
            listener.bind(('127.0.0.1',0))
        listener.listen(16)
        port=listener.getsockname()[1]
    else:port=args.port
    directory=getattr(args,'frontend',None) or Path((state/'current-frontend').read_text())
    artifact_namespace=value.get('artifact_namespace','artifacts')
    if not re.fullmatch(r'artifacts(?:-[a-f0-9]{32})?',artifact_namespace):raise ValueError('Invalid local artifact namespace')
    app=LocalOwner(database_url=dsn,directory=directory,port=port,credentials=credentials,
        desktop_artifact_root=state/artifact_namespace if managed else None)
    logging.basicConfig(level=logging.WARNING,format='%(message)s')
    settings=dict(host='127.0.0.1',port=port,access_log=False,proxy_headers=False,
        workers=1,limit_concurrency=24,backlog=16,server_header=False,log_level='warning',timeout_graceful_shutdown=10)
    if managed:
        server=uvicorn.Server(uvicorn.Config(app,**settings))
        # The desktop owns this pipe. A crash/exit ends only its API, not PostgreSQL.
        def watch_parent():
            try:
                while os.read(sys.stdin.fileno(),1024):pass
            finally:server.should_exit=True
        threading.Thread(target=watch_parent,daemon=True).start()
        # The port is already bound by this child; no shared fixed port is trusted.
        print(json.dumps({'kind':'atlas-local-owner','format':1,'port':port}),flush=True)
        server.run(sockets=[listener])
    else:
        print(f'Persistent local workspace: http://127.0.0.1:{port}/',flush=True)
        uvicorn.run(app,**settings)


def open_browser(args):
    state=args.state_dir.resolve();config(state)
    credentials=json.loads((state/'local-session.json').read_text())
    # Fragment credentials never reach HTTP paths/access logs or the chat transcript.
    webbrowser.open(f'http://127.0.0.1:{args.port}/local/login#'+credentials['launch'])
    print('Opened the private local browser session.')


def import_progress(args):
    """Copy only explicitly selected legacy progress into an unused owner reading state.

    Owner writing is never printed or interpreted. The complete original snapshot
    stays in a private, immutable backup; legacy notes remain in the original app.
    """
    from islam_research import database as db, quran_progress, quran_workspace
    state=args.state_dir.resolve();value=config(state)
    backup=state/'backups'/('legacy-preview-'+str(time.time_ns())+'.json')
    backup.parent.mkdir(exist_ok=True,mode=0o700)
    with args.source.open('rb') as source,os.fdopen(os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as dest:
        shutil.copyfileobj(source,dest)
    if backup.stat().st_size>32*1024*1024:raise ValueError('Preview snapshot requires a bounded migration')
    raw=backup.read_bytes();snapshot=json.loads(raw)
    if snapshot.get('format')!='local-review-demo-v1':raise ValueError('Unsupported preview snapshot')
    progress=[row for _,row in snapshot.get('quranProgress',[]) if row.get('project_id')==args.project]
    places=[row for project,row in snapshot.get('quranPlaces',[]) if project==args.project]
    if len(places)>1:raise ValueError('Ambiguous preview reading place')
    actor='local-preview-progress-import'
    with db.connect(admin_dsn(state,value)) as c:
        if c.execute('SELECT 1 FROM research.workspace_quran_reading_progress LIMIT 1').fetchone() or c.execute('SELECT 1 FROM research.workspace_quran_places LIMIT 1').fetchone():
            raise ValueError('Owner reading state is already in use; explicit reconciliation required')
        for row in progress:
            quran_progress.save(c,project_id=None,chapter=row['chapter'],ayah=row['ayah'],is_read=row['is_read'],expected_revision=0,actor=actor)
        if places:
            place=places[0]
            quran_workspace.save_place(c,project_id=None,resource_key=place['resource_key'],chapter=place['chapter'],ayah=place['ayah'],expected_revision=0,actor=actor)
    os.chmod(backup,0o400)
    private_json(state/'progress-import-receipt.json',{'format':1,'source_sha256':hashlib.sha256(raw).hexdigest(),
        'backup_file':str(backup),'progress_rows':len(progress),'reading_place':bool(places),
        'scope':'reading progress and place only; old notes and original read times remain in the backup and original app'})
    print(json.dumps({'imported_progress_rows':len(progress),'imported_reading_place':bool(places),'original_app_unchanged':True,'legacy_notes_migrated':False}))


def backup_database(args):
    state=args.state_dir.resolve();value=config(state,getattr(args,'postgres_bin',None));start_database(state,value)
    directory=state/'backups';directory.mkdir(exist_ok=True,mode=0o700)
    target=directory/('atlas-postgres-'+str(time.time_ns())+'.dump')
    partial=target.with_suffix('.partial')
    with os.fdopen(os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:
        subprocess.run([str(Path(value['postgres_bin'])/'pg_dump'),'--host',str(state/'socket'),
            '--port','55432','--username',value['admin'],'--dbname','atlas_research',
            '--format=custom','--no-owner','--no-acl'],stdout=stream,check=True)
    partial.rename(target)
    print(json.dumps({'database_backup_created':True,'format':'postgresql_custom','cloud_backup':False}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',type=Path,default=DEFAULT_STATE)
    commands=parser.add_subparsers(dest='command',required=True)
    init=commands.add_parser('init');init.add_argument('--postgres-bin',type=Path,required=True)
    commands.add_parser('build')
    commands.add_parser('backup')
    managed=commands.add_parser('desktop-serve');managed.set_defaults(desktop_managed=True)
    managed.add_argument('--port',type=int,default=0)
    migrate=commands.add_parser('import-progress')
    migrate.add_argument('--source',type=Path,required=True);migrate.add_argument('--project',required=True)
    for name in ('serve','open'):
        item=commands.add_parser(name);item.add_argument('--port',type=int,default=5187)
    args=parser.parse_args()
    port=getattr(args,'port',5187)
    if port not in range(1024,65536) and not (getattr(args,'desktop_managed',False) and port==0):parser.error('Invalid local port')
    try:{'init':initialize,'build':build,'serve':serve,'desktop-serve':serve,'open':open_browser,'import-progress':import_progress,'backup':backup_database}[args.command](args)
    except Exception:
        # Driver exceptions can contain SQL or credentials; never dump operator state.
        parser.exit(1,'Local workspace operation failed. Existing database and preview files were retained.\n')


if __name__=='__main__':main()
