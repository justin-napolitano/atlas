"""Portable synthetic pages only; no filesystem, owner state or live GitHub."""
import json
import os
import unittest
import uuid
from islam_research import vault_format as vault,database as db,workspace_store as workspace


def page(**patch):
    return dict(id=vault.PREFIX+str(uuid.uuid4()),title='Synthetic note',title_mode='manual',thought_type='note',
                body='# Synthetic note\r\n\r\nالعربية 😀 `literal`\n',state='active',links=[],**patch)


class VaultFormatTests(unittest.TestCase):
    def test_exact_unicode_markdown_unknown_frontmatter_and_identity(self):
        value=page();value['body']='---\ntype: note # retained\ncustom: [yes, 2026-10-21]\n---\n'+value['body']
        encoded=vault.encode_page(value);manifest,body=vault.paths(value['id'])
        self.assertEqual(encoded[body],value['body'].encode('utf-8'))
        decoded=vault.decode_page(manifest,encoded[manifest],body,encoded[body]);self.assertEqual(decoded,value)
        self.assertEqual(vault.fingerprint(decoded),vault.fingerprint(value))
        external=encoded[body].replace(b'type: note',b'type: skill')
        self.assertEqual(vault.decode_page(manifest,encoded[manifest],body,external)['thought_type'],'skill')
        automatic=page();automatic.update(title_mode='automatic',body='# New opening')
        files=vault.encode_page(automatic);m,b=vault.paths(automatic['id'])
        self.assertEqual(vault.decode_page(m,files[m],b,files[b])['title'],'New opening')

    def test_invalid_yaml_never_executes_or_applies_a_classification(self):
        for header in ['type: &a skill\ntags: [*a]','type: skill\ntype: principle','type: !!python/object:example skill','type: [skill','x: '+ '['*20+'a'+']'*20]:
            self.assertIsNone(vault.known_frontmatter_type('---\n'+header+'\n---\nWriting'),header)
        self.assertIsNone(vault.known_frontmatter_type('---\ntype: skill'))
        self.assertIsNone(vault.known_frontmatter_type('---\nx: '+ 'a'*8200+'\ntype: skill\n---'))
        self.assertEqual(vault.known_frontmatter_type('---\ntags: [yes, false, 2026-10-21]\ntype: skill\n---'),'skill')

    def test_paths_versions_sizes_duplicates_and_source_dependencies_fail_closed(self):
        value=page();files=vault.encode_page(value);m,b=vault.paths(value['id']);metadata=json.loads(files[m])
        for changed in [dict(format=2),dict(path='../escape.md'),dict(extra='ignored?'),dict(thought_type='source_claim')]:
            with self.assertRaises(ValueError):vault.decode_page(m,json.dumps({**metadata,**changed}).encode(),b,files[b])
        for path in ['../'+b,b.replace('notes/','notes/../notes/'),b.upper()]:
            with self.assertRaises(ValueError):vault.decode_page(m,files[m],path,files[b])
        with self.assertRaises(ValueError):vault.decode_page(m,b'{"format":1,"format":1}',b,files[b])
        with self.assertRaises(ValueError):vault.decode_page(m,files[m],b,b'\xff')
        with self.assertRaises(ValueError):vault.decode_page(m,files[m],b,b'x'*80001)
        with self.assertRaises(ValueError):vault.encode_page({**value,'annotation_id':'synthetic:annotation'})
        with self.assertRaises(ValueError):vault.encode_page({**value,'project_id':'synthetic:legacy'})
        with self.assertRaises(ValueError):vault.encode_page({**value,'trashed':True})
        with self.assertRaises(ValueError):vault.encode_page({**value,'links':[dict(kind='record',id='synthetic:source',rationale='Context')]})


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class VaultImportTests(unittest.TestCase):
    def setUp(self):self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def test_fresh_closed_graph_preserves_exact_pages_and_reimport_is_noop(self):
        a=page();b=page();a['thought_type']='skill';b['thought_type']='principle'
        a['links']=[dict(kind='entry',id=b['id'],rationale='Markdown page link')]
        b['links']=[dict(kind='entry',id=a['id'],rationale='Personal context')]
        result=vault.import_new_pages(self.c,[a,b],actor='synthetic:vault')
        self.assertEqual(set(result['created']),{a['id'],b['id']})
        revisions={}
        for value in [a,b]:
            row=workspace.note(self.c,value['id']);revisions[row['id']]=row['revision']
            for key in value:self.assertEqual(row[key],value[key],key)
            self.assertIsNone(row['project_id']);self.assertIsNone(row['annotation_id'])
        self.assertEqual(vault.import_new_pages(self.c,[a,b],actor='synthetic:vault')['created'],[])
        self.assertEqual({key:workspace.note(self.c,key)['revision'] for key in revisions},revisions)
        with self.assertRaises(ValueError):vault.import_new_pages(self.c,[{**a,'body':'Competing version'},b],actor='synthetic:vault')
        self.assertEqual(workspace.note(self.c,a['id'])['body'],a['body'])
    def test_missing_dependency_rolls_back_entire_import(self):
        a=page();b=page();b['links']=[dict(kind='entry',id=vault.PREFIX+str(uuid.uuid4()),rationale='Missing')]
        with self.assertRaises(ValueError):vault.import_new_pages(self.c,[a,b],actor='synthetic:vault')
        self.assertIsNone(workspace.note(self.c,a['id']));self.assertIsNone(workspace.note(self.c,b['id']))
