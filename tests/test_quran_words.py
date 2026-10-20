from copy import deepcopy
from email.message import Message
from io import BytesIO
import json
import re
import unittest
from unittest.mock import Mock, patch

from islam_research import quran_words as words
from islam_research.quran_reader import representation


def fixture():
    text = representation('tanzil-uthmani', 4, 59, 59)['text']
    tokens = [t for t in re.findall(r'\S+', text) if words.letters(t)]
    return {'verse': {'verse_key': '4:59', 'words': [dict(position=i, char_type_name='word',
        text_uthmani=t, translation={'text': f'Synthetic gloss {i}', 'language_name': 'english'})
        for i, t in enumerate(tokens, 1)] + [dict(char_type_name='end', text_uthmani='٥٩')]}}


class QuranWordTests(unittest.TestCase):
    def setUp(self):
        words._cache.clear()

    def test_alignment_preserves_exact_arabic_and_rejects_wrong_source(self):
        value = fixture()
        aligned = words.align(value, 4, 59)
        text = representation('tanzil-uthmani', 4, 59, 59)['text']
        for item in aligned['words']:
            self.assertEqual(text[item['start']:item['end']], item['arabic'])
        # Provider differences in ornamental elongation do not rewrite our text.
        value['verse']['words'][0]['text_uthmani'] = value['verse']['words'][0]['text_uthmani'].replace('يَ', 'يَـ', 1)
        self.assertEqual(words.align(value, 4, 59)['words'], aligned['words'])
        for mutate in (
            lambda x: x['verse'].update(verse_key='4:60'),
            lambda x: x['verse']['words'].pop(0),
            lambda x: x['verse']['words'][0].update(text_uthmani='خطأ'),
            lambda x: x['verse']['words'][0].update(position=2),
            lambda x: x['verse']['words'][0]['translation'].update(language_name='other'),
            lambda x: x['verse']['words'][0]['translation'].update(text=''),
        ):
            bad = deepcopy(value); mutate(bad)
            with self.assertRaises(ValueError): words.align(bad, 4, 59)

    def test_bounded_cache_no_redirects_and_validation_before_network(self):
        headers = Message(); headers['Content-Type'] = 'application/json'
        def response():
            value = BytesIO(json.dumps(fixture()).encode()); value.headers = headers
            return value
        opener = Mock(); opener.open.side_effect = lambda *args, **kwargs: response()
        with patch.object(words, 'build_opener', return_value=opener):
            first = words.lookup(4, 59); first['words'][0]['translation'] = 'changed locally'
            self.assertNotEqual(words.lookup(4, 59), first)
            self.assertEqual(opener.open.call_count, 1)
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, words.SOURCE+'4:59?words=true&word_fields=text_uthmani&language=en')
            self.assertEqual(opener.open.call_args.kwargs['timeout'], 8)
            for invalid in ((0, 1), (114, 7)):
                with self.assertRaises(ValueError): words.lookup(*invalid)
            self.assertEqual(opener.open.call_count, 1)
            with patch.object(words, 'monotonic', return_value=10**20): words.lookup(4, 59)
            self.assertEqual(opener.open.call_count, 2)
        with self.assertRaises(ValueError): words.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid')
