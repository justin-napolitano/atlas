import hashlib
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
import unittest
import uuid
from unittest.mock import patch

from islam_research import shared_library as library


def synthetic_source(db,c,project=None,title='Synthetic research book'):
    project=project or 'library-test:'+uuid.uuid4().hex
    db.create_project(c,project,'Synthetic library project')
    source='synthetic:source:'+uuid.uuid4().hex
    row=db.save_record(c,project_id=project,record_id=source,kind='source',title=title,actor='synthetic')
    return project,source,row


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class SharedLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.sql=db,sql;cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL']
        cls.owner,cls.public='library_owner_'+uuid.uuid4().hex,'library_public_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as c:
            db.migrate(c)
            for role in (cls.owner,cls.public):c.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            c.commit();configure(c,cls.owner,cls.public,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner)
        cls.public_dsn=make_conninfo(cls.dsn,user=cls.public)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as c:
            for role in (cls.owner,cls.public):
                c.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                c.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        from islam_research import passage_store,notebook
        self.passages,self.notebook=passage_store,notebook
        with self.db.connect(self.owner_dsn) as c:
            self.project,self.source,_=synthetic_source(self.db,c)
            self.other='library-test:'+uuid.uuid4().hex;self.db.create_project(c,self.other,'Second synthetic project')
            self.text='😀 An exact é passage.\n\nالتفسير and a second paragraph.'
            self.doc=passage_store.create_document(c,project_id=self.project,source_record_id=self.source,edition='Synthetic translation A',locator='Chapter I',representation_url='',text=self.text,actor='synthetic')
            self.doc2=passage_store.create_document(c,project_id=self.project,source_record_id=self.source,edition='Synthetic translation B',locator='Chapter I',representation_url='',text='A different translation.',actor='synthetic')
            self.annotation=passage_store.create_annotation(c,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.doc['id'],text_sha256=self.doc['text_sha256'],start=0,end=2,exact='😀 ',capture_kind='comment',body='Synthetic passage note',actor='synthetic')
            self.entry=notebook.create(c,request_uuid=str(uuid.uuid4()),project_id=self.project,thought_type='note',title='Synthetic book note',body='**Private synthetic writing**',links=[],record_id=self.source,document_id=self.doc['id'],reading_position=0,actor='synthetic')
            self.request=dict(request_uuid=str(uuid.uuid4()),project_id=self.project,source_record_id=self.source,expected_source_revision=1,actor='synthetic')
            self.indexed=library.index_source(c,**self.request);self.item=self.indexed['item_id']

    def test_project_reuse_has_one_identity_and_original_notes_text_and_revisions(self):
        with self.db.connect(self.owner_dsn) as c:
            before=c.execute('SELECT count(*) AS n FROM research.reading_documents').fetchone()['n']
            membership=library.membership(c,item_id=self.item,project_id=self.other,state='active',expected_revision=0,actor='synthetic')
            retry=library.membership(c,item_id=self.item,project_id=self.other,state='active',expected_revision=0,actor='synthetic')
            self.assertEqual(membership['revision'],retry['revision'])
            target=library.resolve(c,item_id=self.item,project_id=self.other,document_id=self.doc['id'])
            self.assertEqual(target['project_id'],self.project)
            self.assertEqual(target['document_id'],self.doc['id'])
            rows=library.notes(c,self.item,self.other)
            self.assertEqual({r['id'] for r in rows},{self.entry['id'],self.annotation['id']})
            self.assertTrue(all(r['origin_project_id']==self.project for r in rows))
            self.assertEqual(library.get(c,self.item,self.other)['note_count'],2)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.reading_documents').fetchone()['n'],before)
            anchored=self.passages.annotation(c,self.project,self.annotation['id'])
            self.assertTrue(anchored['anchor']['anchored'])
            self.assertEqual(self.passages.get_document(c,self.project,self.doc['id'])['text_body'],self.text)

    def test_index_uuid_retry_freezes_payload_and_never_restores_removed_shelf(self):
        with self.db.connect(self.owner_dsn) as c:
            self.assertTrue(library.index_source(c,**self.request)['replayed'])
            with self.assertRaises(self.db.RevisionConflict):library.index_source(c,**{**self.request,'source_record_id':'another'})
            item=library.get(c,self.item)
            self.assertFalse(item['on_shelf']);self.assertEqual(item['reading_status'],'needs_review')
            saved=library.update_item(c,item_id=self.item,expected_revision=1,on_shelf=True,reading_status='want_to_read',preferred_edition_id=None,actor='synthetic')
            retry=library.update_item(c,item_id=self.item,expected_revision=1,on_shelf=True,reading_status='want_to_read',preferred_edition_id=None,actor='synthetic')
            self.assertEqual(saved['revision'],retry['revision'])
            library.update_item(c,item_id=self.item,expected_revision=2,on_shelf=False,reading_status='want_to_read',preferred_edition_id=None,actor='synthetic')
            library.index_source(c,**{**self.request,'request_uuid':str(uuid.uuid4())})
            self.assertFalse(library.get(c,self.item)['on_shelf'])
            retained=library.update_item(c,item_id=self.item,expected_revision=3,on_shelf=True,reading_status='reading',preferred_edition_id=None,actor='synthetic')
            self.assertGreater(retained['retained_at'],saved['retained_at'])
            with self.assertRaises(self.db.RevisionConflict):library.update_item(c,item_id=self.item,expected_revision=1,on_shelf=True,reading_status='finished',preferred_edition_id=None,actor='synthetic')

    def test_editions_versions_and_unresolved_duplicates_are_not_collapsed(self):
        with self.db.connect(self.owner_dsn) as c:
            editions=library.editions(c,self.item)
            self.assertEqual(len(editions),2)
            first=library.resolve(c,item_id=self.item,document_id=self.doc['id'])
            second=library.resolve(c,item_id=self.item,document_id=self.doc2['id'])
            self.assertNotEqual(first['edition_id'],second['edition_id'])
            self.assertNotEqual(first['representation_id'],second['representation_id'])
            project,source,_=synthetic_source(self.db,c,title='Synthetic research book')
            duplicate=library.index_source(c,request_uuid=str(uuid.uuid4()),project_id=project,source_record_id=source,expected_source_revision=1,actor='synthetic')
            self.assertNotEqual(duplicate['item_id'],self.item)
            self.assertIsNone(library.resolve(c,item_id=duplicate['item_id'],document_id=self.doc['id']))
            with self.assertRaises(ValueError):library.update_item(c,item_id=duplicate['item_id'],expected_revision=1,on_shelf=True,reading_status='reading',preferred_edition_id=editions[0]['id'],actor='synthetic')

    def test_bibliographic_edits_preserve_identity_and_show_current_title(self):
        with self.db.connect(self.owner_dsn) as c:
            self.db.save_record(c,project_id=self.project,record_id=self.source,kind='source',title='Corrected source title',expected_revision=1,actor='synthetic')
            alias=library.source_identity(c,self.project,self.source)
            self.assertEqual(alias['item_id'],self.item)
            self.assertEqual(alias['source_revision'],1)
            self.assertEqual(alias['current_source_revision'],2)
            item=library.get(c,self.item)
            self.assertEqual(item['title'],'Corrected source title')
            self.assertEqual(item['identity_title'],'Synthetic research book')
            listing=library.listing(c,project_id=self.project,retained=False)
            self.assertEqual(next(row for row in listing if row['id']==self.item)['title'],'Corrected source title')

    def test_changed_snapshot_and_newer_notebook_edit_keep_original_identity(self):
        with self.db.connect(self.owner_dsn) as c:
            changed=self.passages.create_document(c,project_id=self.project,source_record_id=self.source,edition='Synthetic translation A',locator='Chapter I',representation_url='',text='A changed upstream body.',actor='synthetic')
            library.index_source(c,**{**self.request,'request_uuid':str(uuid.uuid4())})
            original=library.resolve(c,item_id=self.item,document_id=self.doc['id'])
            newer=library.resolve(c,item_id=self.item,document_id=changed['id'])
            self.assertNotEqual(original['representation_id'],newer['representation_id'])
            self.assertTrue(self.passages.annotation(c,self.project,self.annotation['id'])['anchor']['anchored'])
            entry=self.notebook.get(c,self.project,self.entry['id'])
            self.notebook.update(c,entry_id=entry['id'],project_id=self.project,expected_revision=entry['revision'],thought_type=entry['thought_type'],title=entry['title'],body='Updated once through original authority',links=[],state='active',actor='synthetic')
            projected=next(row for row in library.notes(c,self.item) if row['id']==entry['id'])
            self.assertEqual(projected['revision'],2)
            self.assertEqual(projected['body'],'Updated once through original authority')

    def test_removal_hidden_sources_trash_and_counts_keep_writing(self):
        from islam_research import private_trash
        with self.db.connect(self.owner_dsn) as c:
            library.membership(c,item_id=self.item,project_id=self.other,state='active',expected_revision=0,actor='synthetic')
            library.membership(c,item_id=self.item,project_id=self.other,state='removed',expected_revision=1,actor='synthetic')
            self.assertIsNone(library.get(c,self.item,self.other))
            self.assertEqual(library.notes(c,self.item,self.other),[])
            self.assertEqual(len(library.notes(c,self.item)),2)
            # Quotation-only highlights do not count as written notes.
            self.passages.create_annotation(c,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.doc['id'],text_sha256=self.doc['text_sha256'],start=3,end=5,exact=self.text[3:5],capture_kind='comment',body='',actor='synthetic')
            self.assertEqual(library.get(c,self.item)['note_count'],2)
            private_trash.change(c,project_id=self.project,target_kind='annotation',target_id=self.annotation['id'],target_revision=1,state='trashed',expected_revision=0,actor='synthetic')
            self.assertEqual(library.get(c,self.item)['note_count'],1)
        with self.db.connect(self.dsn) as c:c.execute("UPDATE research.records SET review_state='withdrawn',revision=revision+1 WHERE id=%s",(self.source,))
        with self.db.connect(self.owner_dsn) as c:
            self.assertEqual(library.get(c,self.item)['note_count'],0)
            self.assertEqual(library.resolve(c,item_id=self.item,document_id=self.doc['id'])['target_status'],'source_unavailable')
            self.assertIsNotNone(self.notebook.get(c,self.project,self.entry['id']))

    def test_public_and_runtime_cannot_rewrite_identity_history_or_run_rollback(self):
        from psycopg.errors import InsufficientPrivilege
        from islam_research.library_rollback import rollback
        with self.db.connect(self.public_dsn) as c:
            with self.assertRaises(InsufficientPrivilege):c.execute('SELECT * FROM research.library_items')
        with self.db.connect(self.owner_dsn) as c:
            for query in ['UPDATE research.library_document_bindings SET work_id=work_id','UPDATE research.library_events SET snapshot=snapshot','DELETE FROM research.library_items',"UPDATE research.library_works SET title='changed'",'SELECT research.log_library_event()']:
                with self.subTest(query=query),self.assertRaises(InsufficientPrivilege),c.transaction():c.execute(query)
            with self.assertRaises(PermissionError):rollback(c)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL administrator for upgrade rehearsal')
class SharedLibraryMigrationTests(unittest.TestCase):
    def test_upgrade_rollback_preserves_legacy_bytes_ids_and_logs_and_refuses_owner_activity(self):
        from islam_research import database as db,passage_store,notebook
        from islam_research.library_rollback import rollback,MIGRATION
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        admin_dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];name='library_rehearsal_'+uuid.uuid4().hex
        with db.connect(admin_dsn) as admin:
            admin.autocommit=True;admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        dsn=make_conninfo(admin_dsn,dbname=name)
        try:
            with TemporaryDirectory() as temp:
                root=Path(temp);(root/'migrations').mkdir()
                actual=Path(__file__).parents[1]/'src/islam_research/migrations'
                for path in actual.glob('*.sql'):
                    if path.name<MIGRATION:shutil.copyfile(path,root/'migrations'/path.name)
                with db.connect(dsn) as c:
                    with patch('islam_research.database.files',return_value=root):db.migrate(c)
                    project,source,_=synthetic_source(db,c)
                    doc=passage_store.create_document(c,project_id=project,source_record_id=source,edition='Original é translation',locator='Chapter 1',representation_url='',text='😀 Exact é text.',actor='synthetic')
                    note={'id':'synthetic:legacy-note:'+uuid.uuid4().hex}
                    c.execute("INSERT INTO research.notebook_entries(id,project_id,creation_sha256,record_id,document_id,reading_position,thought_type,title,body,changed_by) VALUES(%s,%s,%s,%s,%s,0,'note','Synthetic original','**Original** Markdown العربية','synthetic')",(note['id'],project,'a'*64,source,doc['id']))
                    db.save_personal_state(c,project_id=project,record_id=source,reading='read',note='Legacy private note',actor='synthetic')
                    tables=('records','record_revisions','reading_documents','notebook_entries','notebook_revisions','personal_states','personal_state_revisions')
                    before={t:c.execute(sql.SQL('SELECT to_jsonb(r) AS row FROM research.{} r ORDER BY to_jsonb(r)::text').format(sql.Identifier(t))).fetchall() for t in tables}
                    shutil.copyfile(actual/MIGRATION,root/'migrations'/MIGRATION)
                    with patch('islam_research.database.files',return_value=root):self.assertEqual(db.migrate(c),[MIGRATION])
                    alias=library.source_identity(c,project,source)
                    # Rehearse exactly schema 0024 using its columns, rather than
                    # a newer projection that requires workspace tombstones.
                    item=c.execute('SELECT * FROM research.library_items WHERE id=%s',(alias['item_id'],)).fetchone()
                    item['legacy_reading_states']=c.execute('SELECT reading FROM research.personal_states WHERE record_id=%s',(source,)).fetchall()
                    self.assertFalse(item['on_shelf']);self.assertEqual(item['reading_status'],'needs_review')
                    self.assertIsNone(item['preferred_edition_id'])
                    self.assertEqual(item['legacy_reading_states'][0]['reading'],'read')
                    self.assertEqual(library.resolve(c,item_id=item['id'],document_id=doc['id'])['text_sha256'],doc['text_sha256'])
                    self.assertEqual(rollback(c,apply=True)['applied'],True)
                    for t in tables:self.assertEqual(c.execute(sql.SQL('SELECT to_jsonb(r) AS row FROM research.{} r ORDER BY to_jsonb(r)::text').format(sql.Identifier(t))).fetchall(),before[t])
                    shutil.copyfile(actual/MIGRATION,root/'migrations'/MIGRATION)
                    with patch('islam_research.database.files',return_value=root):self.assertEqual(db.migrate(c),[MIGRATION])
                    self.assertEqual(library.source_identity(c,project,source)['item_id'],item['id'])
                    library.update_item(c,item_id=item['id'],expected_revision=1,on_shelf=True,reading_status='want_to_read',preferred_edition_id=None,actor='synthetic')
                    with self.assertRaises(ValueError):rollback(c,apply=True)
                    self.assertEqual(c.execute('SELECT body FROM research.notebook_entries WHERE id=%s',(note['id'],)).fetchone()['body'],'**Original** Markdown العربية')
        finally:
            with db.connect(admin_dsn) as admin:
                admin.autocommit=True;admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
