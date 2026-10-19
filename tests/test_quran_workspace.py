import os
import unittest
import uuid
from islam_research import quran_workspace as reader, quran_reader


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class QuranWorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.sql=db,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL']
        cls.owner,cls.public='quran_owner_'+uuid.uuid4().hex,'quran_public_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.public):connection.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.public,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner)
        cls.public_dsn=make_conninfo(cls.dsn,user=cls.public)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.public):
                connection.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project='quran-test:'+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as c:self.db.create_project(c,self.project,'Synthetic reader test')
        self.values=dict(project_id=self.project,resource_key='itani-god',chapter=4,ayah_start=59,ayah_end=59)

    def test_atomic_creation_retry_cas_and_immutable_version(self):
        from islam_research import notebook,passage_store
        request=str(uuid.uuid4())
        with self.db.connect(self.owner_dsn) as c:
            self.assertIsNone(reader.existing(c,**self.values))
            first=reader.create_note(c,**self.values,request_uuid=request,body='**My thought**, not evidence.',actor='owner')
            replay=reader.create_note(c,**self.values,request_uuid=request,body='**My thought**, not evidence.',actor='owner')
            self.assertEqual(first['note']['id'],replay['note']['id'])
            self.assertEqual(first['binding']['document']['id'],replay['binding']['document']['id'])
            self.assertIsNone(first['note']['annotation_id'])
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.reading_annotations WHERE project_id=%s',(self.project,)).fetchone()['n'],0)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.records WHERE project_id=%s',(self.project,)).fetchone()['n'],1)
            bound=reader.binding(c,**self.values,actor='owner')
            self.assertEqual(bound['document']['text_body'],quran_reader.representation('itani-god',4,59,59)['text'])
            arabic=reader.binding(c,**{**self.values,'resource_key':'tanzil-uthmani'},actor='owner')
            self.assertNotEqual(arabic['document']['id'],bound['document']['id'])
            quote=bound['document']['text_body'][:10]
            passage=passage_store.create_annotation(c,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=bound['document']['id'],text_sha256=bound['document']['text_sha256'],start=0,end=10,exact=quote,capture_kind='comment',body='Exact note',actor='owner')
            self.assertEqual(passage['document_id'],bound['document']['id'])
            note=first['note']
            updated=notebook.update(c,project_id=self.project,entry_id=note['id'],expected_revision=1,thought_type='note',title=note['title'],body='A later thought',links=[],state='active',actor='owner')
            old=reader.create_note(c,**self.values,request_uuid=request,body='**My thought**, not evidence.',actor='owner')
            self.assertEqual(old['note']['body'],updated['body'])
            with self.assertRaises(self.db.RevisionConflict):reader.create_note(c,**self.values,request_uuid=request,body='Different creation',actor='owner')

    def test_failed_first_note_rolls_back_binding(self):
        with self.db.connect(self.owner_dsn) as c:
            with self.assertRaises(ValueError):reader.create_note(c,**self.values,request_uuid=str(uuid.uuid4()),body='',actor='owner')
            self.assertIsNone(reader.existing(c,**self.values))

    def test_surah_and_whole_source_are_not_fabricated_passages(self):
        with self.db.connect(self.owner_dsn) as c:
            for scope in ('surah','source'):
                result=reader.create_note(c,**self.values,note_scope=scope,request_uuid=str(uuid.uuid4()),body='A personal whole-context note',actor='owner')
                self.assertIsNone(result['note']['document_id'])
                self.assertIsNone(result['note']['annotation_id'])
                self.assertIsNone(result['note']['reading_position'])
                self.assertEqual(result['note']['quran_context']['note_scope'],scope)
                self.assertEqual(len(reader.notes(c,project_id=self.project,resource_key='itani-god',chapter=4,note_scope=scope)),1)
                self.assertEqual(len(reader.notes(c,project_id=self.project,resource_key='tanzil-uthmani',chapter=4,note_scope=scope)),0)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.reading_documents WHERE project_id=%s',(self.project,)).fetchone()['n'],0)

    def test_ranges_bounds_and_private_resume_conflict(self):
        with self.db.connect(self.owner_dsn) as c:
            bound=reader.binding(c,**{**self.values,'ayah_end':60},actor='owner')
            self.assertEqual(bound['reference']['ayah_end'],60)
            self.assertEqual(len(bound['document']['text_body'].splitlines()),2)
            first=reader.save_place(c,project_id=self.project,resource_key='itani-god',chapter=4,ayah=59,expected_revision=0,actor='owner')
            same=reader.save_place(c,project_id=self.project,resource_key='itani-god',chapter=4,ayah=59,expected_revision=0,actor='owner')
            self.assertEqual(first['revision'],same['revision'])
            with self.assertRaises(self.db.RevisionConflict):reader.save_place(c,project_id=self.project,resource_key='itani-god',chapter=4,ayah=60,expected_revision=0,actor='owner')
            with self.assertRaises(ValueError):reader.binding(c,**{**self.values,'chapter':114,'ayah_start':6,'ayah_end':7},actor='owner')
        with self.db.connect(self.public_dsn) as c:
            with self.assertRaises(Exception):c.execute('SELECT * FROM research.quran_places')
