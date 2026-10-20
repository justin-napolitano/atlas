import hashlib
import os
import unittest
import uuid
from unittest.mock import patch

from islam_research import gutenberg as provider


def metadata(book_id=1497):
    return dict(provider='gutenberg',book_id=book_id,title='Synthetic philosophy',creators=['Synthetic author'],
                translators=[],languages=['en'],rights='Public domain in the USA.',release_date='2020-01-01',modified='',
                source_url=f'https://www.gutenberg.org/ebooks/{book_id}',availability='read',
                representation_url=f'https://gutenberg.pglaf.org/cache/epub/{book_id}/pg{book_id}.txt',
                edition=f'Project Gutenberg digital ebook #{book_id}; original print edition unverified',
                attribution='Synthetic Gutenberg attribution',rights_notice='Synthetic public-domain fixture',
                license_url='https://www.gutenberg.org/policy/license.html')


def book(text='CHAPTER I\n\nA synthetic thought about justice.\n\nCHAPTER II\n\nملاحظة é 😀\n'):
    return provider.parse_book(metadata(),('Synthetic header\r\n*** START OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\r\n'+text+
        '\r\n*** END OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\r\nSynthetic license').encode())


class GutenbergTests(unittest.TestCase):
    def test_search_skips_navigation_and_does_not_follow_untrusted_links(self):
        raw=b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://www.gutenberg.org/ebooks/authors/search.opds/?query=a</id><title>Authors</title></entry>
        <entry><id>https://www.gutenberg.org/ebooks/1497.opds</id><title>The Republic</title><content>Plato</content></entry>
        <entry><id>https://evil.invalid/ebooks/2.opds</id><title>Unsafe</title></entry><link rel="next" href="http://127.0.0.1/private"/></feed>'''
        result=provider.parse_search(raw,'Plato',1)
        self.assertEqual([r['book_id'] for r in result['items']],[1497])
        self.assertEqual(result['next_page'],2)  # rebuilt from query + validated integer

    def test_xml_entity_utf16_and_identity_attacks_rejected(self):
        for raw in [b'<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed/>',
                    '<!DOCTYPE feed><feed/>'.encode('utf-16'),b'<feed>\x00</feed>']:
            with self.assertRaises(provider.Unavailable):provider._xml(raw)
        with self.assertRaises(provider.Unavailable):provider.parse_metadata(b'<x/>',1497)
        with self.assertRaises(ValueError):provider._fetch('http://127.0.0.1/private',10)
        with self.assertRaises(ValueError):provider._fetch('https://www.gutenberg.org/ebooks/1497',10)

    def test_all_body_unicode_preserved_and_bounded_without_inventing_pages(self):
        text='CHAPTER I\n\n'+('An exact paragraph é 😀.\n\n'*1300)+'CHAPTER II\n\nنص\n'
        value=book(text)
        self.assertEqual(''.join(c['text'] for c in value['sections']),text+'\n')
        self.assertTrue(all(0<len(c['text'])<=10000 for c in value['sections']))
        for c in value['sections']:
            self.assertEqual(c['text_sha256'],hashlib.sha256(c['text'].encode()).hexdigest())
        self.assertIn('Synthetic license',value['source_notice'])
        self.assertNotIn('Synthetic header',value['sections'][0]['text'])

    def test_unsupported_or_oversized_text_fails_honestly(self):
        for raw in [b'<html>not a text ebook</html>',b'\xff',b'\x00',b'x'*(provider.MAX_BYTES+1)]:
            with self.assertRaises(provider.Unavailable):provider.parse_book(metadata(),raw)

    def test_cache_serializes_and_reuses_provider_requests(self):
        provider._cache.clear()
        with patch.object(provider,'_fetch',return_value=b'<feed xmlns="http://www.w3.org/2005/Atom"/>') as fetch:
            provider.search('synthetic');provider.search('synthetic')
            self.assertEqual(fetch.call_count,1)
        for query in ['', 'x'*201, '\nsecret']:
            with self.assertRaises(ValueError):provider.search(query)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class GutenbergDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.sql=db,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL']
        cls.owner,cls.public='books_owner_'+uuid.uuid4().hex,'books_public_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as c:
            db.migrate(c)
            for role in (cls.owner,cls.public):c.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            c.commit();configure(c,cls.owner,cls.public,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner)
        cls.public_dsn=make_conninfo(cls.dsn,user=cls.public)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as c:
            for role in (cls.owner,cls.public):
                c.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                c.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        from islam_research import gutenberg_store as books
        from islam_research.api_store import PostgreSQLStore
        self.books=books;self.store=PostgreSQLStore(self.owner_dsn)
        self.project='gutenberg-test:'+uuid.uuid4().hex
        self.value=book('CHAPTER I\n\nA synthetic thought '+uuid.uuid4().hex+'\n')
        with self.db.connect(self.owner_dsn) as c:
            self.db.create_project(c,self.project,'Synthetic Gutenberg tests')
            books.cache(c,self.value)
        self.binding=dict(project_id=self.project,book_id=1497,version=self.value['version'],section=0)

    def test_browsing_cache_and_resume_do_not_create_membership_or_read_claims(self):
        with self.db.connect(self.owner_dsn) as c:
            doc=self.books.representation(self.value,self.project,0)
            row=self.books.save_place(c,**self.binding,position=4,expected_revision=0,actor='synthetic')
            retry=self.books.save_place(c,**self.binding,position=4,expected_revision=0,actor='synthetic')
            self.assertEqual(row['revision'],retry['revision'])
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.records WHERE project_id=%s',(self.project,)).fetchone()['n'],0)
            with self.assertRaises(self.db.RevisionConflict):self.books.save_place(c,**self.binding,position=8,expected_revision=0,actor='synthetic')
            self.assertEqual(doc['text_sha256'],self.value['sections'][0]['text_sha256'])

    def test_atomic_first_capture_retry_failure_rollback_and_old_version(self):
        with self.db.connect(self.owner_dsn) as c:doc=self.books.representation(self.value,self.project,0)
        fields=dict(annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=doc['id'],text_sha256=doc['text_sha256'],start=0,end=7,exact='WRONG!!',capture_kind='comment',body='Synthetic note',mark_style='highlight')
        with self.assertRaises(ValueError):self.store.gutenberg_write(binding=self.binding,fields=fields,action='annotation',actor='synthetic')
        with self.db.connect(self.owner_dsn) as c:
            self.assertIsNone(self.db.get_record(c,doc['source_record_id']))
        fields['exact']=doc['text_body'][:7]
        row=self.store.gutenberg_write(binding=self.binding,fields=fields,action='annotation',actor='synthetic')
        retry=self.store.gutenberg_write(binding=self.binding,fields=fields,action='annotation',actor='synthetic')
        self.assertEqual(row['id'],retry['id'])
        with self.db.connect(self.owner_dsn) as c:
            newer=book('Changed provider body '+uuid.uuid4().hex)
            self.books.cache(c,newer)
            other=self.books.binding(c,**{**self.binding,'version':newer['version']},actor='synthetic')
            self.assertNotEqual(other['document']['id'],doc['id'])
            original=__import__('islam_research.passage_store',fromlist=['annotation']).annotation(c,self.project,row['id'])
            self.assertTrue(original['anchor']['anchored'])
            source=self.db.get_record(c,doc['source_record_id'])
            self.assertNotEqual(source['review_state'],'human_reviewed')

    def test_project_and_public_boundaries_and_immutable_cache(self):
        from psycopg.errors import InsufficientPrivilege
        with self.db.connect(self.public_dsn) as c:
            with self.assertRaises(InsufficientPrivilege):c.execute('SELECT * FROM research.gutenberg_places')
        with self.db.connect(self.owner_dsn) as c:
            with self.assertRaises(InsufficientPrivilege):c.execute('UPDATE research.gutenberg_books SET payload=%s',(self.db.Jsonb({}),))
        with self.db.connect(self.owner_dsn) as c:
            another='gutenberg-test:'+uuid.uuid4().hex;self.db.create_project(c,another,'Another synthetic project')
            first=self.books.binding(c,**self.binding,actor='synthetic')
            second=self.books.binding(c,**{**self.binding,'project_id':another},actor='synthetic')
            self.assertNotEqual(first['record_id'],second['record_id'])
            self.assertNotEqual(first['document']['id'],second['document']['id'])

    def test_native_workspace_book_binding_and_resume_do_not_require_a_project(self):
        from islam_research import gutenberg_store as store,workspace_store as workspace
        with self.db.connect(self.owner_dsn) as c:
            before=c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n']
            value=store.cache(c,book('A native synthetic reading section.'))
            bound=store.binding(c,project_id=None,book_id=value['book_id'],version=value['version'],section=0,actor='synthetic')
            self.assertIsNone(bound['project_id'])
            note=workspace.create_note(c,request_uuid=str(uuid.uuid4()),body='My native book note.',record_id=bound['record_id'],document_id=bound['document']['id'],reading_position=2,actor='synthetic')
            previous=store.place(c,None,value['book_id'])
            place=store.save_place(c,project_id=None,book_id=value['book_id'],version=value['version'],section=0,position=2,expected_revision=previous['revision'] if previous else 0,actor='synthetic')
            self.assertEqual(place['version'],value['version']);self.assertEqual(place['position'],2)
            self.assertIsNone(note['project_id'])
            self.assertEqual(c.execute('SELECT count(*) AS n FROM research.projects').fetchone()['n'],before)
