#!/usr/bin/env python3
"""Prove a copied frozen bundle with fresh private state, never owner data."""
import argparse
import base64
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time
import uuid

import httpx

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources',type=Path,default=ROOT/'research-library/desktop-resources')
    parser.add_argument('--electron',action='store_true')
    parser.add_argument('--artifacts',type=Path,default=ROOT/'research-library/testing/desktop-sources')
    args=parser.parse_args()
    # Short, private socket path; executable location includes spaces deliberately.
    with tempfile.TemporaryDirectory(prefix='atlas-offline-',dir='/private/tmp') as temporary:
        root=Path(temporary);resources=root/'Copied app resources';state=root/'state'
        shutil.copytree(args.resources,resources,symlinks=True)
        service=resources/'runtime/atlas-service/atlas-service';binary=resources/'postgres/bin'
        env={key:os.environ[key] for key in ['HOME','USER','LOGNAME','TMPDIR'] if key in os.environ}
        env['PATH']='/usr/bin:/bin';child=client=None
        def start():
            nonlocal child,client
            child=subprocess.Popen([str(service),'--state-dir',str(state),'serve'],cwd=root,env=env,
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            assert select.select([child.stdout],[],[],50)[0], 'Frozen startup timed out'
            announcement=json.loads(child.stdout.readline())
            assert announcement['kind']=='atlas-local-owner'
            origin='http://127.0.0.1:'+str(announcement['port'])
            keys=json.loads((state/'local-session.json').read_text())
            client=httpx.Client(base_url=origin,headers={'Origin':origin,'X-Research-Write':'1'},timeout=20)
            for _ in range(100):
                try:
                    if client.post('/local/session',json={'token':keys['launch']}).status_code==200:break
                except httpx.TransportError:pass
                time.sleep(.05)
            assert client.get('/v1/me').status_code==200
            assert client.get('/workspace.html').status_code==200
            return origin,keys
        def stop():
            if client:client.close()
            if child and child.poll() is None:
                child.stdin.close();assert child.wait(timeout=20)==0
        def command(action,archive=None):
            value=subprocess.run([str(service),'--state-dir',str(state),*(['--archive',str(archive)] if archive else []),action],
                cwd=root,env=env,capture_output=True,timeout=60)
            assert value.returncode==0, 'Frozen storage command failed'
            return json.loads(value.stdout)
        try:
            origin,keys=start()
            body='## Frozen standalone Markdown\n\nSynthetic محفوظ 😀'
            payload={'request_uuid':str(uuid.uuid4()),'body':body,'owner_confirmed':True}
            result=client.post('/v1/workspace/notes',json=payload);assert result.status_code==201
            note=result.json();assert note['body']==body
            assert client.post('/v1/workspace/notes',json=payload).json()['id']==note['id']
            for route,fields in [('progress',{'chapter':4,'ayah':59,'is_read':True}),('place',{'resource_key':'itani-god','chapter':4,'ayah':59})]:
                assert client.put('/v1/quran/'+route,json={**fields,'expected_revision':0,'owner_confirmed':True}).status_code==200
            result=client.post('/v1/quran/notes',json={'resource_key':'itani-god','chapter':4,'ayah_start':59,'ayah_end':59,
                'request_uuid':str(uuid.uuid4()),'body':'Synthetic offline located note','owner_confirmed':True})
            assert result.status_code==201
            margin=result.json()
            shelf=client.get('/v1/library/shelf').json();assert shelf['items']
            item=shelf['items'][0]
            target=client.get('/v1/library/resolve',params={'item_id':item['id'],'document_id':margin['binding']['document']['id']}).json()
            assert client.put('/v1/library/item',json={'item_id':item['id'],'expected_revision':item['revision'],'on_shelf':True,
                'reading_status':'reading','preferred_edition_id':target['edition_id'],'owner_confirmed':True}).status_code==200
            if args.electron:
                args.artifacts.mkdir(parents=True,exist_ok=True,mode=0o700)
                config=root/'review.json';receipt=root/'review-result.json'
                config.write_text(json.dumps({'origin':origin,'credentials':keys,'resultFile':str(receipt),'screenshots':str(args.artifacts.resolve())}));config.chmod(0o600)
                result=subprocess.run([str(ROOT/'desktop/node_modules/.bin/electron'),str(ROOT/'desktop/scripts/review-electron.cjs')],
                    env={**os.environ,'ATLAS_ELECTRON_TEST_CONFIG':str(config)},capture_output=True,timeout=90)
                if result.returncode!=0 and (root/'electron-failure.txt').exists():
                    raise AssertionError('Synthetic native review: '+(root/'electron-failure.txt').read_text())
                assert result.returncode==0 and all(json.loads(receipt.read_text()).values()), 'Native copied-bundle review failed'
            assert client.get('/v1/desktop/capabilities').json()['local_sources'] is True
            reference={'request_uuid':str(uuid.uuid4()),'reference':'Synthetic local reference without full text','owner_confirmed':True}
            created=client.post('/v1/desktop/references',json=reference);assert created.status_code==201
            source=created.json()
            assert client.post('/v1/desktop/references',json=reference).json()['record_id']==source['record_id']
            text=b'# Synthetic original\r\n\nA locally retained original.'
            file_request={'request_uuid':str(uuid.uuid4()),'filename':'synthetic-local.md','intent':'source','record_id':source['record_id'],
                'content_base64':base64.b64encode(text).decode(),'rights_basis':'Synthetic authored fixture','owner_confirmed':True}
            retained=client.post('/v1/desktop/files',json=file_request);assert retained.status_code==201
            artifact=retained.json()
            assert client.post('/v1/desktop/files',json=file_request).json()['artifact_id']==artifact['artifact_id']
            assert (state/'artifacts'/artifact['sha256']).read_bytes()==text
            linked=client.post('/v1/workspace/notes',json={'request_uuid':str(uuid.uuid4()),'body':'A source-level thought with no invented selection.',
                'record_id':source['record_id'],'owner_confirmed':True});assert linked.status_code==201
            assert linked.json()['id'] in [r['id'] for r in client.get('/v1/desktop/source/writing',params={'record_id':source['record_id']}).json()['items']]
            snapshot=command('backup');archive=state/'backups'/snapshot['file'];assert archive.is_file()
            backup_receipt=json.loads(archive.with_suffix('.json').read_text())
            assert backup_receipt['format']==2 and backup_receipt['artifacts'][artifact['sha256']]==len(text)
            stop();start()
            assert client.get('/v1/workspace/note',params={'entry_id':note['id']}).json()['body']==body
            changed=client.put('/v1/workspace/note',json={'entry_id':note['id'],'expected_revision':note['revision'],
                'body':'Synthetic later version','owner_confirmed':True});assert changed.status_code==200
            stale=client.put('/v1/workspace/note',json={'entry_id':note['id'],'expected_revision':note['revision'],
                'body':'Conflicting synthetic version','owner_confirmed':True});assert stale.status_code==409
            stop()
            assert command('restore',archive)['original_database_retained'] is True
            start()
            assert client.get('/v1/workspace/note',params={'entry_id':note['id']}).json()['body']==body
            selected_config=json.loads((state/'local-config.json').read_text())
            assert (state/selected_config['artifact_namespace']/artifact['sha256']).read_bytes()==text
            assert client.post('/v1/desktop/files',json=file_request).json()['replayed'] is True
            assert client.get('/v1/library/shelf').json()['items']
            assert client.get('/v1/quran/place').json()['ayah']==59
            assert len([row for row in client.get('/v1/quran/progress').json()['items'] if row['is_read']])==1
            selected=json.loads((state/'local-config.json').read_text())['database']
            stop()
            # An incomplete object archive fails before changing selected state.
            object_path=archive.with_suffix('.objects')/artifact['sha256'];original=object_path.read_bytes();object_path.write_bytes(b'corrupt')
            bad=subprocess.run([str(service),'--state-dir',str(state),'--archive',str(archive),'restore'],cwd=root,env=env,capture_output=True,timeout=60)
            assert bad.returncode!=0 and json.loads((state/'local-config.json').read_text())['database']==selected
            object_path.write_bytes(original)
            # Tampering never selects a different database or erases research.
            with archive.open('ab') as stream:stream.write(b'tamper')
            bad=subprocess.run([str(service),'--state-dir',str(state),'--archive',str(archive),'restore'],cwd=root,env=env,capture_output=True,timeout=60)
            assert bad.returncode!=0
            assert json.loads((state/'local-config.json').read_text())['database']==selected
            for file in ['local-config.json','local-session.json']:
                assert (state/file).stat().st_mode&0o077==0
            print(json.dumps({'copied_bundle':True,'checkout_required':False,'fresh_database':True,'unicode_markdown':True,
                'located_quran_notes':True,'library_and_progress':True,'restart':True,'conflict_rejected':True,
                'consistent_backup_and_restore':True,'original_files_restored':True,'reference_only_notes':True,
                'corrupt_object_restore_rejected':True,'tampered_backup_rejected':True,'native_electron':args.electron,'owner_data_modified':False}))
        finally:
            if client:client.close()
            if child and child.poll() is None:
                child.stdin.close()
                try:child.wait(20)
                except subprocess.TimeoutExpired:child.terminate();child.wait(5)
            # This isolated cluster belongs only to the test, never the owner cluster.
            if (state/'postgres-data/PG_VERSION').exists():
                subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


if __name__=='__main__':main()
