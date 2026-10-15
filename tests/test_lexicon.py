import unittest
import uuid

from islam_research import lexicon as model


class LexiconModelTests(unittest.TestCase):
    def test_normalization_retrieves_without_rewriting_original_or_equating_translations(self):
        self.assertEqual(model.search_key("Tafsīr"),"tafsir")
        self.assertEqual(model.search_key("تَفْسِـير"),model.search_key("تفسير"))
        self.assertNotEqual(model.search_key("tafsīr"),model.search_key("exegesis"))
        self.assertNotEqual(model.search_key("تفسير"),model.search_key("tafsīr"))
        self.assertEqual(model.search_key(" A\n B "),"a b")

    def test_language_declarations_accept_structural_tags_without_inferring_content(self):
        for tag in ["ar","en","und","ar-Latn","en-US","zh-cmn-Hans-CN","sl-rozaj-biske-1994",
                    "de-CH-1901","en-u-ca-gregory","en-a-aaa-b-bbb-x-private","x-owner-term","i-klingon"]:
            self.assertEqual(model.language_tag(tag),tag)
        for tag in ["", "a", "ar_Arab", "العربية", "en--US", "en-US-US", "en-u", "x", "en-x",
                    "en-posix-POSIX", "en-u-ca-u-nu", "en-1234abcd9", "en-!", "en-a-x-private"]:
            with self.assertRaises(ValueError,msg=tag): model.language_tag(tag)

    def test_script_conflicts_and_missing_proposal_provenance_are_rejected(self):
        model.representation("تَفْسِير","ar","Arab","")
        model.representation("tafsīr","ar-Latn","Latn","Owner-declared scheme; unverified")
        with self.assertRaises(ValueError): model.representation("tafsīr","ar-Latn","Arab","")
        with self.assertRaises(ValueError): model.representation("tafsīr","ar","Latin","")

    def definition(self,**patch):
        return model.validate_definition(**{**dict(kind="owner_paraphrase",wording_mode="paraphrase",body="A synthetic paraphrase.",
            attribution="Synthetic owner",scope="Synthetic source-specific scope",dating_note="Dating unknown",rationale="Synthetic rationale",
            proposal_tool="",proposal_version="",proposal_activity="",quotation="A synthetic located source quotation."),**patch})

    def test_quotations_paraphrases_and_recorded_machine_proposals_stay_distinct(self):
        self.definition()
        self.definition(kind="reference_gloss",wording_mode="quotation",body="A synthetic located source quotation.")
        with self.assertRaises(ValueError): self.definition(wording_mode="quotation")
        with self.assertRaises(ValueError): self.definition(kind="machine_proposed")
        self.definition(kind="machine_proposed",proposal_tool="synthetic-parser",proposal_version="1",proposal_activity="synthetic:activity")
        with self.assertRaises(ValueError): self.definition(proposal_tool="undeclared-model")
        for field in ["attribution","scope","rationale"]:
            with self.assertRaises(ValueError): self.definition(**{field:" "})

    def test_occurrence_boundaries_preserve_arabic_and_code_point_positions(self):
        quote="😀 تَفْسِير and tafsīr"
        self.assertEqual(model.selected_term(quote,2,10),"تَفْسِير")
        with self.assertRaises(ValueError): model.selected_term(quote,2,3)
        with self.assertRaises(ValueError): model.selected_term(quote,True,10)

    def test_request_ids_and_fingerprints_are_reproducible_but_not_label_based_identity(self):
        request=str(uuid.uuid4())
        self.assertEqual(model.entity_id(request,"sense"),model.entity_id(request,"sense"))
        self.assertNotEqual(model.entity_id(request,"sense"),model.entity_id(request,"entry"))
        self.assertNotEqual(model.entity_id(request,"sense"),model.entity_id(str(uuid.uuid4()),"sense"))
        self.assertEqual(model.fingerprint({"a":1,"b":2}),model.fingerprint({"b":2,"a":1}))
        self.assertNotEqual(model.fingerprint({"term":"tafsir"}),model.fingerprint({"term":"tafsīr"}))
        with self.assertRaises(ValueError): model.request_identity(str(uuid.uuid1()))
