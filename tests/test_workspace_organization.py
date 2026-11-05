import os
import unittest
import uuid
from islam_research import database as db,workspace_store as workspace,workspace_graph as graph

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class OrganizationTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
        self.a=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='An independent thought.',actor='synthetic')
        self.b=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='What would change my mind?',thought_type='question',actor='synthetic')
    def tearDown(self):self.c.close()
    def test_overlapping_collections_removal_does_not_copy_or_delete_note(self):
        sets=[]
        for title in ['Islam','Political authority']:
            request=str(uuid.uuid4());row=graph.create(self.c,entity='collection',request_uuid=request,title=title,actor='synthetic')
            self.assertEqual(graph.create(self.c,entity='collection',request_uuid=request,title=title,actor='synthetic')['id'],row['id'])
            graph.membership(self.c,collection_id=row['id'],target_kind='entry',target_id=self.a['id'],state='active',expected_revision=0,actor='synthetic');sets.append(row)
        graph.membership(self.c,collection_id=sets[0]['id'],target_kind='entry',target_id=self.a['id'],state='removed',expected_revision=1,actor='synthetic')
        self.assertEqual(graph.members(self.c,collection_id=sets[0]['id'])['items'],[])
        self.assertEqual(graph.members(self.c,collection_id=sets[1]['id'])['items'][0]['target']['revision'],1)
        self.assertEqual(workspace.note(self.c,self.a['id'])['body'],'An independent thought.')
    def test_tentative_connections_bounded_cycles_and_explicit_question_state(self):
        for left,right in [(self.a,self.b),(self.b,self.a)]:
            graph.create(self.c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='entry',from_id=left['id'],to_kind='entry',to_id=right['id'],relation='personal_association',rationale='My tentative working connection.',attribution='',evidence_annotation_id=None,state='tentative',actor='synthetic')
        neighbors=graph.neighborhood(self.c,kind='entry',id=self.a['id'],depth=2,limit=10)
        self.assertEqual(len(neighbors['nodes']),2);self.assertEqual(len(neighbors['edges']),2)
        self.assertIsNone(graph.investigation(self.c,target_kind='entry',target_id=self.b['id']))
        state=graph.investigate(self.c,target_kind='entry',target_id=self.b['id'],target_revision=1,state='investigating',reason='Compare interpretations before answering.',expected_revision=0,actor='synthetic')
        self.assertEqual(state['state'],'investigating')
        with self.assertRaises(ValueError):graph.create(self.c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='entry',from_id=self.a['id'],to_kind='entry',to_id=self.b['id'],relation='supports',rationale='Unsupported assertion',attribution='',evidence_annotation_id=None,state='accepted',actor='synthetic')
    def test_saved_view_is_live_and_reflection_preserves_original_revision(self):
        view=graph.create(self.c,entity='view',request_uuid=str(uuid.uuid4()),title='My questions',query=dict(version=1,scope='notes',q='',thought_type='question'),actor='synthetic')
        self.assertEqual(view['query']['scope'],'notes')
        request=str(uuid.uuid4());fields=dict(request_uuid=request,entry_id=self.a['id'],entry_revision=1,reason='This was my starting position.',uncertainty='Tentative, awaiting fuller reading.',evidence_annotation_id=None,actor='synthetic')
        first=graph.reflect(self.c,**fields)
        workspace.update_note(self.c,entry_id=self.a['id'],expected_revision=1,body='My understanding changed.',actor='synthetic')
        self.assertEqual(graph.reflect(self.c,**fields)['id'],first['id'])
        self.assertEqual(graph.reflections(self.c,entry_id=self.a['id'])['items'][0]['entry_revision'],1)
        self.assertEqual(workspace.history(self.c,entry_id=self.a['id'])[-1]['snapshot']['body'],'An independent thought.')

    def test_saved_unanswered_questions_is_a_live_filter_and_trash_is_excluded(self):
        view=graph.create(self.c,entity='view',request_uuid=str(uuid.uuid4()),title='Unanswered questions',query=dict(version=1,scope='questions',q='change my mind',investigation_state='unanswered'),actor='synthetic')
        result=workspace.view_results(self.c,view_id=view['id']);self.assertIn(self.b['id'],[r['id'] for r in result['items']])
        graph.investigate(self.c,target_kind='entry',target_id=self.b['id'],target_revision=1,state='resolved',reason='A provisional owner decision for this test.',expected_revision=0,actor='synthetic')
        self.assertNotIn(self.b['id'],[r['id'] for r in workspace.view_results(self.c,view_id=view['id'])['items']])
        notes=graph.create(self.c,entity='view',request_uuid=str(uuid.uuid4()),title='Loose ideas',query=dict(version=1,scope='notes',q='independent thought',source_link='none'),actor='synthetic')
        self.assertIn(self.a['id'],[r['id'] for r in workspace.view_results(self.c,view_id=notes['id'])['items']])
        workspace.trash(self.c,entry_id=self.a['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        self.assertNotIn(self.a['id'],[r['id'] for r in workspace.view_results(self.c,view_id=notes['id'])['items']])
