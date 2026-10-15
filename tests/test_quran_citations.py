import json
import unittest

from islam_research.quran_citations import AYAH_COUNTS, PROFILE_ID, STRUCTURE, detect, reference


class QuranCitationTests(unittest.TestCase):
    def candidates(self, text):
        return detect(text)["candidates"]

    def test_profile_is_attributed_and_has_all_chapters(self):
        self.assertEqual(len(AYAH_COUNTS), 114)
        self.assertEqual(sum(AYAH_COUNTS), 6236)
        self.assertEqual(AYAH_COUNTS[3], 176)
        self.assertEqual(STRUCTURE["source_sha256"], "8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a")
        self.assertIn("Tanzil", STRUCTURE["attribution"])
        self.assertIn("not specified", STRUCTURE["license"])

    def test_each_chapter_boundary_and_invalid_positions(self):
        for chapter, count in enumerate(AYAH_COUNTS, start=1):
            self.assertEqual(reference(chapter, count)["ayah_end"], count)
            for args in [(chapter, 0), (chapter, count + 1), (chapter, 2, 1), (chapter, 1, count + 1)]:
                with self.assertRaises(ValueError):
                    reference(*args)
        for args in [(0, 1), (115, 1), (True, 1), (4, True), (4, 1, False), (4.0, 1), ("4", 1)]:
            with self.assertRaises(ValueError):
                reference(*args)

    def test_arabic_persian_digits_and_unicode_quote_offsets(self):
        for marker in ["Q 4:59", "Q.4:59", "Qur’an ٤:٥٩", "Qurʾān ۴:۵۹", "القرآن ٤:٥٩"]:
            text = "😀 بِ tafsīr — " + marker + "."
            rows = self.candidates(text)
            self.assertEqual(len(rows), 1, marker)
            row = rows[0]
            self.assertEqual(row["matched_text"], marker)
            self.assertEqual(text[row["match_start"]:row["match_end"]], marker)
            self.assertEqual(row["reference"], reference(4, 59))
            self.assertEqual(row["status"], "candidate")
            self.assertEqual(row["review_status"], "unreviewed_reference_candidate")

    def test_ranges_and_lists_inherit_only_the_explicit_chapter(self):
        rows = self.candidates("Q 4:59–60, 83 and 5:2–3.")
        self.assertEqual([row["reference"]["label"] for row in rows], ["Q 4:59–60", "Q 4:83", "Q 5:2–3"])
        self.assertEqual(rows[1]["matched_text"], "83")
        self.assertEqual(rows[2]["matched_text"], "5:2–3")
        self.assertNotEqual(reference(4, 59)["id"], reference(4, 59, 60)["id"])
        self.assertIn(PROFILE_ID, reference(4, 59)["id"])

    def test_abstract_narrative_keeps_the_chapter_as_part_of_its_anchor(self):
        text = "The term appears in the Qur’an in verses 59 and 83 of chapter 4 (sūrat al-Nisā’)."
        rows = self.candidates(text)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["reference"]["label"] for row in rows}, {"Q 4:59", "Q 4:83"})
        self.assertEqual(len({row["key"] for row in rows}), 2)
        for row in rows:
            self.assertEqual(row["matched_text"], "verses 59 and 83 of chapter 4")
            self.assertEqual(row["detector_kind"], "english_narrative")
        rows = self.candidates("Read verses ٥٩–٦٠ in sūrah ٤.")
        self.assertEqual(rows[0]["reference"], reference(4, 59, 60))

    def test_invalid_and_cross_chapter_ranges_are_never_truncated_or_resolved(self):
        for marker, status in [("Q 4:177", "invalid"), ("Q 115:1", "invalid"),
                               ("Q 4:0", "invalid"), ("Q 4:60–59", "invalid"),
                               ("Q 4:59–5:2", "unsupported")]:
            row, = self.candidates(marker)
            self.assertEqual(row["matched_text"], marker)
            self.assertEqual(row["status"], status)
            self.assertIsNone(row["reference"])
        row, = self.candidates("Q 4:59–4:60")
        self.assertEqual(row["reference"], reference(4, 59, 60))

    def test_time_bible_named_only_and_embedded_word_are_not_inferred(self):
        for text in ["Meet at 4:59", "John 4:59", "verses 59 and 83 of chapter 4",
                     "FAQ4:59", "Q4:59th", "sūrat al-Nisā’", "An implied discussion of authority."]:
            self.assertEqual(self.candidates(text), [], text)

    def test_repeated_occurrences_are_distinct_and_reproducible(self):
        text = "Q4:59; Q4:59."
        rows = self.candidates(text)
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["key"], rows[1]["key"])
        self.assertEqual(detect(text), detect(text))
        self.assertNotIn("text_body", json.dumps(detect(text)))

    def test_capture_limits_and_no_hidden_full_text_processing(self):
        for text in [None, 4, "x" * 501, "Q4:59\x00"]:
            with self.assertRaises(ValueError):
                detect(text)
        self.assertEqual(self.candidates(""), [])
        self.assertEqual(self.candidates("x" * 500), [])


if __name__ == "__main__":
    unittest.main()
