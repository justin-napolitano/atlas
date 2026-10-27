#!/usr/bin/env python3
"""Validate PostgreSQL to SQLite migration with an isolated synthetic cluster."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import uuid

import local_workspace as local
import psycopg
from islam_research import database as db,workspace_store as workspace,quran_progress,passage_store,desktop_sources,desktop_pages,desktop_folders
from islam_research.sqlite.snapshot import capture_postgres,import_postgres
from islam_research.sqlite.connection import Connection


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--postgres-bin',type=Path,required=True)
    args=parser.parse_args();binary=args.postgres_bin.resolve()
    with tempfile.TemporaryDirectory(prefix='atlas-migrate-synthetic-',dir='/private/tmp') as temporary:
        state=Path(temporary)/'state'
        try:
            local.initialize(argparse.Namespace(state_dir=state,postgres_bin=binary,quiet=True))
            dsn=local.admin_dsn(state,local.config(state,binary))
            with db.connect(dsn) as connection:
                source=desktop_sources.reference(connection,request_uuid=str(uuid.uuid4()),reference='Synthetic source',actor='synthetic')
                document=passage_store.create_document(connection,project_id=None,source_record_id=source['record_id'],edition='Synthetic edition',locator='Section 1',representation_url='',text='Synthetic source العربية 😀 for migration.',actor='synthetic')
                annotation=passage_store.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=document['id'],text_sha256=document['text_sha256'],start=17,end=24,exact=document['text_body'][17:24],capture_kind='comment',body='Synthetic annotation',actor='synthetic')
                note=workspace.create_note(connection,request_uuid=str(uuid.uuid4()),body='## Exact\r\n\nالعربية 😀',actor='synthetic',record_id=source['record_id'],document_id=document['id'],annotation_id=annotation['id'])
                workspace.update_note(connection,entry_id=note['id'],expected_revision=1,body=note['body']+'\nRevision 2',actor='synthetic')
                quran_progress.save(connection,project_id=None,chapter=4,ayah=59,is_read=True,expected_revision=0,actor='synthetic')
                folder=desktop_folders.change(connection,request_uuid=str(uuid.uuid4()),title='Synthetic folder',actor='synthetic')
                desktop_pages.move(connection,request_uuid=str(uuid.uuid4()),entry_id=note['id'],folder_id=folder['id'],expected_revision=0,actor='synthetic')
            with psycopg.connect(dsn) as connection:
                connection.execute('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                snapshot=capture_postgres(connection)
            path=state/'verified.sqlite3';receipt=import_postgres(snapshot,path)
            with Connection(path) as connection:
                migrated=workspace.note(connection,note['id'])
                assert migrated['body']==note['body']+'\nRevision 2' and migrated['revision']==2
                assert desktop_pages.context(connection,entry_id=note['id'])['folder_id']==folder['id']
                workspace.update_note(connection,entry_id=note['id'],expected_revision=2,body=migrated['body']+'\nSQLite revision',actor='synthetic')
                assert workspace.note(connection,note['id'])['revision']==3
                assert workspace.search(connection,q='العربية')['items']
            print(json.dumps({key:value for key,value in receipt.items() if key!='inventory'}|{'postgres_preserved':True,'new_sqlite_revision':True,'owner_data_used':False}))
        finally:
            if (state/'postgres-data/PG_VERSION').exists():subprocess.run([str(binary/'pg_ctl'),'-D',str(state/'postgres-data'),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)


if __name__=='__main__':main()
