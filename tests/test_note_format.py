import json
from pathlib import Path
import shutil
import subprocess
import unittest

from islam_research.note_format import content, digest, parse_note, render_note


class NoteFormatTests(unittest.TestCase):
    def setUp(self):
        self.record = {"id": "urn:test:source", "project_id": "test-project", "title": "Synthetic tafsīr — التفسير",
            "attributes": {"rdf_properties": {"http://purl.org/dc/terms/source": ["<https://example.invalid/source>"],
                "https://islam-research.local/vocab/locator": ['"Section 2"@en']},
                "recorded_review_status": ["Synthetic excerpt only; not full argument"]}}
        self.state = {"record_id": self.record["id"], "project_id": self.record["project_id"], "revision": 3,
                      "reading": "reading", "decision": "read_later", "note": "# My note\n\nUnicode: التفسير; tafsīr.\n---\nA note divider stays in the body.\n"}

    def test_roundtrip_preserves_notes_and_explicit_source_context(self):
        parsed = parse_note(render_note(self.record, self.state))
        self.assertEqual(parsed["state"], {k: v for k, v in self.state.items() if k != "revision"})
        self.assertFalse(parsed["locally_changed"])
        self.assertEqual(parsed["metadata"]["context"]["locators"], ["Section 2"])
        self.assertEqual(parsed["metadata"]["context"]["source_urls"], ["https://example.invalid/source"])
        self.assertIsNone(parsed["metadata"]["context"]["edition"])
        self.assertEqual(parsed["metadata"]["context"]["review_scope"], ["Synthetic excerpt only; not full argument"])

    def test_unsaved_export_retains_the_cloud_base_and_detects_local_edits(self):
        draft = {**self.state, "note": "Changed offline", "reading": "read"}
        parsed = parse_note(render_note(self.record, draft, base_state=self.state))
        self.assertTrue(parsed["locally_changed"])
        self.assertEqual(parsed["metadata"]["base_sha256"], digest(content(self.state)))
        self.assertEqual(parsed["metadata"]["base_revision"], 3)
        self.assertEqual(parsed["state"]["note"], "Changed offline")

    def test_invalid_metadata_duplicate_keys_yaml_tags_and_context_edits_fail(self):
        text = render_note(self.record, self.state)
        for changed in [text.replace("research_note_version: 1", "research_note_version: 2"),
                        text.replace("base_revision: 3", "base_revision: true"),
                        text.replace('reading: "reading"', 'reading: !!python/object:unsafe {}'),
                        text.replace('"locators":["Section 2"]', '"locators":["Unreviewed substitution"]'),
                        text.replace('reading: "reading"', 'reading: "reading"\nreading: "read"'),
                        text.replace('"edition":null', '"edition":NaN'),
                        text.replace('"edition":null', '"edition":null,"edition":null')]:
            with self.assertRaises(ValueError):
                parse_note(changed)

    def test_body_limits_and_line_endings_have_explicit_semantics(self):
        state = {**self.state, "note": "Line one\r\nLine two"}
        self.assertEqual(parse_note(render_note(self.record,state))["state"]["note"], "Line one\nLine two")
        for note in ["a"*10001, "Nul\x00", None]:
            with self.assertRaises(ValueError):
                render_note(self.record,{**self.state,"note":note})
        with self.assertRaises(ValueError):
            parse_note("---\nunknown: 1\n---\n\n")

    @unittest.skipUnless(shutil.which("node"), "Node is needed for browser/Python interchange verification")
    def test_browser_and_python_produce_identical_markdown_and_base_hashes(self):
        module = (Path(__file__).resolve().parents[1] / "web/src/workspaceClient.js").as_uri()
        program = """import fs from 'node:fs';
            import {webcrypto} from 'node:crypto';
            globalThis.crypto ||= webcrypto;
            const {markdownDraft}=await import(process.argv[1]);
            const data=JSON.parse(fs.readFileSync(0,'utf8'));
            process.stdout.write(await markdownDraft(data.record,data.entry));"""
        draft = {**self.state, "note": "An unsaved browser edit.\n"}
        result = subprocess.run([shutil.which("node"), "--input-type=module", "-e", program, module],
            input=json.dumps({"record": self.record, "entry": {"server": self.state, "draft": draft}}),
            text=True, capture_output=True, check=True, timeout=10)
        self.assertEqual(result.stdout, render_note(self.record,draft,base_state=self.state))
        self.assertTrue(parse_note(result.stdout)["locally_changed"])
