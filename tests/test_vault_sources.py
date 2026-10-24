"""Source-aware backup and fresh-database reconstruction with synthetic text only."""
import copy
import json
import os
import unittest
import uuid
from unittest.mock import patch

from islam_research import database as db,workspace_store as workspace,passage_store as passages
from islam_research import vault_format as codec,vault_context as context,vault_sync as sync,vault_connection as connection
from islam_research.github_native import GitHubUnavailable
from test_source_intake import payload
from test_vault_sync import FakeVault


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class SourceBackupTests(unittest.TestCase):
    def setUp(self):
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        self.admin=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);self.admin.autocommit=True
        self.database='atlas_source_test_'+uuid.uuid4().hex
        self.admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(self.database)))
        self.c=db.connect(make_conninfo(os.environ['RESEARCH_TEST_DATABASE_URL'],dbname=self.database));db.migrate(self.c);self.c.commit();self.c.autocommit=True
        self.c.execute('DELETE FROM research.vault_sync_plans');self.c.execute('DELETE FROM research.vault_sync_pages');self.c.execute('DELETE FROM research.vault_connections')
        self.remote=FakeVault();connection.connect(self.c,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
        self.text='First identical quotation. محفوظ 😀 Second identical quotation.'
        fields=payload(None,identifier='',source_url='',edition='Synthetic edition A',rights_status='permitted_excerpt',rights_basis='Synthetic authored fixture',coverage_scope='selected_passage',
            excerpt=dict(text=self.text,edition='Synthetic edition A',locator='Chapter 2, paragraph 3',representation_url=''))
        fields.pop('project_id');fields.pop('owner_confirmed')
        self.source=workspace.intake(self.c,**fields)
        self.doc=passages.get_document(self.c,None,self.source['document_id'])
        start=self.text.index('محفوظ');exact='محفوظ 😀'
        self.mark=passages.create_annotation(self.c,annotation_uuid=str(uuid.uuid4()),project_id=None,document_id=self.doc['id'],text_sha256=self.doc['text_sha256'],
            start=start,end=start+len(exact),exact=exact,capture_kind='comment',body='Synthetic passage annotation.',actor='synthetic')
    def tearDown(self):
        from psycopg import sql
        self.c.close()
        self.admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(self.database)));self.admin.close()
    def note(self,**kwargs):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='My exact note\r\n\nالعربية 😀',record_id=self.source['record_id'],actor='synthetic',**kwargs)
    def plan(self,*notes):
        return sync.prepare(self.c,request_uuid=str(uuid.uuid4()),entries=[dict(id=n['id'],revision=n['revision']) for n in notes],actor='synthetic',remote=self.remote)
    def apply(self,plan):return sync.apply(self.c,plan_id=plan['id'],actor='synthetic',remote=self.remote)

    def test_source_and_passage_notes_export_exact_body_and_readable_context(self):
        note=self.note(document_id=self.doc['id'],annotation_id=self.mark['id'],thought_type='source_claim')
        plan=self.plan(note);self.assertEqual(plan['coverage']['format'],2)
        self.assertEqual(plan['actions'][0]['source_context']['documents'][0]['text_sha256'],self.doc['text_sha256'])
        result=self.apply(plan);self.assertTrue(result['receipt_verified'])
        m,b=codec.paths(note['id']);self.assertEqual(self.remote.files[b],note['body'].encode())
        citation=self.remote.files[codec.citation_path(note['id'])].decode()
        self.assertIn('Synthetic edition A',citation);self.assertIn('Chapter 2, paragraph 3',citation);self.assertIn(self.mark['exact'],citation)
        self.assertNotIn('text_body',json.loads(self.remote.files[m])['source_context']['documents'][0])
        preview=sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)
        self.assertEqual(preview['items'][0]['action'],'matches');self.assertEqual(preview['restored'],0)
        self.assertEqual(workspace.note(self.c,note['id'])['body'],note['body'])

    def test_annotation_is_backed_up_at_its_original_authority_and_revision(self):
        row=context.local(self.c,self.mark['id']);result=self.apply(self.plan(row));m,b=codec.paths(row['id'])
        self.assertEqual(self.remote.files[b],self.mark['body'].encode());self.assertEqual(result['coverage']['pages'][0]['application_revision'],1)
        self.assertIsNone(workspace.note(self.c,row['id']))
        passages.update_annotation(self.c,annotation_id=row['id'],project_id=None,body='Newer annotation writing.',expected_revision=1,actor='synthetic')
        queued=self.c.execute('SELECT dirty_revision,confirmed_revision FROM research.vault_sync_pages WHERE entry_id=%s',(row['id'],)).fetchone()
        self.assertEqual((queued['dirty_revision'],queued['confirmed_revision']),(2,1))
        self.assertNotEqual(sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)['items'][0]['action'],'matches')
        page=connection.preview(self.c,kind='annotation',limit=50,remote=self.remote)
        self.assertIn(row['id'],[n['id'] for n in page['items']])

    def test_changed_source_after_review_and_tampered_citation_cannot_confirm(self):
        note=self.note();plan=self.plan(note)
        db.save_record(self.c,record_id=self.source['record_id'],project_id=None,kind='source',title='Different bibliography',expected_revision=1,actor='synthetic')
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        self.assertEqual(self.remote.posts,0)
        confirmed=self.apply(self.plan(workspace.note(self.c,note['id'])))
        self.remote.external({codec.citation_path(note['id']):b'Synthetic tampered citation'})
        with self.assertRaises(GitHubUnavailable):sync.restore_preview(self.c,backup_id=confirmed['id'],commit_sha=self.remote.head,remote=self.remote)

    def test_unknown_context_dangling_edition_and_quote_ranges_are_rejected(self):
        note=self.note(document_id=self.doc['id'],annotation_id=self.mark['id']);page=sync._page(context.portable(self.c,note))
        for change in ('version','quote','document','extra'):
            other=copy.deepcopy(page);ctx=other['source_context']
            if change=='version':ctx['format']=99
            elif change=='quote':ctx['annotations'][0]['end_pos']+=1
            elif change=='document':ctx['documents'][0]['source_record_id']='missing-source'
            else:ctx['documents'][0]['text_body']='Must not be included'
            with self.subTest(change=change),self.assertRaises(ValueError):codec.encode_page(other)

    def test_fresh_database_requires_separate_original_then_restores_bindings_and_ids(self):
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        note=self.note(document_id=self.doc['id'],annotation_id=self.mark['id'])
        result=self.apply(self.plan(note,context.local(self.c,self.mark['id'])))
        inventory=sync._snapshot(self.remote,connection.status(self.c)['connection'],result['commit_sha'])
        pages=[sync._remote_page(self.remote,connection.status(self.c)['connection'],inventory,n['id']) for n in (note,self.mark)]
        name='atlas_source_restore_'+uuid.uuid4().hex
        self.c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            with db.connect(make_conninfo(os.environ['RESEARCH_TEST_DATABASE_URL'],dbname=name)) as target:
                db.migrate(target);target.commit();target.autocommit=True
                connection.connect(target,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
                preview=sync.restore_preview(target,backup_id=result['id'],remote=self.remote)
                self.assertTrue(all(n['action']=='blocked' for n in preview['items']))
                with self.assertRaises(ValueError):codec.import_new_pages(target,pages,actor='synthetic')
                self.assertEqual(target.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n'],0)
                self.assertIsNone(db.get_record(target,self.source['record_id']))
                with self.assertRaises(ValueError):codec.import_new_pages(target,pages,actor='synthetic',documents={self.doc['id']:self.text+'wrong'})
                source_note=self.note()
                source_page=sync._page(context.portable(self.c,source_note))
                codec.import_new_pages(target,[source_page],actor='synthetic')
                self.assertEqual(workspace.note(target,source_note['id'])['record_id'],self.source['record_id'])
                codec.import_new_pages(target,pages,actor='synthetic',documents={self.doc['id']:self.text})
                restored=workspace.note(target,note['id'])
                for key in ('id','body','record_id','document_id','annotation_id','selected_quote','start_pos','end_pos'):self.assertEqual(restored[key],note[key])
                self.assertEqual(passages.annotation(target,None,self.mark['id'])['annotation']['exact'],self.mark['exact'])
                self.assertEqual(target.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n'],2)
                self.assertEqual(codec.import_new_pages(target,pages,actor='synthetic')['created'],[])
                self.assertTrue(all(n['action']=='matches' for n in sync.restore_preview(target,backup_id=result['id'],remote=self.remote)['items']))
        finally:self.c.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))

    def test_source_level_note_restores_without_original_and_multiple_editions_stay_distinct(self):
        note=self.note();result=self.apply(self.plan(note))
        self.assertFalse(result['coverage']['pages'][0].get('citation_sha256') is None)
        page=sync._page(context.portable(self.c,note));self.assertEqual(page['source_context']['documents'],[])
        second=passages.create_document(self.c,project_id=None,source_record_id=self.source['record_id'],edition='Synthetic edition B',locator=self.doc['locator'],representation_url='',text=self.text,actor='synthetic')
        other=self.note(document_id=second['id'],reading_position=0)
        backup=self.apply(self.plan(other));self.assertEqual(backup['actions'][0]['source_context']['documents'][0]['edition'],'Synthetic edition B')
        self.assertNotEqual(second['id'],self.doc['id'])

    def test_quran_scope_and_typed_source_links_preserve_real_bindings(self):
        from islam_research import quran_workspace as quran
        row=quran.create_note(self.c,project_id=None,resource_key='itani-god',chapter=4,ayah_start=59,ayah_end=59,
            request_uuid=str(uuid.uuid4()),body='Synthetic verse note.',actor='synthetic')['note']
        result=self.apply(self.plan(row));ctx=result['actions'][0]['source_context']
        self.assertEqual(ctx['binding']['quran_context']['ayah_start'],59)
        self.assertEqual(sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)['items'][0]['action'],'matches')
        loose=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic linked note.',actor='synthetic',links=[dict(kind='record',id=self.source['record_id'],rationale='Source reference'),dict(kind='annotation',id=self.mark['id'],rationale='Exact source passage')])
        backed=self.apply(self.plan(loose));self.assertEqual(len(backed['actions'][0]['source_context']['annotations']),1)

    def test_annotation_lost_ack_newer_typing_and_orphan_enrollment_protection(self):
        mark=context.local(self.c,self.mark['id']);plan=self.plan(mark);self.remote.lose=True
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        passages.update_annotation(self.c,annotation_id=mark['id'],project_id=None,body='Newer typing after unknown response',expected_revision=1,actor='synthetic')
        self.assertTrue(self.apply(plan)['receipt_verified']);self.assertEqual(self.remote.posts,1)
        self.assertEqual(passages.annotation(self.c,None,mark['id'])['annotation']['revision'],2)
        with self.assertRaises(db.psycopg.errors.CheckViolation):
            self.c.execute('INSERT INTO research.vault_sync_pages(entry_id,dirty_revision,selected_by) VALUES(%s,1,%s)',(codec.PREFIX+str(uuid.uuid4()),'synthetic'))

    def test_catalog_authors_and_translator_are_retained_without_arbitrary_attributes(self):
        db.save_record(self.c,record_id=self.source['record_id'],project_id=None,kind='source',title='Synthetic catalog work',expected_revision=1,actor='synthetic',
            attributes=dict(provider='gutenberg',gutenberg_id=123,creators=['Synthetic Author A','Synthetic Author B'],translators=['Synthetic Translator'],source_url='https://example.org/synthetic-book',internal_unselected_state='Never exported'))
        note=self.note();result=self.apply(self.plan(note));ctx=result['actions'][0]['source_context']
        self.assertEqual(ctx['sources'][0]['bibliography']['creators'],'Synthetic Author A; Synthetic Author B')
        self.assertEqual(ctx['sources'][0]['resource']['gutenberg_id'],123)
        self.assertNotIn('Never exported',json.dumps(ctx))
        self.assertIn('Synthetic Translator',self.remote.files[codec.citation_path(note['id'])].decode())
        self.assertEqual(sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)['items'][0]['action'],'matches')

    def test_retained_original_is_referenced_by_digest_and_never_uploaded(self):
        import base64
        import tempfile
        from pathlib import Path
        from islam_research import desktop_sources
        raw=b'Only synthetic original bytes, retained separately.'
        with tempfile.TemporaryDirectory(prefix='atlas-source-artifact-',dir='/private/tmp') as directory:
            artifact=desktop_sources.ingest(self.c,artifact_root=Path(directory)/'objects',request_uuid=str(uuid.uuid4()),filename='synthetic-original.txt',
                content_base64=base64.b64encode(raw).decode(),intent='source',rights_basis='Synthetic authored fixture',actor='synthetic')
            note=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic note about an original.',actor='synthetic',record_id=artifact['record_id'],document_id=artifact['document_id'],reading_position=0)
            result=self.apply(self.plan(note));pointer=result['actions'][0]['source_context']['documents'][0]['artifacts'][0]
            self.assertEqual(pointer['id'],artifact['artifact_id']);self.assertEqual(pointer['sha256'],artifact['sha256']);self.assertFalse(pointer['included'])
            self.assertNotIn(raw,b'\n'.join(self.remote.files.values()))
