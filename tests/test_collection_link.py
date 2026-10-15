import os
import unittest
import uuid

from islam_research.reader_collection import collection_resource


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class CollectionLinkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,collection_link,passage_store,source_intake,verse_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.links,cls.passages,cls.intakes,cls.verses,cls.sql=db,collection_link,passage_store,source_intake,verse_store,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];cls.owner='collection_owner_'+uuid.uuid4().hex;cls.publisher='collection_reader_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.publisher):connection.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner);cls.publisher_dsn=make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.publisher):
                connection.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project='test:'+uuid.uuid4().hex;self.collection=collection_resource()
        with self.db.connect(self.owner_dsn) as connection:self.db.create_project(connection,self.project,'Bounded located collection link test')

    def intake(self,connection,reading_id,**patch):
        from test_source_intake import payload
        reading=next(r for r in self.collection['readings'] if r['id']==reading_id);source=next(s for s in self.collection['sources'] if s['id']==reading['source_id'])
        values=payload(self.project,title=source['title'],creators=source['creators'],edition=source['edition'],identifier='',language=source['language'],source_url=source['source_url'],
            source_role='translation' if reading['material_kind']=='translation' else 'commentary',access_status='open',coverage_scope='selected_passage',
            rights_status='public_domain' if source['rights']['status']=='public_domain_us' else 'permitted_excerpt',rights_basis=source['rights']['basis'],
            distinct_source_rationale='Separate test receipt for its exact located representation',
            excerpt=dict(text=reading['text'],edition=source['edition'],locator=reading['locator'],representation_url=source['source_url']),actor='owner',**patch)
        return self.intakes.create(connection,**values)

    def link(self,connection,reading_id,document_id,**patch):
        return self.links.link(connection,**{**dict(project_id=self.project,reading_id=reading_id,document_id=document_id,request_uuid=str(uuid.uuid4()),rationale='Explicit owner alignment of this located collection quotation',actor='owner'),**patch})

    def counts(self,connection):
        return tuple(connection.execute('SELECT count(*) AS n FROM research.'+table+' WHERE project_id=%s',(self.project,)).fetchone()['n'] for table in ['reading_annotations','verse_materials'])

    def test_actual_rodwell_arabic_and_english_commentary_quotes_have_correct_roles(self):
        with self.db.connect(self.owner_dsn) as connection:
            for reading in self.collection['readings']:
                imported=self.intake(connection,reading['id']);saved=self.link(connection,reading['id'],imported['document_id'])
                row=self.verses.get_material(connection,self.project,saved['material_id'])
                self.assertEqual(row['selected_quote'],reading['text']);self.assertEqual(row['material_kind'],reading['material_kind'])
                self.assertEqual(row['link_kind'],'representation' if reading['material_kind']=='translation' else 'discussion')
                self.assertEqual(row['source_record_id'],imported['record_id']);self.assertEqual(row['citation_basis'],'none')
                self.assertEqual(row['review_state'],'pending');self.assertEqual(row['assertion_text'],'')
                annotation=self.passages.annotation(connection,self.project,saved['annotation_id'])['annotation']
                self.assertEqual(annotation['mark_style'],'none');self.assertEqual(annotation['body'],'')
                target=reading['reference'];matches=self.verses.for_verse(connection,self.project,target['chapter'],target['ayah_start'],target['ayah_end'],reading['material_kind'],row['link_kind'],'',26)
                self.assertIn(saved['material_id'],[m['id'] for m in matches])

    def test_retry_after_note_and_material_edit_preserves_both_histories(self):
        with self.db.connect(self.owner_dsn) as connection:
            imported=self.intake(connection,'rodwell-4-59');request=str(uuid.uuid4())
            first=self.link(connection,'rodwell-4-59',imported['document_id'],request_uuid=request)
            self.assertEqual(first,self.link(connection,'rodwell-4-59',imported['document_id'],request_uuid=request))
            self.passages.update_annotation(connection,annotation_id=first['annotation_id'],project_id=self.project,expected_revision=1,body='My later private reading note',mark_style='underline',actor='owner')
            row=self.verses.get_material(connection,self.project,first['material_id'])
            metadata={key:row[key] for key in self.verses.MUTABLE};metadata.update(reading_note='My later material correction',state='withdrawn')
            revised=self.verses.update(connection,project_id=self.project,material_id=row['id'],expected_revision=1,actor='owner',**metadata)
            retry=self.link(connection,'rodwell-4-59',imported['document_id'],request_uuid=request)
            self.assertEqual(retry['material_id'],first['material_id']);self.assertEqual(retry['revision'],2)
            self.assertEqual(self.passages.annotation(connection,self.project,first['annotation_id'])['annotation']['body'],'My later private reading note')
            self.assertEqual(self.verses.get_material(connection,self.project,first['material_id'])['reading_note'],revised['reading_note'])
            alternate=self.intake(connection,'rodwell-4-59');different_reading=self.intake(connection,'rodwell-4-83')
            baseline=self.counts(connection)
            for patch in [dict(rationale='Changed original request'),dict(reading_id='rodwell-4-83'),dict(document_id=alternate['document_id']),
                          dict(reading_id='rodwell-4-83',document_id=different_reading['document_id']),dict(document_id='other'),dict(project_id='other')]:
                args=dict(reading_id='rodwell-4-59',document_id=imported['document_id'],request_uuid=request);args.update(patch)
                with self.subTest(patch=patch),self.assertRaises(ValueError):self.link(connection,**args)
                self.assertEqual(self.counts(connection),baseline)
            self.assertEqual(connection.execute('SELECT count(*) AS n FROM research.reading_annotation_revisions WHERE annotation_id=%s',(first['annotation_id'],)).fetchone()['n'],2)
            self.assertEqual(len(self.verses.history(connection,self.project,first['material_id'],None,25)),2)

    def test_wrong_edition_locator_text_url_source_or_reading_writes_nothing(self):
        with self.db.connect(self.owner_dsn) as connection:
            imported=self.intake(connection,'rodwell-4-59');document=self.passages.get_document(connection,self.project,imported['document_id'])
            for patch in [dict(edition='Wrong edition'),dict(locator='Wrong passage'),dict(text='Changed words'),dict(representation_url='https://example.invalid/wrong')]:
                wrong=self.passages.create_document(connection,project_id=self.project,source_record_id=imported['record_id'],edition=patch.get('edition',document['edition']),
                    locator=patch.get('locator',document['locator']),text=patch.get('text',document['text_body']),representation_url=patch.get('representation_url',document['representation_url']),actor='owner')
                with self.subTest(patch=patch),self.assertRaises(ValueError):self.link(connection,'rodwell-4-59',wrong['id'])
                self.assertEqual(self.counts(connection),(0,0))
            other='test:'+uuid.uuid4().hex;self.db.save_record(connection,record_id=other,project_id=self.project,kind='source',title='Unidentified source with copied text',actor='owner')
            wrong=self.passages.create_document(connection,project_id=self.project,source_record_id=other,edition=document['edition'],locator=document['locator'],text=document['text_body'],representation_url=document['representation_url'],actor='owner')
            with self.assertRaises(ValueError):self.link(connection,'rodwell-4-59',wrong['id'])
            with self.assertRaises(ValueError):self.link(connection,'unknown-reading',imported['document_id'])
            self.assertEqual(self.counts(connection),(0,0))

    def test_prior_capture_uuid_cannot_be_repurposed_and_concurrent_retry_has_one_identity(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        with self.db.connect(self.owner_dsn) as connection:
            imported=self.intake(connection,'tabari-authority-4-59');document=self.passages.get_document(connection,self.project,imported['document_id']);old=str(uuid.uuid4())
            self.passages.create_annotation(connection,annotation_uuid=old,project_id=self.project,document_id=document['id'],text_sha256=document['text_sha256'],start=0,end=len(document['text_body']),
                exact=document['text_body'],capture_kind='comment',body='',mark_style='none',actor='owner')
            with self.assertRaises(ValueError):self.link(connection,'tabari-authority-4-59',document['id'],request_uuid=old)
            self.assertEqual(self.counts(connection),(1,0))
        request=str(uuid.uuid4());barrier=threading.Barrier(2)
        def attempt(_):
            with self.db.connect(self.owner_dsn) as connection:
                barrier.wait(timeout=10);return self.link(connection,'tabari-authority-4-59',document['id'],request_uuid=request)
        with ThreadPoolExecutor(max_workers=2) as executor:rows=list(executor.map(attempt,[0,1]))
        self.assertEqual(rows[0],rows[1])
        with self.db.connect(self.owner_dsn) as connection:self.assertEqual(self.counts(connection),(2,1))
