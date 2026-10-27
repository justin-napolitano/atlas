"""Embedded-store behavior. PostgreSQL's independent contract suite stays intact."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import uuid
import sys
try:import sqlglot
except ModuleNotFoundError:raise unittest.SkipTest('Install the desktop-sqlite extra for embedded-store tests')

from islam_research import database as db,workspace_store as workspace,quran_progress,passage_store,desktop_pages,desktop_folders
from islam_research.sqlite.connection import Connection,migrate
from islam_research.sqlite.store import SQLiteStore


class SQLiteStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='atlas-sqlite-test-')
        self.path=Path(self.temp.name)/('workspace-'+uuid.uuid4().hex+'.sqlite3')
        self.c=Connection(self.path,create=True);migrate(self.c)
    def tearDown(self):self.c.close();self.temp.cleanup()
    def note(self,body='## Synthetic العربية 😀',**values):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body=body,actor='synthetic-owner',**values)
    def source(self):
        return db.save_record(self.c,record_id='synthetic:'+str(uuid.uuid4()),project_id=None,kind='source',title='Synthetic source',actor='synthetic-owner')
    def document(self):
        source=self.source()
        return passage_store.create_document(self.c,project_id=None,source_record_id=source['id'],edition='Synthetic edition',locator='Section 1',representation_url='',text='A synthetic العربية 😀 passage for located notes.',actor='synthetic-owner')

    def test_private_file_schema_and_idempotent_initialization(self):
        self.assertEqual(self.path.stat().st_mode&0o077,0)
        self.assertEqual(migrate(self.c),[])
        self.assertEqual(self.c.raw.execute('PRAGMA journal_mode').fetchone()['journal_mode'],'delete')
        self.assertTrue(SQLiteStore(self.path).ready('owner'))
        self.assertFalse(SQLiteStore(self.path).ready('public'))
    def test_unicode_exact_note_revisions_and_process_reopen(self):
        body='---\ntype: skill\n---\n# Synthetic\n\nالعربية 😀\r\n{"leave":"as Markdown source"}'
        row=self.note(body);self.assertEqual(row['body'],body)
        updated=workspace.update_note(self.c,entry_id=row['id'],expected_revision=1,body=body+'\nAnother line',actor='synthetic-owner')
        self.assertEqual(updated['revision'],2)
        self.assertEqual([r['snapshot']['body'] for r in self.c.execute('SELECT snapshot FROM research.notebook_revisions WHERE entry_id=%s ORDER BY revision',(row['id'],))],[body,body+'\nAnother line'])
        with Connection(self.path) as reopened:self.assertEqual(workspace.note(reopened,row['id'])['body'],body+'\nAnother line')
    def test_two_writers_preserve_compare_and_swap(self):
        row=self.note()
        def write(body):
            with db.connect('sqlite:'+str(self.path)) as connection:
                try:workspace.update_note(connection,entry_id=row['id'],expected_revision=1,body=body,actor='synthetic-owner');return 'saved'
                except db.RevisionConflict:return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertCountEqual(list(pool.map(write,['First','Second'])),['saved','conflict'])
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.notebook_revisions WHERE entry_id=%s',(row['id'],)).fetchone()['n'],2)
    def test_uncertain_create_replays_one_identity(self):
        request=str(uuid.uuid4())
        first=workspace.create_note(self.c,request_uuid=request,body='Synthetic retry',actor='synthetic-owner')
        second=workspace.create_note(self.c,request_uuid=request,body='Synthetic retry',actor='synthetic-owner')
        self.assertEqual(first['id'],second['id']);self.assertEqual(second['revision'],1)
        with self.assertRaises(db.RevisionConflict):workspace.create_note(self.c,request_uuid=request,body='Different retry',actor='synthetic-owner')
    def test_reading_snapshot_and_exact_selector_stay_immutable(self):
        document=self.document();text=document['text_body'];start=text.index('العربية');end=start+len('العربية')
        payload=dict(annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=document['id'],start=start,end=end,text_sha256=document['text_sha256'],exact=text[start:end],body='Synthetic observation',capture_kind='comment',actor='synthetic-owner')
        annotation=passage_store.create_annotation(self.c,**payload)
        self.assertEqual(annotation['exact'],'العربية')
        with self.assertRaises(db.psycopg.errors.CheckViolation):
            with self.c.transaction():self.c.execute('UPDATE research.reading_documents SET text_body=%s WHERE id=%s',('Altered',document['id']))
        with self.assertRaises(db.psycopg.errors.CheckViolation):
            with self.c.transaction():self.c.execute('UPDATE research.reading_annotations SET exact=%s,revision=revision+1 WHERE id=%s',('Different',annotation['id']))
    def test_progress_is_revisioned_and_not_scholarly_review(self):
        first=quran_progress.save(self.c,project_id=None,chapter=4,ayah=59,is_read=True,expected_revision=0,actor='synthetic-owner')
        replay=quran_progress.save(self.c,project_id=None,chapter=4,ayah=59,is_read=True,expected_revision=0,actor='synthetic-owner')
        self.assertEqual(first['revision'],replay['revision']);self.assertIsNotNone(first['read_at'])
        unread=quran_progress.save(self.c,project_id=None,chapter=4,ayah=59,is_read=False,expected_revision=1,actor='synthetic-owner')
        self.assertFalse(unread['is_read']);self.assertIsNone(unread['read_at'])
    def test_trash_protects_writing_and_restore_keeps_body(self):
        row=self.note('Synthetic retained body')
        trash=workspace.trash(self.c,entry_id=row['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic-owner')
        with self.assertRaises(ValueError):workspace.update_note(self.c,entry_id=row['id'],expected_revision=1,body='Overwrite',actor='synthetic-owner')
        workspace.trash(self.c,entry_id=row['id'],target_revision=1,expected_revision=trash['revision'],state='active',actor='synthetic-owner')
        self.assertEqual(workspace.note(self.c,row['id'])['body'],'Synthetic retained body')
    def test_bound_parameters_keep_literal_percent_and_sql_text_inert(self):
        value="Synthetic %s '); DROP TABLE records; -- العربية"
        row=self.note(value)
        self.assertEqual(workspace.note(self.c,row['id'])['body'],value)
        result=self.c.execute("WITH x AS (SELECT %s AS value) SELECT value,%s AS other,'literal%s' AS text FROM x",('first','second')).fetchone()
        self.assertEqual(result,{'value':'first','other':'second','text':'literal%s'})
    def test_schema_tampering_and_symlinked_files_are_rejected(self):
        link=self.path.parent/'linked.sqlite3';link.symlink_to(self.path)
        with self.assertRaises(OSError):Connection(link)
        self.c.raw.execute('DROP TRIGGER atlas_records_update_before')
        with self.assertRaises(db.psycopg.errors.CheckViolation):migrate(self.c)
    def test_backup_restore_keeps_original_and_rejects_live_service_and_tampering(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
        import desktop_sqlite as embedded
        state=self.path.parent
        embedded.select(state,{'format':'atlas-local-sqlite-v1','database':self.path.name})
        row=self.note('Synthetic exact recovery العربية 😀')
        archive=state/'backups'/embedded.backup(state)['file']
        workspace.update_note(self.c,entry_id=row['id'],expected_revision=1,body='Synthetic later revision',actor='synthetic-owner')
        with embedded.service_lease(state):
            with self.assertRaises(BlockingIOError):embedded.restore(state,archive)
        embedded.restore(state,archive)
        selected=embedded.config(state)
        self.assertNotEqual(selected['database'],self.path.name)
        self.assertTrue(self.path.exists())
        with Connection(state/selected['database']) as recovered:self.assertEqual(workspace.note(recovered,row['id'])['body'],row['body'])
        with archive.open('ab') as stream:stream.write(b'tampered')
        with self.assertRaises(ValueError):embedded.restore(state,archive)
        self.assertEqual(embedded.config(state),selected)
    def test_native_lexical_search_preserves_scope_and_reports_its_method(self):
        from islam_research.sqlite.search import search
        project='synthetic:'+str(uuid.uuid4());db.create_project(self.c,project,'Synthetic search')
        source=db.save_record(self.c,record_id='synthetic:'+str(uuid.uuid4()),project_id=project,kind='source',title='Synthetic العربية',summary='Exact lexical source',actor='synthetic-owner')
        result=search(self.c,project,'العربية','records',None,10)
        self.assertEqual(result['items'][0]['id'],source['id'])
        self.assertEqual(result['method'],'sqlite_fts5_unicode61_v1')
        self.assertEqual(search(self.c,'foreign-project','العربية','all',None,10)['items'],[])


if __name__=='__main__':unittest.main()
