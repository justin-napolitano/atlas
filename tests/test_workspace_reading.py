import os
import unittest
import uuid
from islam_research import database as db,quran_workspace as quran,quran_progress as progress,passage_store,reading_drafts,reading_desk,private_trash

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class WorkspaceReadingTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def test_native_verse_exact_note_recovery_progress_and_reversible_trash(self):
        before=self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n']
        bound=quran.binding(self.c,project_id=None,resource_key='itani-god',chapter=4,ayah_start=59,ayah_end=59,actor='synthetic')
        self.assertIsNone(bound['project_id']);doc=bound['document']
        self.assertEqual(quran.existing(self.c,project_id=None,resource_key='itani-god',chapter=4,ayah_start=59,ayah_end=59)['document']['id'],doc['id'])
        exact=doc['text_body'][:12]
        mark=passage_store.create_annotation(self.c,annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=doc['id'],text_sha256=doc['text_sha256'],start=0,end=len(exact),exact=exact,capture_kind='comment',body='Synthetic native margin note.',actor='synthetic')
        self.assertEqual(quran.marks(self.c,project_id=None,chapter=4)[0]['id'],mark['id'])
        draft=reading_drafts.save(self.c,draft_uuid=str(uuid.uuid4()),project_id=None,record_id=bound['record_id'],context_kind='annotation',document_id=doc['id'],annotation_id=mark['id'],text_sha256=doc['text_sha256'],start=0,end=len(exact),exact=exact,capture_kind='comment',base_revision=1,body='Unfinished source note.',mark_style='highlight',state='active',expected_revision=0,actor='synthetic')
        self.assertEqual(draft['base_snapshot']['body'],mark['body'])
        state=private_trash.change(self.c,project_id=None,target_kind='annotation',target_id=mark['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        self.assertEqual(state['revision'],1)
        self.assertEqual(passage_store.annotations(self.c,None,doc['id'],'',50),[])
        with self.assertRaises(ValueError):passage_store.update_annotation(self.c,annotation_id=mark['id'],project_id=None,body='Forbidden edit',expected_revision=1,actor='synthetic')
        private_trash.change(self.c,project_id=None,target_kind='annotation',target_id=mark['id'],target_revision=1,expected_revision=1,state='active',actor='synthetic')
        quran.create_note(self.c,project_id=None,resource_key='itani-god',chapter=4,ayah_start=1,ayah_end=1,note_scope='surah',request_uuid=str(uuid.uuid4()),body='Whole surah thought.',actor='synthetic')
        self.assertTrue(quran.notes(self.c,project_id=None,resource_key='itani-god',chapter=4,note_scope='surah'))
        place=quran.place(self.c,None);revision=place['revision'] if place else 0
        moved=quran.save_place(self.c,project_id=None,resource_key='itani-god',chapter=4,ayah=59,expected_revision=revision,actor='synthetic')
        self.assertEqual(moved['ayah'],59)
        desk=reading_desk.get(self.c,None)
        desk=reading_desk.save(self.c,project_id=None,record_id=bound['record_id'],document_id=doc['id'],annotation_id=None,start=3,end=3,expected_revision=desk['revision'] if desk else 0,actor='synthetic')
        self.assertEqual(desk['start_pos'],3)
        old=next((row for row in progress.listing(self.c,None) if row['chapter']==4 and row['ayah']==59),None)
        read=progress.save(self.c,project_id=None,chapter=4,ayah=59,is_read=True,expected_revision=old['revision'] if old else 0,actor='synthetic')
        self.assertTrue(read['is_read']);self.assertIsNone(read['project_id'])
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n'],before)
