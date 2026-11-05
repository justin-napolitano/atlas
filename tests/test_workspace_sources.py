import os
import unittest
import uuid
from islam_research import database as db,workspace_store as workspace,passage_store,shared_library
from test_source_intake import payload

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class WorkspaceSourceTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def fields(self,**patch):
        fields=payload(None,identifier='',source_url='',rights_status='permitted_excerpt',rights_basis='Synthetic authored fixture',coverage_scope='selected_passage',excerpt=dict(text='A source العربية 😀 with an exact passage.',edition='Synthetic edition',locator='Paragraph 1',representation_url=''),**patch)
        fields.pop('project_id');fields.pop('owner_confirmed');return fields
    def test_intake_without_project_same_authority_book_notebook_and_trash(self):
        before=self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n']
        fields=self.fields();result=workspace.intake(self.c,**fields)
        self.assertEqual(workspace.intake(self.c,**fields)['record_id'],result['record_id'])
        self.assertIsNone(result['project_id'])
        source=workspace.source(self.c,record_id=result['record_id']);self.assertEqual(source['documents'][0]['id'],result['document_id'])
        document=passage_store.get_document(self.c,None,result['document_id'])
        note=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='My own reading note.',record_id=result['record_id'],document_id=document['id'],reading_position=2,actor='synthetic')
        book=source['library'];self.assertTrue(book['on_shelf'])
        notes=shared_library.notes(self.c,book['item_id']);self.assertEqual(notes[0]['id'],note['id'])
        workspace.trash(self.c,entry_id=note['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        self.assertEqual(shared_library.notes(self.c,book['item_id']),[])
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n'],before)
    def test_native_unicode_annotation_and_intake_replay_after_source_edit(self):
        fields=self.fields();result=workspace.intake(self.c,**fields)
        doc=passage_store.get_document(self.c,None,result['document_id']);start=doc['text_body'].index('العربية');exact='العربية 😀'
        mark=passage_store.create_annotation(self.c,annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=doc['id'],text_sha256=doc['text_sha256'],start=start,end=start+len(exact),exact=exact,capture_kind='comment',body='Exact anchor.',actor='synthetic')
        self.assertEqual(passage_store.annotation(self.c,None,mark['id'])['annotation']['exact'],exact)
        db.save_record(self.c,record_id=result['record_id'],project_id=None,kind='source',title='Corrected source title',actor='synthetic',expected_revision=1)
        self.assertTrue(workspace.intake(self.c,**fields)['replayed'])
        self.assertEqual(workspace.source(self.c,record_id=result['record_id'])['record']['title'],'Corrected source title')

    def test_linked_loose_comment_appears_in_book_notebook_without_changing_anchor(self):
        from islam_research import workspace_graph as graph
        result=workspace.intake(self.c,**self.fields())
        note=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='A thought captured before finding this book.',actor='synthetic')
        graph.create(self.c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='entry',from_id=note['id'],to_kind='record',to_id=result['record_id'],relation='comments_on',rationale='This book speaks to my earlier thought.',attribution='',evidence_annotation_id=None,state='tentative',actor='synthetic')
        source=workspace.source(self.c,record_id=result['record_id'])
        self.assertEqual(shared_library.notes(self.c,source['library']['item_id'])[0]['id'],note['id'])
        self.assertIsNone(workspace.note(self.c,note['id'])['record_id'])
        self.assertIsNone(workspace.note(self.c,note['id'])['document_id'])
