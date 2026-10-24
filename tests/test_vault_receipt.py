"""Exact synthetic export coverage and malformed/untrusted snapshot checks."""
import copy
import json
import unittest
import uuid

from islam_research import vault_receipt as receipt,vault_format as codec


class ReceiptTests(unittest.TestCase):
    def snapshot(self):
        note=dict(id=codec.PREFIX+str(uuid.uuid4()),title='Synthetic receipt',title_mode='manual',
                  thought_type='note',body='Synthetic exact Markdown\r\nالعربية 😀',state='active',links=[])
        return note,receipt.make(str(uuid.uuid4()),[dict(id=note['id'],revision=7,action='push',local=note)])

    def test_exact_bytes_identity_revision_and_coverage(self):
        note,value=self.snapshot();encoded=receipt.encode(value)
        decoded=receipt.decode(receipt.path(value['id']),encoded)
        self.assertEqual(decoded['pages'][0]['application_revision'],7)
        self.assertEqual(receipt.verify_page(decoded['pages'][0],codec.encode_page(note)),note)
        self.assertNotIn('commit_sha',decoded)  # A file cannot contain its own Git commit identity.
        files=codec.encode_page(note);files[codec.paths(note['id'])[1]]+=b'!'
        with self.assertRaises(ValueError):receipt.verify_page(decoded['pages'][0],files)

    def test_unknown_versions_wrong_counts_duplicate_ids_and_paths_fail_closed(self):
        _,value=self.snapshot()
        changes=[dict(format=2),dict(format=True),dict(covered_count=0),dict(selected_count=2),dict(pages=value['pages']*2),dict(extra=True),dict(excluded_material=[])]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(ValueError):
                receipt.decode(receipt.path(value['id']),json.dumps({**value,**change}).encode())
        with self.assertRaises(ValueError):receipt.decode('../outside.json',receipt.encode(value))
        with self.assertRaises(ValueError):receipt.decode(receipt.path(value['id']),b'{"format":1,"format":1}')
        malformed=copy.deepcopy(value);malformed['pages'][0]={'id':value['pages'][0]['id'],'application_revision':1,'reason':'Excluded'}
        with self.assertRaises(ValueError):receipt.encode(malformed)
