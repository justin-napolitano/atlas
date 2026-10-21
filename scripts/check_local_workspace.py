#!/usr/bin/env python3
"""Exercise real local HTTP/SQL persistence in an isolated disposable database.

Does not read owner note bodies or write synthetic notes into the owner's database.
"""
import argparse
import json
import logging
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import uuid
import tempfile
import subprocess
import os

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from local_workspace import config,admin_dsn,DEFAULT_STATE


def main():
    import httpx
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    import uvicorn
    from islam_research import database as db
    from islam_research.sql_permissions import configure
    from islam_research.local_owner import LocalOwner
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--state-dir',type=Path,default=DEFAULT_STATE)
    parser.add_argument('--electron',action='store_true',help='Also verify the native Electron renderer against this isolated database')
    args=parser.parse_args();state=args.state_dir.resolve();value=config(state)
    name='atlas_smoke_'+uuid.uuid4().hex
    admin=make_conninfo(admin_dsn(state,value),dbname='postgres')
    logging.disable(logging.CRITICAL)
    with psycopg.connect(admin,autocommit=True) as c:
        c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    server=thread=None
    try:
        with db.connect(make_conninfo(admin_dsn(state,value),dbname=name)) as c:
            db.migrate(c);configure(c,'atlas_owner','atlas_public',apply=True)
        dsn=make_conninfo(host=str(state/'socket'),port=55432,dbname=name,user='atlas_owner',password=value['owner_password'])
        credentials={key:secrets.token_urlsafe(48) for key in ('launch','session')}
        directory=Path((state/'current-frontend').read_text())
        def start():
            nonlocal server,thread
            listener=socket.socket();listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
            app=LocalOwner(database_url=dsn,directory=directory,port=port,credentials=credentials)
            server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='critical',lifespan='off'))
            thread=threading.Thread(target=lambda:server.run(sockets=[listener]),daemon=True);thread.start()
            for _ in range(100):
                if server.started:break
                time.sleep(.05)
            assert server.started
            origin=f'http://127.0.0.1:{port}'
            client=httpx.Client(base_url=origin,headers={'Origin':origin,'X-Research-Write':'1'},timeout=20)
            assert client.get('/v1/me').status_code==401
            assert client.post('/local/session',json={'token':credentials['launch']}).status_code==200
            assert client.get('/v1/me').status_code==200
            return client
        def stop():
            server.should_exit=True;thread.join(10);assert not thread.is_alive()
        client=start()
        payload={'request_uuid':str(uuid.uuid4()),'body':'Synthetic durable note العربية 😀','owner_confirmed':True}
        response=client.post('/v1/workspace/notes',json=payload);assert response.status_code==201,response.status_code
        note=response.json();assert note['body']==payload['body']
        assert client.post('/v1/workspace/notes',json=payload).json()['id']==note['id']
        assert client.put('/v1/quran/progress',json={'chapter':4,'ayah':59,'is_read':True,'expected_revision':0,'owner_confirmed':True}).status_code==200
        assert client.put('/v1/quran/place',json={'resource_key':'itani-god','chapter':4,'ayah':59,'expected_revision':0,'owner_confirmed':True}).status_code==200
        result=client.post('/v1/quran/notes',json={'resource_key':'itani-god','chapter':4,'ayah_start':59,'ayah_end':59,
            'request_uuid':str(uuid.uuid4()),'body':'Synthetic located margin note.','owner_confirmed':True})
        assert result.status_code==201,result.status_code
        margin=result.json()['note']
        shelf=client.get('/v1/library/shelf');assert shelf.status_code==200
        assert shelf.json()['items'], 'The real source note retains its library book'
        # Retention is not permission to guess an edition. Select the exact saved
        # document, just as the reader's explicit Save to library action does.
        item=shelf.json()['items'][0]
        target=client.get('/v1/library/resolve',params={'item_id':item['id'],'document_id':result.json()['binding']['document']['id']}).json()
        selected=client.put('/v1/library/item',json={'item_id':item['id'],'expected_revision':item['revision'],
            'on_shelf':True,'reading_status':'reading','preferred_edition_id':target['edition_id'],'owner_confirmed':True})
        assert selected.status_code==200
        if args.electron:
            with tempfile.TemporaryDirectory(prefix='atlas-electron-check-') as temporary:
                base=Path(temporary);config_path=base/'runtime.json';result_file=base/'result.json'
                config_path.write_text(json.dumps({'origin':str(client.base_url).rstrip('/'),'credentials':credentials,'resultFile':str(result_file)}));config_path.chmod(0o600)
                env={**os.environ,'ATLAS_ELECTRON_TEST_CONFIG':str(config_path)};env.pop('ELECTRON_RUN_AS_NODE',None)
                result=subprocess.run([str(ROOT/'desktop/node_modules/.bin/electron'),str(ROOT/'desktop/scripts/review-electron.cjs')],cwd=ROOT,env=env,capture_output=True,timeout=90)
                if result.returncode:
                    # Only synthetic fixture diagnostics. No owner database/notes are opened.
                    failure=base/'electron-failure.txt'
                    raise RuntimeError(failure.read_text() if failure.exists() else 'Native Electron review failed')
                assert all(json.loads(result_file.read_text()).values())
                print('Native Electron + isolated PostgreSQL: renderer isolation, dirty close, reload/reopen and offline request boundaries passed.')
        client.close();stop()
        client=start()
        restored=client.get('/v1/workspace/note',params={'entry_id':note['id']})
        assert restored.status_code==200 and restored.json()['body']==payload['body']
        assert client.get('/v1/workspace/note',params={'entry_id':margin['id']}).json()['body']=='Synthetic located margin note.'
        assert client.get('/v1/quran/progress').json()['items'][0]['is_read'] is True
        assert client.get('/v1/quran/place').json()['ayah']==59
        assert client.get('/v1/library/shelf').json()['items'][0]['reader']=='quran'
        assert client.get('/workspace.html').status_code==200
        assert client.put('/v1/quran/place',json={'resource_key':'itani-god','chapter':4,'ayah':60,'expected_revision':0,'owner_confirmed':True}).status_code==409
        client.close();stop();server=None
        print(json.dumps({'real_http_postgresql':True,'isolated_database':True,'verified':['note and frozen retry','located Quran note','library source retention','progress and position','API restart','CAS conflict'],'owner_data_modified':False}))
    finally:
        if server and thread and thread.is_alive():server.should_exit=True;thread.join(10)
        with psycopg.connect(admin,autocommit=True) as c:
            c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__=='__main__':main()
