import unittest
from hashlib import sha256
from islam_research import quran_reader as reader
from islam_research.quran_citations import AYAH_COUNTS


class QuranReaderTests(unittest.TestCase):
    def test_real_pinned_complete_corpus_and_reference_identity(self):
        self.assertEqual(sum(AYAH_COUNTS),6236)
        from islam_research.quran_resources import pilot_resource
        pilot=pilot_resource();arabic=reader._load('tanzil-uthmani')[1]
        self.assertEqual(arabic['resource_id'],pilot['resource_id'])
        self.assertEqual(arabic['source_notice'],pilot['source_notice'])
        for key in reader.RESOURCES:
            verses,resource=reader._load(key)
            self.assertEqual(len(verses),6236)
            self.assertTrue(resource['source_notice'])
            self.assertIn('http',resource['license_url'])
        for c in (1,4,114):
            chapter=reader.chapter(c)
            self.assertEqual(len(chapter['verses']),AYAH_COUNTS[c-1])
            for row in chapter['verses']:
                self.assertEqual(row['reference']['chapter'],c)
                for kind in ('arabic','translation'):
                    self.assertEqual(row[kind]['text_sha256'],sha256(row[kind]['text'].encode()).hexdigest())
        original=reader.chapter(4)['verses'][58]
        self.assertEqual(reader.representation('itani-god',4,59,59)['text'],original['translation']['text'])
        # Callers may decorate response metadata without mutating the cached authority.
        reader.chapter(1)['resources'][0]['label']='Changed UI label'
        self.assertNotEqual(reader.catalog()['resources'][0]['label'],'Changed UI label')

    def test_changed_duplicate_missing_bytes_fail_closed(self):
        for raw in (b'1|1|text\n',b'1|1|text\n1|1|other\n'):
            with self.assertRaises(ValueError):reader.parse(raw,sha256(raw).hexdigest())
        with self.assertRaises(ValueError):reader.parse(b'changed','0'*64)
        for args in ((0,),(115,),(4,'khattab')):
            with self.assertRaises(ValueError):reader.chapter(*args)
        for args in (('itani-god',4,176,177),('wrong',4,59,59)):
            with self.assertRaises(ValueError):reader.representation(*args)
