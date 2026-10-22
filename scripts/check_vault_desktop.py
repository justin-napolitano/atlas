"""Native vault acceptance with fresh PostgreSQL and a Python-only fake GitHub.

No owner database/session files, actual vault or GitHub credentials are accessed.
"""
import argparse
import json
import logging
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'src'),str(ROOT/'tests')]


def main():
    import uvicorn
    from psycopg.conninfo import make_conninfo
    from islam_research import database as db,workspace_store as workspace,notebook
    from islam_research.local_owner import LocalOwner
    from test_vault_connection import FakeGitHub
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend',type=Path,required=True)
    parser.add_argument('--sync',action='store_true')
    parser.add_argument('--tasks',action='store_true')
    parser.add_argument('--properties',action='store_true')
    parser.add_argument('--toc',action='store_true')
    parser.add_argument('--artifacts',type=Path,default=ROOT/'research-library/testing/vault-connection')
    args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True,mode=0o700)
    logging.disable(logging.CRITICAL)
    binary=ROOT/'research-library/desktop-resources/postgres/bin'
    with tempfile.TemporaryDirectory(prefix='atlas-vault-review-',dir='/private/tmp') as temp:
        root=Path(temp);socket_dir=root/'socket';socket_dir.mkdir(mode=0o700);data=root/'pg'
        subprocess.run([str(binary/'initdb'),'-D',str(data),'-A','trust','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        subprocess.run([str(binary/'pg_ctl'),'-D',str(data),'-l',str(root/'pg.log'),'-o',f"-k {socket_dir} -p 55441 -c listen_addresses=''",'-w','start'],check=True,stdout=subprocess.DEVNULL)
        server=thread=None
        try:
            dsn=make_conninfo(host=str(socket_dir),port=55441,dbname='postgres')
            with db.connect(dsn) as c:
                db.migrate(c)
                note=workspace.create_note(c,request_uuid=str(uuid.uuid4()),body='Synthetic eligible note\n\nPrivate synthetic text',actor='synthetic')
                project='synthetic:legacy';db.create_project(c,project,'Synthetic legacy')
                notebook.create(c,project_id=project,request_uuid=str(uuid.uuid4()),thought_type='note',title='Synthetic legacy note',body='Synthetic legacy context',links=[],actor='synthetic')
            listener=socket.socket();listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
            credentials={key:secrets.token_urlsafe(48) for key in ('launch','session')};remote=FakeGitHub()
            if args.tasks:
                from test_vault_tasks import FakeIssues
                remote=FakeIssues()
            elif args.sync:
                from test_vault_sync import FakeVault
                remote=FakeVault()
            app=LocalOwner(database_url=dsn,directory=args.frontend,port=port,credentials=credentials,desktop_artifact_root=root/'objects',desktop_github=remote)
            server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='critical',lifespan='off'))
            thread=threading.Thread(target=lambda:server.run(sockets=[listener]),daemon=True);thread.start()
            for _ in range(100):
                if server.started:break
                time.sleep(.05)
            assert server.started
            config=root/'review.json';receipt=root/'result.json'
            config.write_text(json.dumps(dict(origin=f'http://127.0.0.1:{port}',credentials=credentials,screenshots=str(args.artifacts.resolve()),resultFile=str(receipt),sync=args.sync,tasks=args.tasks,propertiesOnly=args.properties,tocOnly=args.toc)));config.chmod(0o600)
            result=subprocess.run([str(ROOT/'desktop/node_modules/.bin/electron'),str(ROOT/('desktop/scripts/review-skills-flow.cjs' if args.properties or args.toc else 'desktop/scripts/review-vault-flow.cjs'))],env={**os.environ,'ATLAS_ELECTRON_TEST_CONFIG':str(config)},capture_output=True,timeout=180)
            if result.returncode and (root/'electron-failure.txt').exists():raise AssertionError((root/'electron-failure.txt').read_text())
            assert result.returncode==0 and all(json.loads(receipt.read_text()).values())
            if not (args.properties or args.toc):assert remote.calls
            if args.sync:
                from islam_research.vault_format import paths
                assert remote.posts==1 and remote.files[paths(note['id'])[1]]==note['body'].encode()
            elif not args.tasks:assert all(not options for _,options in remote.calls)
            if args.tasks:assert remote.issue_posts==1
            with db.connect(dsn) as c:
                current=workspace.note(c,note['id']);assert current['body']==note['body'] and current['revision']==note['revision']
            (args.artifacts/'receipt.json').write_text(json.dumps({**json.loads(receipt.read_text()),'onlyReviewedSyntheticMutation':bool(args.sync),'noRemoteMutations':not args.sync,'notesUnchanged':True,'ownerDataAccessed':False}))
            print('Native vault journey passed; owner data and actual GitHub were not accessed.')
        finally:
            if server:server.should_exit=True
            if thread:thread.join(10)
            subprocess.run([str(binary/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)


if __name__=='__main__':main()
