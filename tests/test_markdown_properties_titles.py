"""Synthetic title derivation; never connect to the owner database."""
import unittest
from islam_research.workspace_store import derived_title


class MarkdownTitles(unittest.TestCase):
    def test_properties_are_not_automatic_page_titles(self):
        for newline in ('\n','\r\n'):
            body=newline.join(['---','type: skill','tags: [reading]','---','','# Synthetic reading','Text'])
            self.assertEqual(derived_title(body),'Synthetic reading')
        self.assertEqual(derived_title('---\ntype: skill'),'Untitled note')
        self.assertEqual(derived_title('---\ntype: [unfinished\n---\n# محفوظ'),'محفوظ')
        self.assertEqual(derived_title('ordinary writing\n---'),'ordinary writing')
