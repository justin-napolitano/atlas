"""Synthetic-only integration for immutable references, files and exact note identity."""
import base64
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from islam_research import database as db,desktop_sources as desktop,workspace_store as workspace,workspace_graph,passage_store


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class DesktopSourceTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)/'objects'
    def tearDown(self):self.c.close();self.temporary.cleanup()
    def reference(self,**patch):
        values=dict(request_uuid=str(uuid.uuid4()),reference='Synthetic book '+str(uuid.uuid4()),actor='synthetic')
        values.update(patch);return values,desktop.reference(self.c,**values)
    def file(self,**patch):
        values=dict(artifact_root=self.root,request_uuid=str(uuid.uuid4()),filename='synthetic.md',intent='source',
            rights_basis='Synthetic authored fixture',content_base64=base64.b64encode(b'# Original\r\n\nSynthetic file.').decode(),actor='synthetic')
        values.update(patch);return values,desktop.ingest(self.c,**values)
    def test_reference_without_edition_retries_after_metadata_change_and_no_read_effect(self):
        values,row=self.reference();record=workspace.source(self.c,record_id=row['record_id'])
        self.assertEqual(record['documents'],[]);self.assertEqual(record['record']['attributes']['source_intake']['edition'],'')
        self.assertEqual(record['library']['reading_status'],'want_to_read')
        self.assertTrue(desktop.reference(self.c,**values)['replayed'])
        db.save_record(self.c,record_id=row['record_id'],project_id=None,kind='source',title='Corrected',actor='synthetic',expected_revision=1)
        self.assertEqual(desktop.reference(self.c,**values)['record_id'],row['record_id'])
        with self.assertRaises(ValueError):desktop.reference(self.c,**{**values,'reference':'Changed input'})
        self.assertTrue(any(r['id']==row['record_id'] for r in workspace.search(self.c,q='Corrected')['items']))
    def test_identity_candidates_are_explicit_and_url_credentials_rejected(self):
        values,row=self.reference(reference='10.5555/'+str(uuid.uuid4()))
        with self.assertRaises(ValueError):desktop.reference(self.c,**{**values,'request_uuid':str(uuid.uuid4())})
        reused=desktop.reference(self.c,**{**values,'request_uuid':str(uuid.uuid4()),'existing_source_record_id':row['record_id']})
        self.assertEqual(row['record_id'],reused['record_id'])
        distinct=desktop.reference(self.c,**{**values,'request_uuid':str(uuid.uuid4()),'distinct_reason':'Different declared edition'})
        self.assertNotEqual(row['record_id'],distinct['record_id'])
        with self.assertRaises(ValueError):self.reference(reference='https://user:password@example.invalid/document')

    def test_metadata_revision_history_and_lost_response_replay_preserve_note_selectors(self):
        _,source=self.reference()
        values=dict(request_uuid=str(uuid.uuid4()),record_id=source['record_id'],expected_revision=1,
            title='Synthetic corrected title',creators='Synthetic author',edition='Owner-declared edition',actor='synthetic')
        first=desktop.metadata(self.c,**values)
        self.assertEqual(first['revision'],2)
        self.assertTrue(desktop.metadata(self.c,**values)['replayed'])
        with self.assertRaises(db.RevisionConflict):desktop.metadata(self.c,**{**values,'request_uuid':str(uuid.uuid4())})
        row=workspace.source(self.c,record_id=source['record_id'])['record']
        self.assertEqual(row['attributes']['source_intake']['review_effect'],'none')
        self.assertEqual(row['review_state'],'pending')
    def test_related_notes_are_original_ids_questions_and_pagination_respects_trash(self):
        _,row=self.reference();_,other=self.reference()
        note=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Independent synthetic thought',actor='synthetic')
        for record in [row,other]:
            workspace_graph.create(self.c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='entry',from_id=note['id'],
                to_kind='record',to_id=record['record_id'],relation='comments_on',rationale='Personal context',attribution='',evidence_annotation_id=None,state='tentative',actor='synthetic')
        q=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='A synthetic question?',thought_type='question',record_id=row['record_id'],actor='synthetic')
        page=desktop.related(self.c,record_id=row['record_id'],limit=1)
        self.assertIsNotNone(page['next_cursor']);page2=desktop.related(self.c,record_id=row['record_id'],cursor=page['next_cursor'])
        self.assertEqual({r['id'] for r in page['items']+page2['items']},{note['id'],q['id']})
        self.assertEqual(desktop.related(self.c,record_id=other['record_id'])['items'][0]['id'],note['id'])
        self.assertIsNone(workspace.note(self.c,note['id'])['record_id'])
        workspace.trash(self.c,entry_id=note['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        self.assertEqual(desktop.related(self.c,record_id=other['record_id'])['items'],[])

    def test_reverse_associations_and_explicit_note_links_are_in_source_writing(self):
        _,source=self.reference()
        loose=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic reverse association',actor='synthetic')
        workspace_graph.create(self.c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='record',from_id=source['record_id'],
            to_kind='entry',to_id=loose['id'],relation='personal_association',rationale='Personal context only',attribution='',evidence_annotation_id=None,state='tentative',actor='synthetic')
        linked=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic linked question',thought_type='question',actor='synthetic',
            links=[dict(kind='record',id=source['record_id'],rationale='Background for this question')])
        self.assertEqual({r['id'] for r in desktop.related(self.c,record_id=source['record_id'])['items']},{loose['id'],linked['id']})
    def test_original_bytes_immutable_text_selector_and_replay_survive_edited_note(self):
        data='# Original\r\n\nSynthetic العربية 😀'.encode()
        values,row=self.file(content_base64=base64.b64encode(data).decode())
        self.assertEqual(desktop.read_artifact(self.root,row['sha256']),data)
        doc=passage_store.get_document(self.c,None,row['document_id']);exact='العربية 😀';start=doc['text_body'].index(exact)
        mark=passage_store.create_annotation(self.c,annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=doc['id'],text_sha256=doc['text_sha256'],start=start,end=start+len(exact),exact=exact,capture_kind='comment',body='Synthetic note',actor='synthetic')
        self.assertTrue(passage_store.annotation(self.c,None,mark['id'])['anchor']['anchored'])
        self.assertEqual(desktop.ingest(self.c,**values)['artifact_id'],row['artifact_id'])
        values,note=self.file(intent='note');original=workspace.note(self.c,note['entry_id'])
        workspace.update_note(self.c,entry_id=note['entry_id'],expected_revision=original['revision'],body='Changed canonical Markdown',actor='synthetic')
        self.assertTrue(desktop.ingest(self.c,**values)['replayed'])
        self.assertEqual(workspace.note(self.c,note['entry_id'])['body'],'Changed canonical Markdown')
    def test_distinct_intents_reuse_bytes_not_source_identity_and_attach_source(self):
        values,source=self.file();_,note=self.file(intent='note',record_id=source['record_id'])
        self.assertEqual(note['sha256'],source['sha256'])
        self.assertEqual(workspace.note(self.c,note['entry_id'])['record_id'],source['record_id'])
        self.assertEqual(len(desktop.artifacts(self.c,record_id=source['record_id'])),1)
        self.assertEqual(len(list(self.root.iterdir())),1)
    def test_corrupt_original_never_confirms_a_retry(self):
        values,row=self.file();(self.root/row['sha256']).write_bytes(b'corrupt')
        with self.assertRaises(ValueError):desktop.ingest(self.c,**values)

    def test_database_failure_after_durable_bytes_is_recoverable_on_exact_retry(self):
        from unittest.mock import patch
        values=dict(artifact_root=self.root,request_uuid=str(uuid.uuid4()),filename='synthetic.md',intent='source',
            rights_basis='Synthetic authored fixture',content_base64=base64.b64encode(b'Synthetic orphan recovery').decode(),actor='synthetic')
        with patch.object(desktop.db,'save_record',side_effect=RuntimeError('Synthetic interrupted registration')):
            with self.assertRaises(RuntimeError):desktop.ingest(self.c,**values)
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.desktop_requests WHERE request_uuid=%s',(values['request_uuid'],)).fetchone()['n'],0)
        self.assertEqual(len(list(self.root.iterdir())),1)
        result=desktop.ingest(self.c,**values)
        self.assertTrue(desktop.ingest(self.c,**values)['replayed'])
        self.assertEqual(len(desktop.artifacts(self.c,record_id=result['record_id'])),1)
    def test_invalid_file_or_permission_has_no_success_receipt(self):
        for patch in [dict(filename='../escape.md'),dict(filename='active.html'),dict(rights_basis=''),dict(content_base64='not base64'),dict(content_base64=base64.b64encode(b'\xff').decode()),dict(content_base64=base64.b64encode(b'a'*32769).decode())]:
            with self.assertRaises(ValueError):self.file(**patch)
    def test_long_text_splits_exact_versions_without_silently_truncating(self):
        text='Synthetic '*2200
        _,row=self.file(content_base64=base64.b64encode(text.encode()).decode())
        artifact=desktop.artifacts(self.c,record_id=row['record_id'])[0]
        documents=[passage_store.get_document(self.c,None,id) for id in artifact['document_ids']]
        self.assertEqual(len(documents),3)
        self.assertEqual(''.join(d['text_body'] for d in documents),text)
        reopened=workspace.source(self.c,record_id=row['record_id'])['documents']
        self.assertEqual([d['id'] for d in reopened],artifact['document_ids'])
        with self.assertRaises(ValueError):self.file(intent='note',content_base64=base64.b64encode(text.encode()).decode())


class ArtifactFilesystemTests(unittest.TestCase):
    def test_private_storage_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'objects';sha=desktop.write_artifact(root,b'Synthetic')
            path=root/sha;other=Path(temporary)/'elsewhere';path.rename(other);path.symlink_to(other)
            with self.assertRaises(OSError):desktop.read_artifact(root,sha)
            root.chmod(0o755)
            with self.assertRaises(ValueError):desktop.private_root(root)


class DesktopAPITests(unittest.TestCase):
    def test_routes_absent_from_hosted_and_public_even_with_platform_headers(self):
        import test_api as base
        base.APIBoundaryTests.setUp(self)
        for mode in ['owner','public']:
            from islam_research.api import create_app,Settings
            from fastapi.testclient import TestClient
            settings=self.settings if mode=='owner' else Settings('synthetic',mode='public')
            app=create_app(settings,store=base.MemoryBoundaryStore(),verifier=self.verifier)
            with TestClient(app) as client:
                self.assertFalse(any('/desktop/' in p for p in app.openapi()['paths']))
                self.assertEqual(client.get('/v1/desktop/capabilities',headers={'X-Atlas-Desktop':'true'}).status_code,404)
    def test_desktop_writes_require_owner_csrf_and_explicit_intent(self):
        import test_api as base
        from fastapi.testclient import TestClient
        from islam_research.api import create_app
        from unittest.mock import patch
        base.APIBoundaryTests.setUp(self)
        client=TestClient(create_app(self.settings,store=base.MemoryBoundaryStore(),verifier=self.verifier,desktop_artifact_root=Path('/synthetic-private-objects')))
        value=dict(request_uuid=str(uuid.uuid4()),reference='Synthetic reference',owner_confirmed=True)
        self.assertEqual(client.post('/v1/desktop/references',json=value).status_code,401)
        headers=base.APIBoundaryTests.headers(self)
        missing={k:v for k,v in headers.items() if k!='x-research-write'}
        self.assertEqual(client.post('/v1/desktop/references',json=value,headers=missing).status_code,403)
        with patch.object(base.MemoryBoundaryStore,'desktop_operation',return_value={'record_id':'synthetic'},create=True) as call:
            self.assertEqual(client.post('/v1/desktop/references',json=value,headers=headers).status_code,201)
            self.assertEqual(call.call_args.kwargs['actor'],base.OWNER)
            self.assertEqual(client.post('/v1/desktop/references',json={**value,'desktop':True},headers=headers).status_code,422)
