import os
import unittest
import uuid
from unittest.mock import patch
from test_shared_library import synthetic_source
from islam_research import database as db,shared_library as library,library_shelf as shelf,passage_store,reading_desk


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class LibraryShelfTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
        self.project,self.source,_=synthetic_source(db,self.c,title='Shelf العربية book')
        self.doc=passage_store.create_document(self.c,project_id=self.project,source_record_id=self.source,edition='Edition A',locator='Chapter 2',representation_url='',text='A synthetic paragraph. Another paragraph.',actor='synthetic')
        self.alias=library.index_source(self.c,project_id=self.project,source_record_id=self.source,expected_source_revision=1,request_uuid=str(uuid.uuid4()),actor='synthetic')
        self.item=library.get(self.c,self.alias['item_id'])
        self.edition=library.resolve(self.c,item_id=self.item['id'],document_id=self.doc['id'])['edition_id']
    def tearDown(self):self.c.close()
    def save(self,**patch_value):
        self.item=library.update_item(self.c,item_id=self.item['id'],expected_revision=self.item['revision'],on_shelf=patch_value.get('on_shelf',True),reading_status=patch_value.get('reading_status','want_to_read'),preferred_edition_id=patch_value.get('preferred_edition_id',self.edition),actor='synthetic')
    def test_real_shelf_filters_counts_choice_resume_and_removal(self):
        self.assertEqual(shelf.page(self.c,project_id=self.project)['items'],[])
        self.save(preferred_edition_id=None)
        row=shelf.page(self.c,project_id=self.project)['items'][0]
        self.assertEqual(row['availability'],'choose_edition');self.assertEqual(row['note_count'],0)
        self.save()
        self.assertEqual(shelf.page(self.c,project_id=self.project,q='العربية')['items'][0]['availability'],'read')
        self.assertEqual(shelf.page(self.c,project_id=self.project,state='finished')['items'],[])
        self.assertEqual(shelf.page(self.c,project_id=self.project,continuing=True)['items'],[])
        reading_desk.save(self.c,project_id=self.project,record_id=self.source,document_id=self.doc['id'],annotation_id=None,start=2,end=2,expected_revision=0,actor='synthetic')
        row=shelf.page(self.c,project_id=self.project,continuing=True)['items'][0]
        self.assertEqual(row['reading_status'],'reading');self.assertEqual(row['position'],2);self.assertEqual(row['locator'],'Chapter 2')
        self.item=library.get(self.c,self.item['id']);self.save(reading_status='finished')
        reading_desk.save(self.c,project_id=self.project,record_id=self.source,document_id=self.doc['id'],annotation_id=None,start=4,end=4,expected_revision=1,actor='synthetic')
        self.assertEqual(library.get(self.c,self.item['id'])['reading_status'],'finished')
        self.save(on_shelf=False)
        self.assertEqual(shelf.page(self.c,project_id=self.project)['items'],[])
        self.assertIsNotNone(passage_store.get_document(self.c,self.project,self.doc['id']))
    def test_cursor_project_isolation_and_other_edition_do_not_fake_resume(self):
        self.save()
        source='synthetic:source:'+uuid.uuid4().hex
        db.save_record(self.c,project_id=self.project,record_id=source,kind='source',title='Second shelf book',actor='synthetic')
        alias=library.index_source(self.c,project_id=self.project,source_record_id=source,expected_source_revision=1,request_uuid=str(uuid.uuid4()),actor='synthetic')
        library.update_item(self.c,item_id=alias['item_id'],expected_revision=1,on_shelf=True,reading_status='reading',preferred_edition_id=None,actor='synthetic')
        page=shelf.page(self.c,project_id=self.project,limit=1);self.assertIsNotNone(page['next_cursor'])
        next_page=shelf.page(self.c,project_id=self.project,limit=1,cursor=page['next_cursor'])
        self.assertNotEqual(page['items'][0]['id'],next_page['items'][0]['id'])
        self.assertEqual(shelf.page(self.c,project_id='nonmember')['items'],[])
        with self.assertRaises(ValueError):shelf.page(self.c,cursor='not valid')
        another=passage_store.create_document(self.c,project_id=self.project,source_record_id=self.source,edition='Edition B',locator='Chapter 2',representation_url='',text='Other wording.',actor='synthetic')
        reading_desk.save(self.c,project_id=self.project,record_id=self.source,document_id=another['id'],annotation_id=None,start=0,end=0,expected_revision=0,actor='synthetic')
        self.assertEqual(library.get(self.c,self.item['id'])['reading_status'],'want_to_read')
        self.assertEqual(shelf.page(self.c,project_id=self.project,continuing=True)['items'],[])

    def retain_bound(self,bound):
        source=bound['record_id'];row=db.get_record(self.c,source)
        alias=library.index_source(self.c,project_id=self.project,source_record_id=source,expected_source_revision=row['revision'],request_uuid=str(uuid.uuid4()),actor='synthetic')
        item=library.get(self.c,alias['item_id']);edition=library.resolve(self.c,item_id=item['id'],document_id=bound['document']['id'])['edition_id']
        return library.update_item(self.c,item_id=item['id'],expected_revision=1,on_shelf=True,reading_status='want_to_read',preferred_edition_id=edition,actor='synthetic')

    def test_quran_and_gutenberg_use_confirmed_native_places_and_same_selected_version(self):
        from islam_research import quran_workspace,gutenberg_store
        from test_gutenberg import book
        quran=quran_workspace.binding(self.c,project_id=self.project,resource_key='itani-god',chapter=4,ayah_start=59,ayah_end=59,actor='synthetic')
        qitem=self.retain_bound(quran)
        quran_workspace.save_place(self.c,project_id=self.project,resource_key='itani-god',chapter=4,ayah=83,expected_revision=0,actor='synthetic')
        rows=shelf.page(self.c,project_id=self.project,continuing=True)['items']
        row=next(r for r in rows if r['id']==qitem['id'])
        self.assertEqual(row['reader'],'quran');self.assertEqual(row['resume_ayah'],83)
        self.assertEqual(row['resource_key'],'itani-god');self.assertEqual(row['reading_status'],'reading')
        value=gutenberg_store.cache(self.c,book())
        bound=gutenberg_store.binding(self.c,project_id=self.project,book_id=value['book_id'],version=value['version'],section=0,actor='synthetic')
        gitem=self.retain_bound(bound)
        row=next(r for r in shelf.page(self.c,project_id=self.project)['items'] if r['id']==gitem['id'])
        self.assertEqual(row['reader'],'gutenberg');self.assertEqual(row['book_section'],0)
        self.assertEqual(row['book_version'],value['version'])
        gutenberg_store.save_place(self.c,project_id=self.project,book_id=value['book_id'],version=value['version'],section=1,position=2,expected_revision=0,actor='synthetic')
        row=next(r for r in shelf.page(self.c,project_id=self.project,continuing=True)['items'] if r['id']==gitem['id'])
        self.assertEqual(row['book_section'],1);self.assertEqual(row['book_position'],2)

class ShelfCursorTests(unittest.TestCase):
    def test_malformed_cursor_is_rejected(self):
        for value in ['bad','e30','WzEsMl0','W10']:
            with self.assertRaises(ValueError):shelf._cursor(value)
