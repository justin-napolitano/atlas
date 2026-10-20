import os
import unittest
import uuid
from islam_research import database as db,notebook,workspace_store as workspace

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class OwnerWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
        self.projects=self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n']
    def tearDown(self):self.c.close()
    def create(self,**patch):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='## Loose idea 😀\n\nA thought without a book. العربية',actor='synthetic',**patch)
    def test_project_free_creation_same_body_history_retry_and_automatic_title(self):
        request=str(uuid.uuid4());fields=dict(request_uuid=request,body='## Loose idea 😀\n\nالعربية',actor='synthetic')
        first=workspace.create_note(self.c,**fields);again=workspace.create_note(self.c,**fields)
        self.assertEqual(first['id'],again['id']);self.assertEqual(first['revision'],1)
        self.assertIsNone(first['project_id']);self.assertEqual(first['workspace_id'],'owner')
        self.assertEqual(first['title'],'Loose idea 😀');self.assertEqual(first['title_mode'],'automatic')
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n'],self.projects)
        self.assertEqual(self.c.execute('SELECT body FROM research.notebook_entries WHERE id=%s',(first['id'],)).fetchone()['body'],fields['body'])
        changed=workspace.update_note(self.c,entry_id=first['id'],expected_revision=1,body='A revised opening\n\nStill my exact writing.',actor='synthetic')
        self.assertEqual(changed['title'],'A revised opening')
        manual=workspace.update_note(self.c,entry_id=first['id'],expected_revision=2,body=changed['body'],title='My chosen title',actor='synthetic')
        self.assertEqual(manual['title_mode'],'manual')
        final=workspace.update_note(self.c,entry_id=first['id'],expected_revision=3,body='Entirely different opening.',actor='synthetic')
        self.assertEqual(final['title'],'My chosen title')
        history=workspace.history(self.c,entry_id=first['id']);self.assertEqual(len(history),4)
        self.assertEqual(history[-1]['snapshot']['body'],fields['body'])
        with self.assertRaises(db.RevisionConflict):workspace.create_note(self.c,**{**fields,'body':'Changed frozen request'})
    def test_global_view_reuses_legacy_note_and_preserves_qualified_origin(self):
        project='synthetic:workspace:'+uuid.uuid4().hex;db.create_project(self.c,project,'Old project')
        old=notebook.create(self.c,request_uuid=str(uuid.uuid4()),project_id=project,thought_type='note',title='Old writing',body='An original private body.',links=[],actor='synthetic')
        before=notebook.get(self.c,project,old['id']);global_note=workspace.note(self.c,old['id'])
        self.assertEqual(global_note['body'],before['body']);self.assertEqual(global_note['project_id'],project)
        new=workspace.update_note(self.c,entry_id=old['id'],expected_revision=1,body='One edit through the global view.',actor='synthetic')
        self.assertEqual(new['project_id'],project)
        self.assertEqual(notebook.get(self.c,project,old['id'])['body'],new['body'])
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.notebook_entries WHERE id=%s',(old['id'],)).fetchone()['n'],1)
    def test_trash_cas_blocks_edit_preserves_history_and_restores(self):
        note=self.create();fields=dict(entry_id=note['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        row=workspace.trash(self.c,**fields);again=workspace.trash(self.c,**fields)
        self.assertEqual(row['revision'],again['revision'])
        with self.assertRaises(ValueError):workspace.update_note(self.c,entry_id=note['id'],expected_revision=1,body='Cannot edit trashed writing.',actor='synthetic')
        self.assertTrue(workspace.note(self.c,note['id'])['trashed'])
        workspace.trash(self.c,**{**fields,'expected_revision':1,'state':'active'})
        updated=workspace.update_note(self.c,entry_id=note['id'],expected_revision=1,body='Restored writing.',actor='synthetic')
        self.assertEqual(updated['revision'],2)
    def test_project_free_durable_draft_keeps_uuid_and_historical_baseline(self):
        request=str(uuid.uuid4());draft_uuid=str(uuid.uuid4())
        fields=dict(draft_uuid=draft_uuid,entry_id=None,request_uuid=request,record_id=None,document_id=None,annotation_id=None,
          base_revision=0,expected_revision=0,value=dict(thought_type='note',title='',body='Unfinished idea.',links=[],state='active'),state='active',actor='synthetic')
        first=workspace.save_draft(self.c,**fields);again=workspace.save_draft(self.c,**fields)
        self.assertEqual(first['id'],again['id']);self.assertIsNone(first['project_id'])
        self.assertEqual(first['request_uuid'],request)
        self.assertEqual(workspace.draft(self.c,draft_id=first['id'])['value']['body'],'Unfinished idea.')
        with self.assertRaises(ValueError):workspace.save_draft(self.c,**{**fields,'request_uuid':str(uuid.uuid4()),'expected_revision':1})
    def test_global_search_and_cursor_are_bounded_and_not_semantic_processing(self):
        marker='Unique-'+uuid.uuid4().hex
        first=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body=marker+' one',actor='synthetic')
        second=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body=marker+' two',actor='synthetic')
        page=workspace.notes(self.c,q=marker,limit=1);self.assertEqual(page['items'][0]['id'],second['id']);self.assertTrue(page['next_cursor'])
        rest=workspace.notes(self.c,q=marker,limit=1,cursor=page['next_cursor']);self.assertEqual(rest['items'][0]['id'],first['id'])
        self.assertIsNone(rest['next_cursor'])

class TitleTests(unittest.TestCase):
    def test_label_derivation_does_not_rewrite_source(self):
        text='\n## An idea العربية 😀\n\nBody';self.assertEqual(workspace.derived_title(text),'An idea العربية 😀')
        self.assertEqual(workspace.derived_title(' \n'),'Untitled note')
        self.assertEqual(len(workspace.derived_title('x'*400)),300)
