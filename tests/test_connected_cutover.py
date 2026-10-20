"""Synthetic cutover and runtime-role proofs; never connect to owner application data."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
import unittest
from unittest.mock import patch
import uuid
from islam_research import database as db,notebook,workspace_store as workspace,workspace_graph as graph,passage_store

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL migration owner')
class ConnectedCutoverTests(unittest.TestCase):
    def test_explicit_legacy_collections_preserve_bodies_anchors_seals_and_loose_notes(self):
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];name='connected_cutover_'+uuid.uuid4().hex
        actual=Path(__file__).parents[1]/'src/islam_research/migrations';migration='0029_legacy_collection_aliases.sql'
        with db.connect(dsn) as c:c.autocommit=True;c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            with TemporaryDirectory() as temp,db.connect(make_conninfo(dsn,dbname=name)) as c:
                root=Path(temp);(root/'migrations').mkdir()
                for path in actual.glob('*.sql'):
                    if path.name<migration:shutil.copyfile(path,root/'migrations'/path.name)
                with patch('islam_research.database.files',return_value=root):db.migrate(c)
                db.create_project(c,'synthetic:old-group','Islam and philosophy')
                source='synthetic:cutover-source';db.save_record(c,project_id='synthetic:old-group',record_id=source,kind='source',title='Synthetic edition',actor='synthetic')
                doc=passage_store.create_document(c,project_id='synthetic:old-group',source_record_id=source,edition='A named edition',locator='Section 1',representation_url='',text='Original العربية 😀 é wording.',actor='synthetic')
                old=notebook.create(c,request_uuid=str(uuid.uuid4()),project_id='synthetic:old-group',thought_type='note',title='Old source note',body='Exact **Markdown** العربية 😀',links=[],record_id=source,document_id=doc['id'],reading_position=4,actor='synthetic')
                loose=workspace.create_note(c,request_uuid=str(uuid.uuid4()),body='A loose idea that needs no group.',actor='synthetic')
                tables=('records','record_revisions','reading_documents','notebook_entries','notebook_revisions')
                before={table:c.execute(sql.SQL('SELECT to_jsonb(t) AS value FROM research.{} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(table))).fetchall() for table in tables}
                seal=c.execute('SELECT research.publication_inputs(%s,%s,%s) AS value',('synthetic:old-group',[source],[])).fetchone()['value']
                shutil.copyfile(actual/migration,root/'migrations'/migration)
                with patch('islam_research.database.files',return_value=root):self.assertEqual(db.migrate(c),[migration])
                for table in tables:self.assertEqual(c.execute(sql.SQL('SELECT to_jsonb(t) AS value FROM research.{} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(table))).fetchall(),before[table])
                self.assertEqual(c.execute('SELECT research.publication_inputs(%s,%s,%s) AS value',('synthetic:old-group',[source],[])).fetchone()['value'],seal)
                mapping=c.execute('SELECT * FROM research.workspace_legacy_collections').fetchall();self.assertEqual(len(mapping),1)
                members=graph.members(c,collection_id=mapping[0]['collection_id'])['items'];ids={row['target_id'] for row in members}
                self.assertIn(source,ids);self.assertIn(old['id'],ids);self.assertNotIn(loose['id'],ids)
                collection=graph.item(c,entity='collection',id=mapping[0]['collection_id'])
                graph.update(c,entity='collection',id=collection['id'],expected_revision=1,title=collection['title'],state='archived',actor='synthetic')
                self.assertEqual(workspace.note(c,old['id'])['body'],'Exact **Markdown** العربية 😀')
                with patch('islam_research.database.files',return_value=root):self.assertEqual(db.migrate(c),[])
        finally:
            with db.connect(dsn) as c:c.autocommit=True;c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL roles')
class ConnectedPrivilegesTests(unittest.TestCase):
    def test_runtime_can_connect_and_retain_native_reading_but_cannot_rewrite_history_or_aliases(self):
        from psycopg import sql,errors
        from psycopg.conninfo import make_conninfo
        from islam_research.sql_permissions import configure
        from islam_research import quran_workspace,quran_progress
        dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];owner='connected_owner_'+uuid.uuid4().hex;public='connected_public_'+uuid.uuid4().hex
        with db.connect(dsn) as c:
            db.migrate(c)
            for role in (owner,public):c.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            c.commit();configure(c,owner,public,apply=True)
        try:
            with db.connect(make_conninfo(dsn,user=owner)) as c:
                note=workspace.create_note(c,request_uuid=str(uuid.uuid4()),body='Runtime-owned loose note.',actor='synthetic')
                collection=graph.create(c,entity='collection',request_uuid=str(uuid.uuid4()),title='Optional runtime collection',actor='synthetic')
                graph.membership(c,collection_id=collection['id'],target_kind='entry',target_id=note['id'],state='active',expected_revision=0,actor='synthetic')
                bound=quran_workspace.binding(c,project_id=None,resource_key='itani-god',chapter=4,ayah_start=85,ayah_end=85,actor='synthetic')
                graph.create(c,entity='connection',request_uuid=str(uuid.uuid4()),from_kind='entry',from_id=note['id'],to_kind='record',to_id=bound['record_id'],relation='comments_on',rationale='My question concerns this source.',attribution='',evidence_annotation_id=None,state='tentative',actor='synthetic')
                old=quran_workspace.place(c,None)
                quran_workspace.save_place(c,project_id=None,resource_key='itani-god',chapter=4,ayah=85,expected_revision=old['revision'] if old else 0,actor='synthetic')
                self.assertGreaterEqual(len(graph.neighborhood(c,kind='entry',id=note['id'])['nodes']),2)
                c.commit()
                for statement in ['DELETE FROM research.workspace_organization_history','DELETE FROM research.workspace_legacy_collections','UPDATE research.workspace_collections SET workspace_id=workspace_id','DELETE FROM research.workspace_reflections']:
                    with self.assertRaises(errors.InsufficientPrivilege):
                        with c.transaction():c.execute(statement)
            with db.connect(make_conninfo(dsn,user=public)) as c:
                for table in ['workspace_connections','workspace_collections','workspace_reflections','workspace_legacy_collections']:
                    with self.assertRaises(errors.InsufficientPrivilege):
                        with c.transaction():c.execute(sql.SQL('SELECT * FROM research.{}').format(sql.Identifier(table)))
        finally:
            with db.connect(dsn) as c:
                for role in (owner,public):
                    c.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(role)))
                    c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
