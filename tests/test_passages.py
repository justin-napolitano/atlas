import copy
import json
import unittest

from islam_research.passages import anchor, normalize_excerpt, resolve_anchor, web_annotation


class PassageAnchorTests(unittest.TestCase):
    def test_emoji_and_arabic_positions_are_unicode_code_points(self):
        text="😀 A note on tafsīr and التفسير."
        start=text.index("tafsīr")
        selected=anchor(text,start,start+6)
        self.assertEqual(selected["exact"],"tafsīr")
        self.assertEqual(selected["start"],12)
        self.assertTrue(resolve_anchor(text,selected)["anchored"])
        self.assertNotEqual(len(text[:start].encode("utf-16-le"))//2,start)

    def test_whole_vocalized_characters_and_joined_emoji_are_required(self):
        for text,start,end in [("بِ",0,1),("بِ",1,2),("👩\u200d💻",0,1),("👍🏽",0,1)]:
            with self.assertRaises(ValueError):
                anchor(text,start,end)
        self.assertEqual(anchor("بِ",0,2)["exact"],"بِ")
        self.assertEqual(anchor("👩\u200d💻",0,3)["exact"],"👩\u200d💻")

    def test_changed_or_ambiguous_text_never_reanchors_itself(self):
        original="One tafsir discussion."
        selected=anchor(original,4,10)
        for text,status in [("A tafsir discussion.","source_changed_requires_review"),
                            ("tafsir then tafsir", "source_changed_ambiguous"),
                            ("No matching term.","source_changed_orphaned")]:
            result=resolve_anchor(text,selected)
            self.assertEqual(result["status"],status)
            self.assertFalse(result["anchored"])
            self.assertNotIn("start",result)

    def test_same_version_cannot_accept_a_tampered_quote_or_offset(self):
        text="A tafsir discussion."
        selected=anchor(text,2,8)
        for key,value in [("start",0),("exact","different"),("prefix","wrong context")]:
            changed=copy.deepcopy(selected); changed[key]=value
            self.assertEqual(resolve_anchor(text,changed)["status"],"invalid_selector")

    def test_empty_invalid_and_oversized_selections_are_rejected(self):
        for start,end in [(True,2),(0,True),(-1,2),(2,1),(0,0),(0,501),(0,1000)]:
            with self.assertRaises(ValueError):
                anchor("x"*600,start,end)
        for text in ["", " ","Nul\x00", "x"*12001]:
            with self.assertRaises(ValueError):
                normalize_excerpt(text)

    def test_normalization_is_explicit_and_does_not_fold_text_variants(self):
        snapshot=normalize_excerpt("Café\r\nCafe\u0301")
        self.assertEqual(snapshot["text"],"Café\nCafe\u0301")
        self.assertNotEqual(snapshot["input_sha256"],snapshot["text_sha256"])
        self.assertNotEqual(normalize_excerpt("Café")["text_sha256"],normalize_excerpt("Cafe\u0301")["text_sha256"])

    def test_web_annotation_keeps_exact_context_and_excludes_the_full_excerpt(self):
        text="PRIVATE WHOLE-EXCERPT MARKER " + "x"*100 + " tafsir " + "z"*100
        start=text.index("tafsir"); selected=anchor(text,start,start+6)
        document={"id":"urn:document:synthetic","source_record_id":"urn:source:synthetic",
                  "edition":"Synthetic edition","locator":"Abstract, sentence 2","representation_url":"https://example.invalid/source",**normalize_excerpt(text)}
        row={"id":"urn:annotation:synthetic",**selected,"start_pos":start,"end_pos":start+6,"created_at":"2026-10-15T00:00:00Z",
             "changed_by":"synthetic-owner","body":"A private observation, not a scholarly definition.","capture_kind":"term_candidate","revision":1}
        exported=web_annotation(document,row)
        self.assertEqual(exported["target"]["source"],document["id"])
        self.assertEqual(exported["target"]["selector"][0]["exact"],"tafsir")
        self.assertEqual(exported["ir:reviewStatus"],"captured_unreviewed")
        self.assertNotIn("PRIVATE WHOLE-EXCERPT MARKER",json.dumps(exported))
        self.assertNotIn("text_body",exported)
