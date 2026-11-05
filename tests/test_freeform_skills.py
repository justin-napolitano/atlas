"""Skills are ordinary private notebook entries, never assessed/progress entities."""
import os
import unittest
import uuid
from islam_research import database as db,workspace_store as workspace,workspace_graph as graph,desktop_pages as pages

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class FreeformSkillsTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def create(self,kind='skill',**patch):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='## Synthetic freeform '+uuid.uuid4().hex+'\n\nالعربية 😀',thought_type=kind,actor='synthetic',**patch)
    def test_standalone_replay_conversion_history_and_cas_preserve_identity(self):
        request=str(uuid.uuid4());fields=dict(request_uuid=request,body='One unstructured thought 😀',thought_type='skill',actor='synthetic')
        row=workspace.create_note(self.c,**fields)
        self.assertEqual(workspace.create_note(self.c,**fields)['id'],row['id'])
        for key in ['project_id','record_id','document_id','annotation_id','reading_position']:self.assertIsNone(row[key])
        self.assertEqual(row['links'],[])
        parent=self.create('principle');pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=row['id'],parent_id=parent['id'],expected_revision=0,actor='synthetic')
        for revision,kind in [(1,'principle'),(2,'note'),(3,'skill')]:
            value=workspace.update_note(self.c,entry_id=row['id'],expected_revision=revision,body=row['body'],thought_type=kind,actor='synthetic')
            self.assertEqual(value['id'],row['id']);self.assertEqual(value['body'],row['body']);self.assertEqual(value['thought_type'],kind)
            self.assertEqual(pages.context(self.c,entry_id=row['id'])['parent_id'],parent['id'])
        self.assertEqual([r['snapshot']['thought_type'] for r in workspace.history(self.c,entry_id=row['id'])],['skill','note','principle','skill'])
        with self.assertRaises(db.RevisionConflict):workspace.update_note(self.c,entry_id=row['id'],expected_revision=1,body='Stale',thought_type='note',actor='synthetic')
        with self.assertRaises(ValueError):self.create('expert')
    def test_durable_skill_draft_retry_and_recovery_keep_exact_value(self):
        value=dict(thought_type='skill',title='',body='Loose skill draft 😀',links=[],state='active')
        fields=dict(draft_uuid=str(uuid.uuid4()),entry_id=None,request_uuid=str(uuid.uuid4()),record_id=None,document_id=None,annotation_id=None,
            base_revision=0,expected_revision=0,value=value,state='active',actor='synthetic')
        row=workspace.save_draft(self.c,**fields)
        self.assertEqual(workspace.save_draft(self.c,**fields)['id'],row['id'])
        self.assertEqual(workspace.draft(self.c,draft_id=row['id'])['value'],value)
        saved=workspace.create_note(self.c,request_uuid=fields['request_uuid'],body=value['body'],thought_type='skill',actor='synthetic')
        updated={**fields,'draft_uuid':str(uuid.uuid4()),'entry_id':saved['id'],'request_uuid':None,'base_revision':1,'value':{**value,'body':'Newer typing'}}
        self.assertEqual(workspace.save_draft(self.c,**updated)['value']['thought_type'],'skill')
    def test_type_filters_search_pagination_and_saved_view_use_same_notes(self):
        marker='SkillFilter'+uuid.uuid4().hex
        entries=[workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body=marker+' '+str(i),thought_type=kind,actor='synthetic') for i,kind in enumerate(['skill','principle','skill'])]
        first=workspace.notes(self.c,q=marker,thought_type='skill',limit=1)
        rest=workspace.notes(self.c,q=marker,thought_type='skill',limit=1,cursor=first['next_cursor'])
        self.assertEqual({first['items'][0]['id'],rest['items'][0]['id']},{entries[0]['id'],entries[2]['id']})
        self.assertEqual({r['id'] for r in workspace.search(self.c,q=marker)['items']},{r['id'] for r in entries})
        view=graph.create(self.c,entity='view',request_uuid=str(uuid.uuid4()),title='Synthetic skills',query=dict(version=1,scope='notes',q=marker,thought_type='skill'),actor='synthetic')
        self.assertEqual({r['id'] for r in workspace.view_results(self.c,view_id=view['id'])['items']},{entries[0]['id'],entries[2]['id']})
    def test_optional_links_and_backlinks_survive_role_conversion(self):
        principle=self.create('principle')
        skill=self.create(links=[dict(kind='entry',id=principle['id'],rationale='Markdown page link')])
        self.assertEqual(pages.backlinks(self.c,entry_id=principle['id'])['items'][0]['id'],skill['id'])
        updated=workspace.update_note(self.c,entry_id=skill['id'],expected_revision=1,body=skill['body'],thought_type='note',actor='synthetic')
        self.assertEqual(updated['links'],skill['links'])
        self.assertEqual(pages.resolve(self.c,target=principle['id'])['items'][0]['id'],principle['id'])
        self.assertEqual(pages.backlinks(self.c,entry_id=principle['id'])['items'][0]['id'],skill['id'])

    def test_evidence_link_retains_original_passage_without_anchoring_the_skill(self):
        from islam_research import passage_store
        project='synthetic:skill:'+uuid.uuid4().hex;source=project+':source'
        db.create_project(self.c,project,'Synthetic evidence')
        db.save_record(self.c,record_id=source,project_id=project,kind='source',title='Synthetic primary text',actor='synthetic')
        document=passage_store.create_document(self.c,project_id=project,source_record_id=source,edition='Synthetic edition',locator='Paragraph 1',representation_url='',text='A synthetic source passage.',actor='synthetic')
        capture=passage_store.create_annotation(self.c,annotation_uuid=str(uuid.uuid4()),project_id=project,document_id=document['id'],text_sha256=document['text_sha256'],start=2,end=11,exact='synthetic',capture_kind='comment',body='Synthetic reading note',actor='synthetic')
        skill=self.create(links=[dict(kind='annotation',id=capture['id'],rationale='An optional source reference')])
        self.assertIsNone(skill['document_id']);self.assertIsNone(skill['annotation_id'])
        self.assertEqual(skill['links'][0]['id'],capture['id'])
        original=passage_store.annotation(self.c,project,capture['id'])
        self.assertTrue(original['anchor']['anchored']);self.assertEqual(original['annotation']['exact'],'synthetic')
