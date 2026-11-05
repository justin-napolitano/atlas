"""Embedded research behavior, separate from PostgreSQL role/privilege tests."""
from test_sqlite_desktop_contracts import EmbeddedFixture
from test_lexicon_store import LexiconStoreTests as LexiconCases
from test_citation_store import CitationStoreTests as CitationCases
from test_verse_store import VerseStoreTests as VerseCases
from islam_research import database as db,passage_store,lexicon_store,citation_store,verse_store
from psycopg import sql
import unittest


class ResearchFixture(EmbeddedFixture,unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.db=db;self.sql=sql;self.passages=passage_store;self.citations=citation_store
        self.owner_dsn='sqlite:'+str(self.c.path)


class SQLiteLexicon(ResearchFixture):
    def setUp(self,_cases=LexiconCases):
        super().setUp();self.store=lexicon_store;_cases.setUp(self)
    capture_values=LexiconCases.capture_values
    definition_values=LexiconCases.definition_values
    test_atomic_capture=LexiconCases.test_capture_is_atomic_retryable_and_preserves_missing_definition_and_exact_identity
    test_concurrent_retry=LexiconCases.test_concurrent_identical_requests_create_one_atomic_bundle
    test_atomic_rollback=LexiconCases.test_failure_after_entry_creation_rolls_back_the_entire_bundle
    test_source_spellings=LexiconCases.test_spelling_variants_require_explicit_grouping_and_retain_each_source_origin
    test_project_scope=LexiconCases.test_reusing_concept_and_sense_is_explicit_and_cross_project_links_fail
    test_lookup=LexiconCases.test_normalized_lookup_does_not_merge_meanings_or_promote_review
    test_definitions=LexiconCases.test_definitions_are_located_attributed_independent_and_revisioned
    test_false_quotations=LexiconCases.test_false_quotation_unlocated_proposal_and_bad_attribution_do_not_save
    test_machine_proposal=LexiconCases.test_machine_proposal_keeps_definition_gap_and_attributable_tool_metadata
    test_withdrawal_history=LexiconCases.test_withdrawal_keeps_history_and_project_scoped_entity_retrieval


class SQLiteCitations(ResearchFixture):
    def setUp(self,_cases=CitationCases):
        super().setUp();self.store=citation_store;_cases.setUp(self)
    resolve=CitationCases.resolve
    test_confirmation_history=CitationCases.test_restricted_owner_confirmation_retry_correction_conflict_and_history
    test_manual_mapping=CitationCases.test_manual_mapping_dismissal_and_reverse_lookup_keep_source_location
    test_invalid_candidates=CitationCases.test_unknown_candidate_wrong_project_and_invalid_bounds_do_not_write
    test_export=CitationCases.test_private_annotation_export_retains_resolution_and_excludes_full_excerpt


class SQLiteVerseMaterials(ResearchFixture):
    def setUp(self,_cases=VerseCases):
        super().setUp();self.store=verse_store;_cases.setUp(self)
    metadata=VerseCases.metadata
    create=VerseCases.create
    resolve=VerseCases.resolve
    test_source_ranges=VerseCases.test_source_binding_two_way_range_filters_and_page_boundaries
    test_revision_retry=VerseCases.test_revision_correction_lost_ack_retry_original_creation_replay_and_withdrawal
    test_citation_snapshot=VerseCases.test_confirmed_citation_snapshot_cannot_silently_follow_correction_or_dismissal
    test_unicode_marker=VerseCases.test_owner_marker_exact_unicode_and_manual_mapping_is_not_detected_citation
    test_assertion_kinds=VerseCases.test_representation_interpretation_and_context_assertions_remain_separate


del LexiconCases,CitationCases,VerseCases
