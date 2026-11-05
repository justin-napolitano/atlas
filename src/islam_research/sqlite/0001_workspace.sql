-- SQLite baseline v1, mapped from the committed PostgreSQL schema through 0038.

-- PostgreSQL migrations remain authoritative for hosted deployments.

CREATE TABLE "desktop_artifacts" (
  "id" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL CHECK ("bytes" IS NULL OR "bytes" BETWEEN -2147483648 AND 2147483647),
  "filename" TEXT NOT NULL,
  "media_type" TEXT NOT NULL,
  "record_id" TEXT,
  "entry_id" TEXT,
  "document_ids" TEXT NOT NULL DEFAULT (JSON('[]')) CHECK ("document_ids" IS NULL OR json_valid("document_ids")),
  "rights_basis" TEXT NOT NULL,
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "desktop_artifacts_bytes_check" CHECK (((bytes >= 1) AND (bytes <= 32768))),
  CONSTRAINT "desktop_artifacts_check" CHECK (((record_id IS NULL) <> (entry_id IS NULL))),
  CONSTRAINT "desktop_artifacts_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "desktop_artifacts_filename_check" CHECK (((LENGTH(filename) >= 1) AND (LENGTH(filename) <= 255))),
  CONSTRAINT "desktop_artifacts_id_fkey" FOREIGN KEY (id) REFERENCES desktop_requests (request_uuid) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "desktop_artifacts_media_type_check" CHECK ((media_type IN (CAST('text/plain' AS TEXT), CAST('text/markdown' AS TEXT)))),
  CONSTRAINT "desktop_artifacts_pkey" PRIMARY KEY (id),
  CONSTRAINT "desktop_artifacts_record_id_fkey" FOREIGN KEY (record_id) REFERENCES records (id),
  CONSTRAINT "desktop_artifacts_sha256_check" CHECK ((sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT)))
);

CREATE TABLE "desktop_folder_history" (
  "folder_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "desktop_folder_history_folder_id_fkey" FOREIGN KEY (folder_id) REFERENCES desktop_folders (id),
  CONSTRAINT "desktop_folder_history_pkey" PRIMARY KEY (folder_id, revision)
);

CREATE TABLE "desktop_folders" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "parent_id" TEXT,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "desktop_folders_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "desktop_folders_check" CHECK ((id IS DISTINCT FROM parent_id)),
  CONSTRAINT "desktop_folders_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES desktop_folders (id),
  CONSTRAINT "desktop_folders_pkey" PRIMARY KEY (id),
  CONSTRAINT "desktop_folders_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "desktop_folders_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('removed' AS TEXT)))),
  CONSTRAINT "desktop_folders_title_check" CHECK (((LENGTH(TRIM(title)) >= 1) AND (LENGTH(TRIM(title)) <= 300)))
);

CREATE TABLE "desktop_page_history" (
  "entry_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "desktop_page_history_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "desktop_page_history_pkey" PRIMARY KEY (entry_id, revision)
);

CREATE TABLE "desktop_page_intents" (
  "request_uuid" TEXT NOT NULL,
  "parent_id" TEXT,
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "folder_id" TEXT,
  CONSTRAINT "desktop_page_intents_check" CHECK (((parent_id IS NULL) <> (folder_id IS NULL))),
  CONSTRAINT "desktop_page_intents_folder_id_fkey" FOREIGN KEY (folder_id) REFERENCES desktop_folders (id),
  CONSTRAINT "desktop_page_intents_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES notebook_entries (id),
  CONSTRAINT "desktop_page_intents_pkey" PRIMARY KEY (request_uuid),
  CONSTRAINT "desktop_page_intents_request_uuid_fkey" FOREIGN KEY (request_uuid) REFERENCES desktop_requests (request_uuid)
);

CREATE TABLE "desktop_page_positions" (
  "entry_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "folder_id" TEXT,
  CONSTRAINT "desktop_page_positions_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "desktop_page_positions_check" CHECK ((entry_id IS DISTINCT FROM parent_id)),
  CONSTRAINT "desktop_page_positions_check1" CHECK (((parent_id IS NULL) OR (folder_id IS NULL))),
  CONSTRAINT "desktop_page_positions_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "desktop_page_positions_folder_id_fkey" FOREIGN KEY (folder_id) REFERENCES desktop_folders (id),
  CONSTRAINT "desktop_page_positions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES notebook_entries (id),
  CONSTRAINT "desktop_page_positions_pkey" PRIMARY KEY (entry_id),
  CONSTRAINT "desktop_page_positions_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "desktop_requests" (
  "request_uuid" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "result" TEXT NOT NULL CHECK ("result" IS NULL OR json_valid("result")),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "desktop_requests_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT))),
  CONSTRAINT "desktop_requests_pkey" PRIMARY KEY (request_uuid)
);

CREATE TABLE "gutenberg_books" (
  "book_id" INTEGER NOT NULL CHECK ("book_id" IS NULL OR "book_id" BETWEEN -2147483648 AND 2147483647),
  "version" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "gutenberg_books_book_id_check" CHECK (((book_id >= 1) AND (book_id <= 999999))),
  CONSTRAINT "gutenberg_books_payload_check" CHECK ((ATLAS_OCTET_LENGTH(ATLAS_JSON_TEXT((payload))) < 16000000)),
  CONSTRAINT "gutenberg_books_pkey" PRIMARY KEY (book_id, version),
  CONSTRAINT "gutenberg_books_version_check" CHECK ((version REGEXP CAST('^[a-f0-9]{64}$' AS TEXT)))
);

CREATE TABLE "gutenberg_places" (
  "project_id" TEXT NOT NULL,
  "book_id" INTEGER NOT NULL CHECK ("book_id" IS NULL OR "book_id" BETWEEN -2147483648 AND 2147483647),
  "version" TEXT NOT NULL,
  "section" INTEGER NOT NULL CHECK ("section" IS NULL OR "section" BETWEEN -2147483648 AND 2147483647),
  "position" INTEGER NOT NULL CHECK ("position" IS NULL OR "position" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "gutenberg_places_book_id_version_fkey" FOREIGN KEY (book_id, version) REFERENCES gutenberg_books (book_id, version),
  CONSTRAINT "gutenberg_places_pkey" PRIMARY KEY (project_id, book_id),
  CONSTRAINT "gutenberg_places_position_check" CHECK ((("position" >= 0) AND ("position" <= 12000))),
  CONSTRAINT "gutenberg_places_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "gutenberg_places_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "gutenberg_places_section_check" CHECK (((section >= 0) AND (section <= 1000)))
);

CREATE TABLE "import_snapshots" (
  "project_id" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "original_text" TEXT NOT NULL,
  "imported_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "record_count" INTEGER NOT NULL CHECK ("record_count" IS NULL OR "record_count" BETWEEN -2147483648 AND 2147483647),
  "relation_count" INTEGER NOT NULL CHECK ("relation_count" IS NULL OR "relation_count" BETWEEN -2147483648 AND 2147483647),
  CONSTRAINT "import_snapshots_format_check" CHECK ((format IN (CAST('turtle' AS TEXT), CAST('candidate_jsonl' AS TEXT)))),
  CONSTRAINT "import_snapshots_pkey" PRIMARY KEY (project_id, sha256),
  CONSTRAINT "import_snapshots_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "import_snapshots_record_count_check" CHECK ((record_count >= 0)),
  CONSTRAINT "import_snapshots_relation_count_check" CHECK ((relation_count >= 0)),
  CONSTRAINT "import_snapshots_sha256_check" CHECK ((sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT)))
);

CREATE TABLE "lexicon_captures" (
  "request_uuid" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "result" TEXT NOT NULL CHECK ("result" IS NULL OR json_valid("result")),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_captures_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_captures_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "lexicon_captures_pkey" PRIMARY KEY (request_uuid),
  CONSTRAINT "lexicon_captures_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "lexicon_captures_result_check" CHECK ((ATLAS_JSON_TYPE(result) = CAST('object' AS TEXT)))
);

CREATE TABLE "lexicon_definitions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "concept_id" TEXT NOT NULL,
  "sense_id" TEXT,
  "annotation_id" TEXT NOT NULL,
  "definition_kind" TEXT NOT NULL,
  "wording_mode" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attribution" TEXT NOT NULL,
  "attribution_person_id" TEXT,
  "scope" TEXT NOT NULL,
  "dating_note" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "proposal_tool" TEXT NOT NULL,
  "proposal_version" TEXT NOT NULL,
  "proposal_activity" TEXT NOT NULL,
  "search_key" TEXT NOT NULL,
  "search_version" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_definitions_attribution_check" CHECK (((LENGTH(TRIM(attribution)) >= 1) AND (LENGTH(TRIM(attribution)) <= 2000))),
  CONSTRAINT "lexicon_definitions_body_check" CHECK (((LENGTH(TRIM(body)) >= 1) AND (LENGTH(TRIM(body)) <= 5000))),
  CONSTRAINT "lexicon_definitions_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_definitions_check" CHECK ((((definition_kind = CAST('machine_proposed' AS TEXT)) AND (LENGTH(TRIM(proposal_tool)) > 0) AND (LENGTH(TRIM(proposal_version)) > 0) AND (LENGTH(TRIM(proposal_activity)) > 0)) OR ((definition_kind <> CAST('machine_proposed' AS TEXT)) AND (proposal_tool = CAST('' AS TEXT)) AND (proposal_version = CAST('' AS TEXT)) AND (proposal_activity = CAST('' AS TEXT))))),
  CONSTRAINT "lexicon_definitions_dating_note_check" CHECK ((LENGTH(dating_note) <= 2000)),
  CONSTRAINT "lexicon_definitions_definition_kind_check" CHECK ((definition_kind IN (CAST('source_explicit' AS TEXT), CAST('reference_gloss' AS TEXT), CAST('owner_paraphrase' AS TEXT), CAST('machine_proposed' AS TEXT)))),
  CONSTRAINT "lexicon_definitions_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_definitions_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_definitions_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "lexicon_definitions_project_id_attribution_person_id_fkey" FOREIGN KEY (project_id, attribution_person_id) REFERENCES records (project_id, id),
  CONSTRAINT "lexicon_definitions_project_id_concept_id_fkey" FOREIGN KEY (project_id, concept_id) REFERENCES records (project_id, id),
  CONSTRAINT "lexicon_definitions_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_definitions_project_id_sense_id_concept_id_fkey" FOREIGN KEY (project_id, sense_id, concept_id) REFERENCES lexicon_senses (project_id, id, concept_id),
  CONSTRAINT "lexicon_definitions_proposal_activity_check" CHECK ((LENGTH(proposal_activity) <= 500)),
  CONSTRAINT "lexicon_definitions_proposal_tool_check" CHECK ((LENGTH(proposal_tool) <= 500)),
  CONSTRAINT "lexicon_definitions_proposal_version_check" CHECK ((LENGTH(proposal_version) <= 500)),
  CONSTRAINT "lexicon_definitions_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "lexicon_definitions_review_state_check" CHECK ((review_state = CAST('pending' AS TEXT))),
  CONSTRAINT "lexicon_definitions_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "lexicon_definitions_scope_check" CHECK (((LENGTH(TRIM(scope)) >= 1) AND (LENGTH(TRIM(scope)) <= 10000))),
  CONSTRAINT "lexicon_definitions_search_key_check" CHECK ((LENGTH(search_key) <= 20000)),
  CONSTRAINT "lexicon_definitions_search_version_check" CHECK ((search_version = CAST('lexicon-search-1' AS TEXT))),
  CONSTRAINT "lexicon_definitions_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "lexicon_definitions_wording_mode_check" CHECK ((wording_mode IN (CAST('quotation' AS TEXT), CAST('paraphrase' AS TEXT))))
);

CREATE TABLE "lexicon_entries" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "entry_type" TEXT NOT NULL DEFAULT (CAST('undetermined' AS TEXT)),
  "scope" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_entries_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_entries_entry_type_check" CHECK ((entry_type IN (CAST('word' AS TEXT), CAST('multiword' AS TEXT), CAST('undetermined' AS TEXT)))),
  CONSTRAINT "lexicon_entries_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_entries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "lexicon_entries_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_entries_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "lexicon_entries_scope_check" CHECK (((LENGTH(TRIM(scope)) >= 1) AND (LENGTH(TRIM(scope)) <= 10000)))
);

CREATE TABLE "lexicon_forms" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "form_kind" TEXT NOT NULL DEFAULT (CAST('undetermined' AS TEXT)),
  "rationale" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_forms_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_forms_form_kind_check" CHECK ((form_kind IN (CAST('canonical' AS TEXT), CAST('other' AS TEXT), CAST('undetermined' AS TEXT)))),
  CONSTRAINT "lexicon_forms_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_forms_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_forms_project_id_entry_id_fkey" FOREIGN KEY (project_id, entry_id) REFERENCES lexicon_entries (project_id, id),
  CONSTRAINT "lexicon_forms_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_forms_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "lexicon_forms_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "lexicon_occurrences" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "representation_id" TEXT NOT NULL,
  "sense_id" TEXT NOT NULL,
  "annotation_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "term_start" INTEGER NOT NULL CHECK ("term_start" IS NULL OR "term_start" BETWEEN -2147483648 AND 2147483647),
  "term_end" INTEGER NOT NULL CHECK ("term_end" IS NULL OR "term_end" BETWEEN -2147483648 AND 2147483647),
  "exact" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_occurrences_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_occurrences_check" CHECK (((term_end > term_start) AND ((term_end - term_start) <= 500))),
  CONSTRAINT "lexicon_occurrences_check1" CHECK ((LENGTH(exact) = (term_end - term_start))),
  CONSTRAINT "lexicon_occurrences_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_occurrences_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_occurrences_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "lexicon_occurrences_project_id_annotation_id_term_start_ter_key" UNIQUE (project_id, annotation_id, term_start, term_end, representation_id, sense_id),
  CONSTRAINT "lexicon_occurrences_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "lexicon_occurrences_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_occurrences_project_id_representation_id_fkey" FOREIGN KEY (project_id, representation_id) REFERENCES lexicon_representations (project_id, id),
  CONSTRAINT "lexicon_occurrences_project_id_sense_id_fkey" FOREIGN KEY (project_id, sense_id) REFERENCES lexicon_senses (project_id, id),
  CONSTRAINT "lexicon_occurrences_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "lexicon_occurrences_review_state_check" CHECK ((review_state = CAST('pending' AS TEXT))),
  CONSTRAINT "lexicon_occurrences_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "lexicon_occurrences_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "lexicon_occurrences_term_start_check" CHECK ((term_start >= 0)),
  CONSTRAINT "lexicon_occurrences_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT)))
);

CREATE TABLE "lexicon_representations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "form_id" TEXT NOT NULL,
  "origin_annotation_id" TEXT NOT NULL,
  "origin_start" INTEGER NOT NULL CHECK ("origin_start" IS NULL OR "origin_start" BETWEEN -2147483648 AND 2147483647),
  "origin_end" INTEGER NOT NULL CHECK ("origin_end" IS NULL OR "origin_end" BETWEEN -2147483648 AND 2147483647),
  "written_rep" TEXT NOT NULL,
  "language_tag" TEXT NOT NULL,
  "script_tag" TEXT NOT NULL,
  "transliteration_scheme" TEXT NOT NULL,
  "search_key" TEXT NOT NULL,
  "search_version" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_representations_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_representations_check" CHECK (((origin_end > origin_start) AND ((origin_end - origin_start) <= 500))),
  CONSTRAINT "lexicon_representations_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_representations_language_tag_check" CHECK ((((LENGTH(language_tag) >= 1) AND (LENGTH(language_tag) <= 100)) AND (language_tag REGEXP CAST('^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' AS TEXT)))),
  CONSTRAINT "lexicon_representations_origin_start_check" CHECK ((origin_start >= 0)),
  CONSTRAINT "lexicon_representations_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_representations_project_id_form_id_fkey" FOREIGN KEY (project_id, form_id) REFERENCES lexicon_forms (project_id, id),
  CONSTRAINT "lexicon_representations_project_id_form_id_written_rep_lang_key" UNIQUE (project_id, form_id, written_rep, language_tag, script_tag, transliteration_scheme),
  CONSTRAINT "lexicon_representations_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_representations_project_id_origin_annotation_id_fkey" FOREIGN KEY (project_id, origin_annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "lexicon_representations_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "lexicon_representations_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "lexicon_representations_script_tag_check" CHECK (((script_tag = CAST('' AS TEXT)) OR (script_tag REGEXP CAST('^[A-Za-z]{4}$' AS TEXT)))),
  CONSTRAINT "lexicon_representations_search_key_check" CHECK ((LENGTH(search_key) <= 10000)),
  CONSTRAINT "lexicon_representations_search_version_check" CHECK ((search_version = CAST('lexicon-search-1' AS TEXT))),
  CONSTRAINT "lexicon_representations_transliteration_scheme_check" CHECK ((LENGTH(transliteration_scheme) <= 500)),
  CONSTRAINT "lexicon_representations_written_rep_check" CHECK (((LENGTH(TRIM(written_rep)) >= 1) AND (LENGTH(TRIM(written_rep)) <= 500)))
);

CREATE TABLE "lexicon_revisions" (
  "entity_table" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "lexicon_revisions_pkey" PRIMARY KEY (entity_table, entity_id, revision)
);

CREATE TABLE "lexicon_senses" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "concept_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "lexicon_senses_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "lexicon_senses_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "lexicon_senses_pkey" PRIMARY KEY (id),
  CONSTRAINT "lexicon_senses_project_id_concept_id_fkey" FOREIGN KEY (project_id, concept_id) REFERENCES records (project_id, id),
  CONSTRAINT "lexicon_senses_project_id_entry_id_concept_id_key" UNIQUE (project_id, entry_id, concept_id),
  CONSTRAINT "lexicon_senses_project_id_entry_id_fkey" FOREIGN KEY (project_id, entry_id) REFERENCES lexicon_entries (project_id, id),
  CONSTRAINT "lexicon_senses_project_id_id_concept_id_key" UNIQUE (project_id, id, concept_id),
  CONSTRAINT "lexicon_senses_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "lexicon_senses_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "lexicon_senses_review_state_check" CHECK ((review_state = CAST('pending' AS TEXT))),
  CONSTRAINT "lexicon_senses_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "lexicon_senses_scope_check" CHECK (((LENGTH(TRIM(scope)) >= 1) AND (LENGTH(TRIM(scope)) <= 10000))),
  CONSTRAINT "lexicon_senses_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('withdrawn' AS TEXT))))
);

CREATE TABLE "library_document_bindings" (
  "document_id" TEXT NOT NULL,
  "project_id" TEXT,
  "source_record_id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "representation_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_document_bindings_pkey" PRIMARY KEY (document_id),
  CONSTRAINT "library_document_bindings_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "library_document_bindings_representation_id_work_id_fkey" FOREIGN KEY (representation_id, work_id) REFERENCES library_representations (id, work_id),
  CONSTRAINT "library_document_bindings_source_record_id_project_id_work_fkey" FOREIGN KEY (source_record_id, project_id, work_id) REFERENCES library_source_bindings (source_record_id, project_id, work_id)
);

CREATE TABLE "library_editions" (
  "id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "representation_url" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_editions_id_work_id_key" UNIQUE (id, work_id),
  CONSTRAINT "library_editions_label_check" CHECK (((LENGTH(label) >= 1) AND (LENGTH(label) <= 1000))),
  CONSTRAINT "library_editions_pkey" PRIMARY KEY (id),
  CONSTRAINT "library_editions_work_id_fkey" FOREIGN KEY (work_id) REFERENCES library_works (id),
  CONSTRAINT "library_editions_work_id_label_representation_url_key" UNIQUE (work_id, label, representation_url)
);

CREATE TABLE "library_events" (
  "event_id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_events_target_kind_check" CHECK ((target_kind IN (CAST('item' AS TEXT), CAST('membership' AS TEXT)))),
  CONSTRAINT "library_events_target_kind_target_id_project_id_revision_key" UNIQUE (target_kind, target_id, project_id, revision)
);

CREATE TABLE "library_items" (
  "id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "preferred_edition_id" TEXT,
  "on_shelf" INTEGER NOT NULL DEFAULT (FALSE) CHECK ("on_shelf" IS NULL OR "on_shelf" IN (0,1)),
  "reading_status" TEXT NOT NULL DEFAULT (CAST('needs_review' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "retained_at" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_items_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "library_items_id_work_id_key" UNIQUE (id, work_id),
  CONSTRAINT "library_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "library_items_preferred_edition_id_work_id_fkey" FOREIGN KEY (preferred_edition_id, work_id) REFERENCES library_editions (id, work_id),
  CONSTRAINT "library_items_reading_status_check" CHECK ((reading_status IN (CAST('needs_review' AS TEXT), CAST('want_to_read' AS TEXT), CAST('reading' AS TEXT), CAST('finished' AS TEXT)))),
  CONSTRAINT "library_items_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "library_items_work_id_fkey" FOREIGN KEY (work_id) REFERENCES library_works (id),
  CONSTRAINT "library_items_work_id_key" UNIQUE (work_id)
);

CREATE TABLE "library_project_items" (
  "item_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_project_items_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "library_project_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES library_items (id),
  CONSTRAINT "library_project_items_pkey" PRIMARY KEY (item_id, project_id),
  CONSTRAINT "library_project_items_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "library_project_items_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "library_project_items_state_check" CHECK ((state IN (CAST('legacy' AS TEXT), CAST('active' AS TEXT), CAST('removed' AS TEXT))))
);

CREATE TABLE "library_representations" (
  "id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "edition_id" TEXT NOT NULL,
  "locator" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "notice_sha256" TEXT NOT NULL,
  "normalization" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_representations_edition_id_work_id_fkey" FOREIGN KEY (edition_id, work_id) REFERENCES library_editions (id, work_id),
  CONSTRAINT "library_representations_id_work_id_key" UNIQUE (id, work_id),
  CONSTRAINT "library_representations_notice_sha256_check" CHECK ((notice_sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT))),
  CONSTRAINT "library_representations_pkey" PRIMARY KEY (id),
  CONSTRAINT "library_representations_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT)))
);

CREATE TABLE "library_requests" (
  "request_uuid" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "result" TEXT NOT NULL CHECK ("result" IS NULL OR json_valid("result")),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_requests_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT))),
  CONSTRAINT "library_requests_pkey" PRIMARY KEY (request_uuid)
);

CREATE TABLE "library_source_bindings" (
  "source_record_id" TEXT NOT NULL,
  "project_id" TEXT,
  "item_id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "source_revision" INTEGER NOT NULL CHECK ("source_revision" IS NULL OR "source_revision" BETWEEN -2147483648 AND 2147483647),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_source_bindings_item_id_work_id_fkey" FOREIGN KEY (item_id, work_id) REFERENCES library_items (id, work_id),
  CONSTRAINT "library_source_bindings_pkey" PRIMARY KEY (source_record_id),
  CONSTRAINT "library_source_bindings_project_id_source_record_id_fkey" FOREIGN KEY (project_id, source_record_id) REFERENCES records (project_id, id),
  CONSTRAINT "library_source_bindings_source_record_id_project_id_work_id_key" UNIQUE (source_record_id, project_id, work_id),
  CONSTRAINT "library_source_bindings_source_revision_check" CHECK ((source_revision > 0))
);

CREATE TABLE "library_works" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "identity_basis" TEXT NOT NULL DEFAULT (CAST('legacy_source_unresolved' AS TEXT)),
  "legacy_source_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "library_works_identity_basis_check" CHECK ((identity_basis IN (CAST('legacy_source_unresolved' AS TEXT), CAST('source_unresolved' AS TEXT)))),
  CONSTRAINT "library_works_legacy_source_id_fkey" FOREIGN KEY (legacy_source_id) REFERENCES records (id),
  CONSTRAINT "library_works_legacy_source_id_key" UNIQUE (legacy_source_id),
  CONSTRAINT "library_works_pkey" PRIMARY KEY (id),
  CONSTRAINT "library_works_title_check" CHECK (((LENGTH(title) >= 1) AND (LENGTH(title) <= 2000)))
);

CREATE TABLE "note_trash" (
  "project_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "target_revision" INTEGER NOT NULL CHECK ("target_revision" IS NULL OR "target_revision" BETWEEN -2147483648 AND 2147483647),
  "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "note_trash_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "note_trash_pkey" PRIMARY KEY (project_id, target_kind, target_id),
  CONSTRAINT "note_trash_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "note_trash_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "note_trash_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('trashed' AS TEXT)))),
  CONSTRAINT "note_trash_target_kind_check" CHECK ((target_kind IN (CAST('entry' AS TEXT), CAST('annotation' AS TEXT)))),
  CONSTRAINT "note_trash_target_revision_check" CHECK ((target_revision > 0))
);

CREATE TABLE "note_trash_revisions" (
  "project_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "note_trash_revisions_pkey" PRIMARY KEY (project_id, target_kind, target_id, revision),
  CONSTRAINT "note_trash_revisions_project_id_target_kind_target_id_fkey" FOREIGN KEY (project_id, target_kind, target_id) REFERENCES note_trash (project_id, target_kind, target_id)
);

CREATE TABLE "notebook_draft_revisions" (
  "draft_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "notebook_draft_revisions_draft_id_fkey" FOREIGN KEY (draft_id) REFERENCES notebook_drafts (id),
  CONSTRAINT "notebook_draft_revisions_pkey" PRIMARY KEY (draft_id, revision)
);

CREATE TABLE "notebook_drafts" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "entry_id" TEXT,
  "request_uuid" TEXT,
  "record_id" TEXT,
  "document_id" TEXT,
  "annotation_id" TEXT,
  "base_revision" INTEGER NOT NULL CHECK ("base_revision" IS NULL OR "base_revision" BETWEEN -2147483648 AND 2147483647),
  "base_snapshot" TEXT CHECK ("base_snapshot" IS NULL OR json_valid("base_snapshot")),
  "value" TEXT NOT NULL CHECK ("value" IS NULL OR json_valid("value")),
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "reading_position" INTEGER CHECK ("reading_position" IS NULL OR "reading_position" BETWEEN -2147483648 AND 2147483647),
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  CONSTRAINT "notebook_drafts_base_revision_check" CHECK ((base_revision >= 0)),
  CONSTRAINT "notebook_drafts_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "notebook_drafts_check" CHECK ((((entry_id IS NULL) AND (NOT request_uuid IS NULL) AND (base_revision = 0)) OR ((NOT entry_id IS NULL) AND (request_uuid IS NULL) AND (base_revision > 0)))),
  CONSTRAINT "notebook_drafts_pkey" PRIMARY KEY (id),
  CONSTRAINT "notebook_drafts_position" CHECK (((reading_position IS NULL) OR ((reading_position >= 0) AND (NOT record_id IS NULL) AND (NOT document_id IS NULL) AND (annotation_id IS NULL)))),
  CONSTRAINT "notebook_drafts_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "notebook_drafts_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "notebook_drafts_project_id_entry_id_fkey" FOREIGN KEY (project_id, entry_id) REFERENCES notebook_entries (project_id, id),
  CONSTRAINT "notebook_drafts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "notebook_drafts_project_id_record_id_fkey" FOREIGN KEY (project_id, record_id) REFERENCES records (project_id, id),
  CONSTRAINT "notebook_drafts_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "notebook_drafts_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('discarded' AS TEXT)))),
  CONSTRAINT "notebook_drafts_value_check" CHECK ((ATLAS_JSON_TYPE(value) = CAST('object' AS TEXT))),
  CONSTRAINT "notebook_drafts_value_check1" CHECK (((LENGTH((value ->> CAST('title' AS TEXT))) <= 300) AND (LENGTH((value ->> CAST('body' AS TEXT))) <= 20000))),
  CONSTRAINT "notebook_drafts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "notebook_entries" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "creation_sha256" TEXT NOT NULL,
  "record_id" TEXT,
  "document_id" TEXT,
  "annotation_id" TEXT,
  "thought_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "links" TEXT NOT NULL DEFAULT (JSON('[]')) CHECK ("links" IS NULL OR json_valid("links")),
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "reading_position" INTEGER CHECK ("reading_position" IS NULL OR "reading_position" BETWEEN -2147483648 AND 2147483647),
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "title_mode" TEXT NOT NULL DEFAULT (CAST('manual' AS TEXT)),
  CONSTRAINT "notebook_entries_body_check" CHECK (((LENGTH(TRIM(body)) >= 1) AND (LENGTH(TRIM(body)) <= 20000))),
  CONSTRAINT "notebook_entries_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "notebook_entries_check" CHECK ((((document_id IS NULL) AND (annotation_id IS NULL)) OR (NOT record_id IS NULL))),
  CONSTRAINT "notebook_entries_check1" CHECK (((annotation_id IS NULL) OR (NOT document_id IS NULL))),
  CONSTRAINT "notebook_entries_check2" CHECK (((thought_type <> CAST('source_claim' AS TEXT)) OR (NOT annotation_id IS NULL))),
  CONSTRAINT "notebook_entries_creation_sha256_check" CHECK ((creation_sha256 REGEXP CAST('^[a-f0-9]{64}$' AS TEXT))),
  CONSTRAINT "notebook_entries_links_check" CHECK (((ATLAS_JSON_TYPE(links) = CAST('array' AS TEXT)) AND (JSON_ARRAY_LENGTH(links) <= 25))),
  CONSTRAINT "notebook_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "notebook_entries_position" CHECK (((reading_position IS NULL) OR ((reading_position >= 0) AND (NOT record_id IS NULL) AND (NOT document_id IS NULL) AND (annotation_id IS NULL)))),
  CONSTRAINT "notebook_entries_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "notebook_entries_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "notebook_entries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "notebook_entries_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "notebook_entries_project_id_record_id_fkey" FOREIGN KEY (project_id, record_id) REFERENCES records (project_id, id),
  CONSTRAINT "notebook_entries_review_state_check" CHECK ((review_state = CAST('pending' AS TEXT))),
  CONSTRAINT "notebook_entries_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "notebook_entries_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "notebook_entries_thought_type_check" CHECK ((thought_type IN (CAST('note' AS TEXT), CAST('question' AS TEXT), CAST('source_claim' AS TEXT), CAST('interpretation' AS TEXT), CAST('objection' AS TEXT), CAST('decision' AS TEXT), CAST('principle' AS TEXT), CAST('skill' AS TEXT)))),
  CONSTRAINT "notebook_entries_title_check" CHECK (((LENGTH(TRIM(title)) >= 1) AND (LENGTH(TRIM(title)) <= 300))),
  CONSTRAINT "notebook_entries_title_mode_check" CHECK ((title_mode IN (CAST('automatic' AS TEXT), CAST('manual' AS TEXT)))),
  CONSTRAINT "notebook_entries_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "notebook_revisions" (
  "project_id" TEXT,
  "entry_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "notebook_revisions_pkey" PRIMARY KEY (entry_id, revision),
  CONSTRAINT "notebook_revisions_project_id_entry_id_fkey" FOREIGN KEY (project_id, entry_id) REFERENCES notebook_entries (project_id, id)
);

CREATE TABLE "owner_workspaces" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT (CAST('My research' AS TEXT)),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "owner_workspaces_id_check" CHECK ((id = CAST('owner' AS TEXT))),
  CONSTRAINT "owner_workspaces_pkey" PRIMARY KEY (id)
);

CREATE TABLE "personal_state_revisions" (
  "record_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "personal_state_revisions_pkey" PRIMARY KEY (record_id, revision),
  CONSTRAINT "personal_state_revisions_record_id_fkey" FOREIGN KEY (record_id) REFERENCES personal_states (record_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "personal_states" (
  "record_id" TEXT NOT NULL,
  "project_id" TEXT,
  "reading" TEXT NOT NULL DEFAULT (CAST('unread' AS TEXT)),
  "read_at" TEXT,
  "decision" TEXT NOT NULL DEFAULT (CAST('unreviewed' AS TEXT)),
  "note" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "personal_states_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "personal_states_check" CHECK ((((reading = CAST('read' AS TEXT)) AND (NOT read_at IS NULL)) OR ((reading <> CAST('read' AS TEXT)) AND (read_at IS NULL)))),
  CONSTRAINT "personal_states_decision_check" CHECK ((decision IN (CAST('unreviewed' AS TEXT), CAST('relevant' AS TEXT), CAST('not_relevant' AS TEXT), CAST('read_later' AS TEXT)))),
  CONSTRAINT "personal_states_note_check" CHECK ((LENGTH(note) <= 10000)),
  CONSTRAINT "personal_states_pkey" PRIMARY KEY (record_id),
  CONSTRAINT "personal_states_project_id_record_id_fkey" FOREIGN KEY (project_id, record_id) REFERENCES records (project_id, id),
  CONSTRAINT "personal_states_reading_check" CHECK ((reading IN (CAST('unread' AS TEXT), CAST('reading' AS TEXT), CAST('read' AS TEXT)))),
  CONSTRAINT "personal_states_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "graph_authority" TEXT NOT NULL DEFAULT (CAST('canonical_rdf' AS TEXT)),
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "projects_graph_authority_check" CHECK ((graph_authority IN (CAST('canonical_rdf' AS TEXT), CAST('hosted' AS TEXT)))),
  CONSTRAINT "projects_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "projects_pkey" PRIMARY KEY (id),
  CONSTRAINT "projects_title_check" CHECK (((LENGTH(title) >= 1) AND (LENGTH(title) <= 2000)))
);

CREATE TABLE "publication_events" (
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "preview_id" TEXT,
  "action" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "changed_by" TEXT NOT NULL,
  "changed_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "publication_events_action_check" CHECK ((action IN (CAST('publish' AS TEXT), CAST('withdraw' AS TEXT)))),
  CONSTRAINT "publication_events_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "publication_events_pkey" PRIMARY KEY (project_id, revision),
  CONSTRAINT "publication_events_preview_id_fkey" FOREIGN KEY (preview_id) REFERENCES publication_previews (id),
  CONSTRAINT "publication_events_preview_id_key" UNIQUE (preview_id),
  CONSTRAINT "publication_events_rationale_check" CHECK (((LENGTH(rationale) >= 1) AND (LENGTH(rationale) <= 2000)))
);

CREATE TABLE "publication_previews" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "record_ids" TEXT NOT NULL CHECK ("record_ids" IS NULL OR json_valid("record_ids")),
  "relation_ids" TEXT NOT NULL CHECK ("relation_ids" IS NULL OR json_valid("relation_ids")),
  "inputs" TEXT NOT NULL CHECK ("inputs" IS NULL OR json_valid("inputs")),
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "payload_sha256" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "publication_previews_check" CHECK ((payload_sha256 = ATLAS_ENCODE(ATLAS_SHA256(ATLAS_CONVERT_TO(ATLAS_JSON_TEXT((payload)), CAST('UTF8' AS TEXT))), CAST('hex' AS TEXT)))),
  CONSTRAINT "publication_previews_created_by_check" CHECK (((LENGTH(created_by) >= 1) AND (LENGTH(created_by) <= 500))),
  CONSTRAINT "publication_previews_id_check" CHECK ((id REGEXP CAST('^publication-[a-f0-9]{32}$' AS TEXT))),
  CONSTRAINT "publication_previews_payload_check" CHECK (((ATLAS_JSON_TYPE(payload) = CAST('object' AS TEXT)) AND (ATLAS_OCTET_LENGTH(ATLAS_JSON_TEXT((payload))) <= 2000000))),
  CONSTRAINT "publication_previews_pkey" PRIMARY KEY (id),
  CONSTRAINT "publication_previews_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE TABLE "quran_note_contexts" (
  "entry_id" TEXT NOT NULL,
  "project_id" TEXT,
  "resource_key" TEXT NOT NULL,
  "note_scope" TEXT NOT NULL,
  "chapter" INTEGER CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah_start" INTEGER CHECK ("ayah_start" IS NULL OR "ayah_start" BETWEEN -2147483648 AND 2147483647),
  "ayah_end" INTEGER CHECK ("ayah_end" IS NULL OR "ayah_end" BETWEEN -2147483648 AND 2147483647),
  CONSTRAINT "quran_note_contexts_check" CHECK ((((note_scope = CAST('source' AS TEXT)) AND (chapter IS NULL) AND (ayah_start IS NULL) AND (ayah_end IS NULL)) OR ((note_scope = CAST('surah' AS TEXT)) AND (NOT chapter IS NULL) AND ((chapter >= 1) AND (chapter <= 114)) AND (ayah_start IS NULL) AND (ayah_end IS NULL)) OR ((note_scope = CAST('verse' AS TEXT)) AND (NOT chapter IS NULL) AND (NOT ayah_start IS NULL) AND (NOT ayah_end IS NULL) AND ((chapter >= 1) AND (chapter <= 114)) AND (ayah_start >= 1) AND (ayah_end >= ayah_start) AND (ayah_end <= 286)))),
  CONSTRAINT "quran_note_contexts_note_scope_check" CHECK ((note_scope IN (CAST('verse' AS TEXT), CAST('surah' AS TEXT), CAST('source' AS TEXT)))),
  CONSTRAINT "quran_note_contexts_pkey" PRIMARY KEY (entry_id),
  CONSTRAINT "quran_note_contexts_project_id_entry_id_fkey" FOREIGN KEY (project_id, entry_id) REFERENCES notebook_entries (project_id, id),
  CONSTRAINT "quran_note_contexts_resource_key_check" CHECK ((resource_key IN (CAST('tanzil-uthmani' AS TEXT), CAST('itani-god' AS TEXT))))
);

CREATE TABLE "quran_places" (
  "project_id" TEXT NOT NULL,
  "resource_key" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "quran_places_ayah_check" CHECK (((ayah >= 1) AND (ayah <= 286))),
  CONSTRAINT "quran_places_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "quran_places_chapter_check" CHECK (((chapter >= 1) AND (chapter <= 114))),
  CONSTRAINT "quran_places_check" CHECK ((ayah <= ATLAS_ARRAY_AT((JSON_ARRAY(7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6)), chapter, 1))),
  CONSTRAINT "quran_places_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "quran_places_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "quran_places_resource_key_check" CHECK ((resource_key IN (CAST('tanzil-uthmani' AS TEXT), CAST('itani-god' AS TEXT)))),
  CONSTRAINT "quran_places_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "quran_progress_revisions" (
  "project_id" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "quran_progress_revisions_pkey" PRIMARY KEY (project_id, chapter, ayah, revision),
  CONSTRAINT "quran_progress_revisions_project_id_chapter_ayah_fkey" FOREIGN KEY (project_id, chapter, ayah) REFERENCES quran_reading_progress (project_id, chapter, ayah)
);

CREATE TABLE "quran_reading_progress" (
  "project_id" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "is_read" INTEGER NOT NULL CHECK ("is_read" IS NULL OR "is_read" IN (0,1)),
  "read_at" TEXT,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "quran_reading_progress_ayah_check" CHECK (((ayah >= 1) AND (ayah <= 286))),
  CONSTRAINT "quran_reading_progress_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "quran_reading_progress_chapter_check" CHECK (((chapter >= 1) AND (chapter <= 114))),
  CONSTRAINT "quran_reading_progress_check" CHECK ((is_read = (NOT read_at IS NULL))),
  CONSTRAINT "quran_reading_progress_check1" CHECK ((ayah <= ATLAS_ARRAY_AT((JSON_ARRAY(7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6)), chapter, 1))),
  CONSTRAINT "quran_reading_progress_pkey" PRIMARY KEY (project_id, chapter, ayah),
  CONSTRAINT "quran_reading_progress_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "quran_reading_progress_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "reading_annotation_revisions" (
  "annotation_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "reading_annotation_revisions_annotation_id_fkey" FOREIGN KEY (annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "reading_annotation_revisions_pkey" PRIMARY KEY (annotation_id, revision)
);

CREATE TABLE "reading_annotations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "document_id" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "start_pos" INTEGER NOT NULL CHECK ("start_pos" IS NULL OR "start_pos" BETWEEN -2147483648 AND 2147483647),
  "end_pos" INTEGER NOT NULL CHECK ("end_pos" IS NULL OR "end_pos" BETWEEN -2147483648 AND 2147483647),
  "exact" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "suffix" TEXT NOT NULL,
  "capture_kind" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "mark_style" TEXT NOT NULL DEFAULT (CAST('highlight' AS TEXT)),
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  CONSTRAINT "reading_annotations_body_check" CHECK ((LENGTH(body) <= 10000)),
  CONSTRAINT "reading_annotations_capture_kind_check" CHECK ((capture_kind IN (CAST('comment' AS TEXT), CAST('term_candidate' AS TEXT), CAST('citation_candidate' AS TEXT)))),
  CONSTRAINT "reading_annotations_check" CHECK (((end_pos > start_pos) AND ((end_pos - start_pos) <= 500))),
  CONSTRAINT "reading_annotations_check1" CHECK ((LENGTH(exact) = (end_pos - start_pos))),
  CONSTRAINT "reading_annotations_mark_style_check" CHECK ((mark_style IN (CAST('highlight' AS TEXT), CAST('underline' AS TEXT), CAST('none' AS TEXT)))),
  CONSTRAINT "reading_annotations_pkey" PRIMARY KEY (id),
  CONSTRAINT "reading_annotations_prefix_check" CHECK ((LENGTH(prefix) <= 40)),
  CONSTRAINT "reading_annotations_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "reading_annotations_project_identity" UNIQUE (project_id, id),
  CONSTRAINT "reading_annotations_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "reading_annotations_start_pos_check" CHECK ((start_pos >= 0)),
  CONSTRAINT "reading_annotations_suffix_check" CHECK ((LENGTH(suffix) <= 40)),
  CONSTRAINT "reading_annotations_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "reading_annotations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "reading_desk_revisions" (
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "reading_desk_revisions_pkey" PRIMARY KEY (project_id, revision),
  CONSTRAINT "reading_desk_revisions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE TABLE "reading_desks" (
  "project_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "document_id" TEXT,
  "annotation_id" TEXT,
  "start_pos" INTEGER CHECK ("start_pos" IS NULL OR "start_pos" BETWEEN -2147483648 AND 2147483647),
  "end_pos" INTEGER CHECK ("end_pos" IS NULL OR "end_pos" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "reading_desks_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "reading_desks_check" CHECK ((((document_id IS NULL) AND (annotation_id IS NULL) AND (start_pos IS NULL) AND (end_pos IS NULL)) OR ((NOT document_id IS NULL) AND (NOT start_pos IS NULL) AND (NOT end_pos IS NULL) AND (start_pos >= 0) AND (end_pos >= start_pos)))),
  CONSTRAINT "reading_desks_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "reading_desks_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "reading_desks_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "reading_desks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "reading_desks_project_id_record_id_fkey" FOREIGN KEY (project_id, record_id) REFERENCES records (project_id, id),
  CONSTRAINT "reading_desks_revision_check" CHECK ((revision > 0))
);

CREATE TABLE "reading_documents" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "source_record_id" TEXT NOT NULL,
  "edition" TEXT NOT NULL,
  "locator" TEXT NOT NULL,
  "representation_url" TEXT NOT NULL,
  "media_type" TEXT NOT NULL DEFAULT (CAST('text/plain' AS TEXT)),
  "text_body" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "content_key" TEXT NOT NULL,
  "normalization" TEXT NOT NULL,
  "review_scope" TEXT NOT NULL DEFAULT (CAST('Owner-imported excerpt; source identity and full argument remain unverified' AS TEXT)),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "source_notice" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  CONSTRAINT "reading_documents_check" CHECK ((text_sha256 = ATLAS_ENCODE(ATLAS_SHA256(ATLAS_CONVERT_TO(text_body, CAST('UTF8' AS TEXT))), CAST('hex' AS TEXT)))),
  CONSTRAINT "reading_documents_content_key_check" CHECK ((content_key REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "reading_documents_edition_check" CHECK (((LENGTH(edition) >= 1) AND (LENGTH(edition) <= 1000))),
  CONSTRAINT "reading_documents_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "reading_documents_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "reading_documents_locator_check" CHECK (((LENGTH(locator) >= 1) AND (LENGTH(locator) <= 2000))),
  CONSTRAINT "reading_documents_media_type_check" CHECK ((media_type = CAST('text/plain' AS TEXT))),
  CONSTRAINT "reading_documents_pkey" PRIMARY KEY (id),
  CONSTRAINT "reading_documents_project_id_content_key_key" UNIQUE (project_id, content_key),
  CONSTRAINT "reading_documents_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "reading_documents_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "reading_documents_project_id_source_record_id_fkey" FOREIGN KEY (project_id, source_record_id) REFERENCES records (project_id, id),
  CONSTRAINT "reading_documents_representation_url_check" CHECK ((LENGTH(representation_url) <= 2000)),
  CONSTRAINT "reading_documents_source_notice_check" CHECK ((LENGTH(source_notice) <= 8000)),
  CONSTRAINT "reading_documents_text_body_check" CHECK (((LENGTH(text_body) >= 1) AND (LENGTH(text_body) <= 12000))),
  CONSTRAINT "reading_documents_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "reading_documents_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "reading_draft_revisions" (
  "draft_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "reading_draft_revisions_draft_id_fkey" FOREIGN KEY (draft_id) REFERENCES reading_drafts (id),
  CONSTRAINT "reading_draft_revisions_pkey" PRIMARY KEY (draft_id, revision)
);

CREATE TABLE "reading_drafts" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "record_id" TEXT NOT NULL,
  "context_kind" TEXT NOT NULL,
  "document_id" TEXT,
  "annotation_id" TEXT,
  "text_sha256" TEXT,
  "start_pos" INTEGER CHECK ("start_pos" IS NULL OR "start_pos" BETWEEN -2147483648 AND 2147483647),
  "end_pos" INTEGER CHECK ("end_pos" IS NULL OR "end_pos" BETWEEN -2147483648 AND 2147483647),
  "exact" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "prefix" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "suffix" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "capture_kind" TEXT,
  "base_revision" INTEGER NOT NULL CHECK ("base_revision" IS NULL OR "base_revision" BETWEEN -2147483648 AND 2147483647),
  "base_snapshot" TEXT NOT NULL DEFAULT (JSON('{}')) CHECK ("base_snapshot" IS NULL OR json_valid("base_snapshot")),
  "body" TEXT NOT NULL,
  "mark_style" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "reading_drafts_base_revision_check" CHECK ((base_revision >= 0)),
  CONSTRAINT "reading_drafts_body_check" CHECK ((LENGTH(body) <= 10000)),
  CONSTRAINT "reading_drafts_capture_kind_check" CHECK ((capture_kind IN (CAST('comment' AS TEXT), CAST('term_candidate' AS TEXT), CAST('citation_candidate' AS TEXT)))),
  CONSTRAINT "reading_drafts_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "reading_drafts_check" CHECK ((((context_kind = CAST('record_note' AS TEXT)) AND (document_id IS NULL) AND (annotation_id IS NULL) AND (text_sha256 IS NULL) AND (start_pos IS NULL) AND (end_pos IS NULL) AND (exact = CAST('' AS TEXT)) AND (prefix = CAST('' AS TEXT)) AND (suffix = CAST('' AS TEXT)) AND (capture_kind IS NULL) AND (mark_style = CAST('none' AS TEXT))) OR ((context_kind IN (CAST('capture' AS TEXT), CAST('annotation' AS TEXT))) AND (NOT document_id IS NULL) AND (NOT text_sha256 IS NULL) AND (NOT start_pos IS NULL) AND (NOT end_pos IS NULL) AND (text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT)) AND (start_pos >= 0) AND (end_pos > start_pos) AND ((end_pos - start_pos) <= 500) AND (LENGTH(exact) = (end_pos - start_pos)) AND (NOT capture_kind IS NULL) AND (((context_kind = CAST('capture' AS TEXT)) AND (annotation_id IS NULL) AND (base_revision = 0)) OR ((context_kind = CAST('annotation' AS TEXT)) AND (NOT annotation_id IS NULL) AND (base_revision >= 1)))))),
  CONSTRAINT "reading_drafts_context_kind_check" CHECK ((context_kind IN (CAST('record_note' AS TEXT), CAST('capture' AS TEXT), CAST('annotation' AS TEXT)))),
  CONSTRAINT "reading_drafts_exact_check" CHECK ((LENGTH(exact) <= 500)),
  CONSTRAINT "reading_drafts_id_check" CHECK ((id REGEXP CAST('^urn:research:draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AS TEXT))),
  CONSTRAINT "reading_drafts_mark_style_check" CHECK ((mark_style IN (CAST('highlight' AS TEXT), CAST('underline' AS TEXT), CAST('none' AS TEXT)))),
  CONSTRAINT "reading_drafts_pkey" PRIMARY KEY (id),
  CONSTRAINT "reading_drafts_prefix_check" CHECK ((LENGTH(prefix) <= 40)),
  CONSTRAINT "reading_drafts_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "reading_drafts_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "reading_drafts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "reading_drafts_project_id_record_id_fkey" FOREIGN KEY (project_id, record_id) REFERENCES records (project_id, id),
  CONSTRAINT "reading_drafts_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "reading_drafts_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('discarded' AS TEXT)))),
  CONSTRAINT "reading_drafts_suffix_check" CHECK ((LENGTH(suffix) <= 40))
);

CREATE TABLE "record_revisions" (
  "record_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  "recorded_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "record_revisions_pkey" PRIMARY KEY (record_id, revision),
  CONSTRAINT "record_revisions_record_id_fkey" FOREIGN KEY (record_id) REFERENCES records (id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "records" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "attributes" TEXT NOT NULL DEFAULT (JSON('{}')) CHECK ("attributes" IS NULL OR json_valid("attributes")),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "origin" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "deleted_at" TEXT,
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  CONSTRAINT "records_attributes_check" CHECK ((ATLAS_JSON_TYPE(attributes) = CAST('object' AS TEXT))),
  CONSTRAINT "records_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "records_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "records_kind_check" CHECK ((kind IN (CAST('source' AS TEXT), CAST('work' AS TEXT), CAST('edition' AS TEXT), CAST('passage' AS TEXT), CAST('claim' AS TEXT), CAST('evidence' AS TEXT), CAST('question' AS TEXT), CAST('hypothesis' AS TEXT), CAST('concept' AS TEXT), CAST('lexical_form' AS TEXT), CAST('sense' AS TEXT), CAST('definition' AS TEXT), CAST('occurrence' AS TEXT), CAST('person' AS TEXT), CAST('place' AS TEXT), CAST('period' AS TEXT), CAST('tradition' AS TEXT), CAST('school' AS TEXT), CAST('event' AS TEXT), CAST('article' AS TEXT), CAST('note' AS TEXT), CAST('annotation' AS TEXT), CAST('activity' AS TEXT), CAST('record' AS TEXT)))),
  CONSTRAINT "records_origin_check" CHECK ((origin IN (CAST('canonical_rdf' AS TEXT), CAST('discovery' AS TEXT), CAST('owner' AS TEXT), CAST('proposal' AS TEXT)))),
  CONSTRAINT "records_pkey" PRIMARY KEY (id),
  CONSTRAINT "records_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "records_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "records_review_state_check" CHECK ((review_state IN (CAST('pending' AS TEXT), CAST('needs_followup' AS TEXT), CAST('reviewed' AS TEXT), CAST('disputed' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "records_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "records_summary_check" CHECK ((LENGTH(summary) <= 50000)),
  CONSTRAINT "records_title_check" CHECK (((LENGTH(title) >= 1) AND (LENGTH(title) <= 2000))),
  CONSTRAINT "records_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "relation_types" (
  "predicate" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "from_kinds" TEXT NOT NULL DEFAULT ('[]') CHECK ("from_kinds" IS NULL OR json_valid("from_kinds")),
  "to_kinds" TEXT NOT NULL DEFAULT ('[]') CHECK ("to_kinds" IS NULL OR json_valid("to_kinds")),
  "inverse_traversal" INTEGER NOT NULL DEFAULT (FALSE) CHECK ("inverse_traversal" IS NULL OR "inverse_traversal" IN (0,1)),
  "requires_evidence" INTEGER NOT NULL DEFAULT (FALSE) CHECK ("requires_evidence" IS NULL OR "requires_evidence" IN (0,1)),
  CONSTRAINT "relation_types_pkey" PRIMARY KEY (predicate),
  CONSTRAINT "relation_types_predicate_check" CHECK (((LENGTH(predicate) >= 1) AND (LENGTH(predicate) <= 500)))
);

CREATE TABLE "relations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "from_id" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "to_id" TEXT NOT NULL,
  "provenance" TEXT NOT NULL CHECK ("provenance" IS NULL OR json_valid("provenance")),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  CONSTRAINT "relations_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "relations_pkey" PRIMARY KEY (id),
  CONSTRAINT "relations_predicate_fkey" FOREIGN KEY (predicate) REFERENCES relation_types (predicate),
  CONSTRAINT "relations_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "relations_project_id_from_id_fkey" FOREIGN KEY (project_id, from_id) REFERENCES records (project_id, id),
  CONSTRAINT "relations_project_id_from_id_predicate_to_id_key" UNIQUE (project_id, from_id, predicate, to_id),
  CONSTRAINT "relations_project_id_to_id_fkey" FOREIGN KEY (project_id, to_id) REFERENCES records (project_id, id),
  CONSTRAINT "relations_provenance_check" CHECK (((ATLAS_JSON_TYPE(provenance) = CAST('object' AS TEXT)) AND (NOT ATLAS_JSON_EQUAL(provenance, JSON('{}'))))),
  CONSTRAINT "relations_review_state_check" CHECK ((review_state IN (CAST('pending' AS TEXT), CAST('needs_followup' AS TEXT), CAST('reviewed' AS TEXT), CAST('disputed' AS TEXT), CAST('withdrawn' AS TEXT))))
);

CREATE TABLE "schema_migrations" (
  "name" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "applied_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "schema_migrations_pkey" PRIMARY KEY (name)
);

CREATE TABLE "scripture_citation_revisions" (
  "citation_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "scripture_citation_revisions_citation_id_fkey" FOREIGN KEY (citation_id) REFERENCES scripture_citations (id),
  CONSTRAINT "scripture_citation_revisions_pkey" PRIMARY KEY (citation_id, revision)
);

CREATE TABLE "scripture_citations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "annotation_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "candidate_key" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "detector_kind" TEXT NOT NULL,
  "match_start" INTEGER NOT NULL CHECK ("match_start" IS NULL OR "match_start" BETWEEN -2147483648 AND 2147483647),
  "match_end" INTEGER NOT NULL CHECK ("match_end" IS NULL OR "match_end" BETWEEN -2147483648 AND 2147483647),
  "matched_text" TEXT NOT NULL,
  "proposal" TEXT NOT NULL CHECK ("proposal" IS NULL OR json_valid("proposal")),
  "profile_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "chapter" INTEGER CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah_start" INTEGER CHECK ("ayah_start" IS NULL OR "ayah_start" BETWEEN -2147483648 AND 2147483647),
  "ayah_end" INTEGER CHECK ("ayah_end" IS NULL OR "ayah_end" BETWEEN -2147483648 AND 2147483647),
  "rationale" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "scripture_citations_candidate_key_check" CHECK (((candidate_key = CAST('manual' AS TEXT)) OR (candidate_key REGEXP CAST('^[0-9a-f]{64}$' AS TEXT)))),
  CONSTRAINT "scripture_citations_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "scripture_citations_check" CHECK (((match_end > match_start) AND ((match_end - match_start) <= 500))),
  CONSTRAINT "scripture_citations_check1" CHECK ((LENGTH(matched_text) = (match_end - match_start))),
  CONSTRAINT "scripture_citations_check2" CHECK ((((decision = CAST('confirmed' AS TEXT)) AND (NOT chapter IS NULL) AND (NOT ayah_start IS NULL) AND (NOT ayah_end IS NULL)) OR ((decision = CAST('dismissed' AS TEXT)) AND (chapter IS NULL) AND (ayah_start IS NULL) AND (ayah_end IS NULL)))),
  CONSTRAINT "scripture_citations_decision_check" CHECK ((decision IN (CAST('confirmed' AS TEXT), CAST('dismissed' AS TEXT)))),
  CONSTRAINT "scripture_citations_detector_kind_check" CHECK ((detector_kind IN (CAST('explicit_numeric' AS TEXT), CAST('english_narrative' AS TEXT), CAST('owner_mapping' AS TEXT)))),
  CONSTRAINT "scripture_citations_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "scripture_citations_match_start_check" CHECK ((match_start >= 0)),
  CONSTRAINT "scripture_citations_parser_version_check" CHECK (((LENGTH(parser_version) >= 1) AND (LENGTH(parser_version) <= 100))),
  CONSTRAINT "scripture_citations_pkey" PRIMARY KEY (id),
  CONSTRAINT "scripture_citations_profile_id_check" CHECK ((profile_id = CAST('tanzil-structure-1.0' AS TEXT))),
  CONSTRAINT "scripture_citations_project_id_annotation_id_candidate_key_key" UNIQUE (project_id, annotation_id, candidate_key),
  CONSTRAINT "scripture_citations_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "scripture_citations_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "scripture_citations_project_identity" UNIQUE (project_id, id),
  CONSTRAINT "scripture_citations_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "scripture_citations_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "scripture_citations_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT)))
);

CREATE TABLE "source_intakes" (
  "request_uuid" TEXT NOT NULL,
  "project_id" TEXT,
  "input_sha256" TEXT NOT NULL,
  "source_record_id" TEXT NOT NULL,
  "document_id" TEXT,
  "declarations" TEXT NOT NULL CHECK ("declarations" IS NULL OR json_valid("declarations")),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  CONSTRAINT "source_intakes_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "source_intakes_declarations_check" CHECK (((ATLAS_JSON_TYPE(declarations) = CAST('object' AS TEXT)) AND (LENGTH(ATLAS_JSON_TEXT((declarations))) <= 50000))),
  CONSTRAINT "source_intakes_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "source_intakes_pkey" PRIMARY KEY (request_uuid),
  CONSTRAINT "source_intakes_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "source_intakes_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT "source_intakes_project_id_source_record_id_fkey" FOREIGN KEY (project_id, source_record_id) REFERENCES records (project_id, id),
  CONSTRAINT "source_intakes_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "vault_connections" (
  "workspace_id" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "repository_id" INTEGER NOT NULL,
  "account_id" INTEGER NOT NULL,
  "account_login" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "connected_by" TEXT NOT NULL,
  "connected_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "vault_connections_account_id_check" CHECK ((account_id > 0)),
  CONSTRAINT "vault_connections_account_login_check" CHECK (((LENGTH(account_login) >= 1) AND (LENGTH(account_login) <= 100))),
  CONSTRAINT "vault_connections_branch_check" CHECK (((LENGTH(branch) >= 1) AND (LENGTH(branch) <= 128))),
  CONSTRAINT "vault_connections_connected_by_check" CHECK (((LENGTH(connected_by) >= 1) AND (LENGTH(connected_by) <= 500))),
  CONSTRAINT "vault_connections_pkey" PRIMARY KEY (workspace_id),
  CONSTRAINT "vault_connections_repository_check" CHECK (((LENGTH(repository) >= 3) AND (LENGTH(repository) <= 201))),
  CONSTRAINT "vault_connections_repository_id_check" CHECK ((repository_id > 0)),
  CONSTRAINT "vault_connections_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "vault_connections_workspace_id_check" CHECK ((workspace_id = CAST('owner' AS TEXT)))
);

CREATE TABLE "vault_issue_comments" (
  "repository_id" INTEGER NOT NULL,
  "issue_id" INTEGER NOT NULL,
  "comment_id" INTEGER NOT NULL,
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "vault_issue_comments_pkey" PRIMARY KEY (repository_id, issue_id, comment_id)
);

CREATE TABLE "vault_sync_pages" (
  "entry_id" TEXT NOT NULL,
  "base_page" TEXT CHECK ("base_page" IS NULL OR json_valid("base_page")),
  "confirmed_head" TEXT,
  "dirty_revision" INTEGER NOT NULL CHECK ("dirty_revision" IS NULL OR "dirty_revision" BETWEEN -2147483648 AND 2147483647),
  "confirmed_revision" INTEGER NOT NULL DEFAULT (0) CHECK ("confirmed_revision" IS NULL OR "confirmed_revision" BETWEEN -2147483648 AND 2147483647),
  "selected_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "notebook_entry_id" TEXT,
  "annotation_id" TEXT,
  CONSTRAINT "vault_page_authority" CHECK (((NUM_NONNULLS(notebook_entry_id, annotation_id) = 1) AND (entry_id = COALESCE(notebook_entry_id, annotation_id)))),
  CONSTRAINT "vault_page_identity" CHECK ((entry_id REGEXP CAST('^urn:research:(notebook|annotation):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AS TEXT))),
  CONSTRAINT "vault_sync_pages_annotation_id_fkey" FOREIGN KEY (annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "vault_sync_pages_confirmed_head_check" CHECK (((confirmed_head IS NULL) OR (confirmed_head REGEXP CAST('^[0-9a-f]{40}$' AS TEXT)))),
  CONSTRAINT "vault_sync_pages_confirmed_revision_check" CHECK ((confirmed_revision >= 0)),
  CONSTRAINT "vault_sync_pages_dirty_revision_check" CHECK ((dirty_revision > 0)),
  CONSTRAINT "vault_sync_pages_notebook_entry_id_fkey" FOREIGN KEY (notebook_entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "vault_sync_pages_pkey" PRIMARY KEY (entry_id)
);

CREATE TABLE "vault_sync_plans" (
  "id" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "repository_id" INTEGER NOT NULL,
  "account_id" INTEGER NOT NULL,
  "branch" TEXT NOT NULL,
  "base_head" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "state" TEXT NOT NULL DEFAULT (CAST('prepared' AS TEXT)),
  "commit_sha" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "vault_sync_plans_base_head_check" CHECK ((base_head REGEXP CAST('^[0-9a-f]{40}$' AS TEXT))),
  CONSTRAINT "vault_sync_plans_commit_sha_check" CHECK (((commit_sha IS NULL) OR (commit_sha REGEXP CAST('^[0-9a-f]{40}$' AS TEXT)))),
  CONSTRAINT "vault_sync_plans_input_sha256_check" CHECK ((input_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "vault_sync_plans_payload_check" CHECK ((ATLAS_OCTET_LENGTH(ATLAS_JSON_TEXT((payload))) <= 3000000)),
  CONSTRAINT "vault_sync_plans_pkey" PRIMARY KEY (id),
  CONSTRAINT "vault_sync_plans_state_check" CHECK ((state IN (CAST('prepared' AS TEXT), CAST('dispatching' AS TEXT), CAST('confirmed' AS TEXT), CAST('conflict' AS TEXT))))
);

CREATE TABLE "vault_task_operations" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "input_sha256" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "vault_task_operations_kind_check" CHECK ((kind IN (CAST('create' AS TEXT), CAST('state' AS TEXT)))),
  CONSTRAINT "vault_task_operations_pkey" PRIMARY KEY (id),
  CONSTRAINT "vault_task_operations_state_check" CHECK ((state IN (CAST('pending' AS TEXT), CAST('dispatching' AS TEXT), CAST('confirmed' AS TEXT), CAST('conflict' AS TEXT)))),
  CONSTRAINT "vault_task_operations_task_id_fkey" FOREIGN KEY (task_id) REFERENCES vault_tasks (id)
);

CREATE TABLE "vault_tasks" (
  "id" TEXT NOT NULL,
  "creation_sha256" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "context_entry_id" TEXT,
  "context_revision" INTEGER CHECK ("context_revision" IS NULL OR "context_revision" BETWEEN -2147483648 AND 2147483647),
  "context_page" TEXT CHECK ("context_page" IS NULL OR json_valid("context_page")),
  "state" TEXT NOT NULL DEFAULT (CAST('open' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "repository_id" INTEGER,
  "remote_id" INTEGER,
  "remote_number" INTEGER CHECK ("remote_number" IS NULL OR "remote_number" BETWEEN -2147483648 AND 2147483647),
  "remote_node_id" TEXT,
  "remote_snapshot" TEXT CHECK ("remote_snapshot" IS NULL OR json_valid("remote_snapshot")),
  "write_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "status_note" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "vault_tasks_body_check" CHECK ((LENGTH(body) <= 20000)),
  CONSTRAINT "vault_tasks_check" CHECK (((context_entry_id IS NULL) = (context_revision IS NULL))),
  CONSTRAINT "vault_tasks_context_entry_id_fkey" FOREIGN KEY (context_entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "vault_tasks_pkey" PRIMARY KEY (id),
  CONSTRAINT "vault_tasks_remote_id_key" UNIQUE (remote_id),
  CONSTRAINT "vault_tasks_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "vault_tasks_state_check" CHECK ((state IN (CAST('open' AS TEXT), CAST('closed' AS TEXT)))),
  CONSTRAINT "vault_tasks_title_check" CHECK (((LENGTH(TRIM(title)) >= 1) AND (LENGTH(TRIM(title)) <= 300))),
  CONSTRAINT "vault_tasks_write_state_check" CHECK ((write_state IN (CAST('pending' AS TEXT), CAST('uncertain' AS TEXT), CAST('synced' AS TEXT), CAST('conflict' AS TEXT))))
);

CREATE TABLE "verse_material_revisions" (
  "material_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "verse_material_revisions_material_id_fkey" FOREIGN KEY (material_id) REFERENCES verse_materials (id),
  CONSTRAINT "verse_material_revisions_pkey" PRIMARY KEY (material_id, revision)
);

CREATE TABLE "verse_materials" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "annotation_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "text_sha256" TEXT NOT NULL,
  "creation_sha256" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah_start" INTEGER NOT NULL CHECK ("ayah_start" IS NULL OR "ayah_start" BETWEEN -2147483648 AND 2147483647),
  "ayah_end" INTEGER NOT NULL CHECK ("ayah_end" IS NULL OR "ayah_end" BETWEEN -2147483648 AND 2147483647),
  "material_kind" TEXT NOT NULL,
  "link_kind" TEXT NOT NULL,
  "citation_basis" TEXT NOT NULL,
  "citation_id" TEXT,
  "citation_snapshot" TEXT CHECK ("citation_snapshot" IS NULL OR json_valid("citation_snapshot")),
  "marker_start" INTEGER CHECK ("marker_start" IS NULL OR "marker_start" BETWEEN -2147483648 AND 2147483647),
  "marker_end" INTEGER CHECK ("marker_end" IS NULL OR "marker_end" BETWEEN -2147483648 AND 2147483647),
  "marker_text" TEXT,
  "attribution" TEXT NOT NULL,
  "language_tag" TEXT NOT NULL,
  "source_scope" TEXT NOT NULL,
  "assertion_mode" TEXT NOT NULL,
  "assertion_text" TEXT NOT NULL,
  "reading_note" TEXT NOT NULL,
  "period_note" TEXT NOT NULL,
  "tradition_note" TEXT NOT NULL,
  "context_basis" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "review_state" TEXT NOT NULL DEFAULT (CAST('pending' AS TEXT)),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "verse_materials_assertion_mode_check" CHECK ((assertion_mode IN (CAST('none' AS TEXT), CAST('quotation' AS TEXT), CAST('paraphrase' AS TEXT)))),
  CONSTRAINT "verse_materials_assertion_text_check" CHECK ((LENGTH(assertion_text) <= 5000)),
  CONSTRAINT "verse_materials_attribution_check" CHECK (((LENGTH(TRIM(attribution)) >= 1) AND (LENGTH(TRIM(attribution)) <= 2000))),
  CONSTRAINT "verse_materials_ayah_start_check" CHECK ((ayah_start >= 1)),
  CONSTRAINT "verse_materials_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "verse_materials_chapter_check" CHECK (((chapter >= 1) AND (chapter <= 114))),
  CONSTRAINT "verse_materials_check" CHECK ((ayah_end >= ayah_start)),
  CONSTRAINT "verse_materials_check1" CHECK (((material_kind IN (CAST('arabic_text' AS TEXT), CAST('translation' AS TEXT))) = (link_kind = CAST('representation' AS TEXT)))),
  CONSTRAINT "verse_materials_check2" CHECK ((((link_kind = CAST('interpretive_claim' AS TEXT)) AND (assertion_mode <> CAST('none' AS TEXT)) AND (LENGTH(TRIM(assertion_text)) > 0)) OR ((link_kind <> CAST('interpretive_claim' AS TEXT)) AND (assertion_mode = CAST('none' AS TEXT)) AND (assertion_text = CAST('' AS TEXT))))),
  CONSTRAINT "verse_materials_check3" CHECK ((((period_note = CAST('' AS TEXT)) AND (tradition_note = CAST('' AS TEXT))) OR (LENGTH(TRIM(context_basis)) > 0))),
  CONSTRAINT "verse_materials_check4" CHECK ((((link_kind = CAST('explicit_citation' AS TEXT)) AND (citation_basis <> CAST('none' AS TEXT))) OR ((link_kind <> CAST('explicit_citation' AS TEXT)) AND (citation_basis = CAST('none' AS TEXT))))),
  CONSTRAINT "verse_materials_check5" CHECK ((((citation_basis = CAST('resolved_reference' AS TEXT)) AND (NOT citation_id IS NULL) AND (NOT citation_snapshot IS NULL)) OR ((citation_basis <> CAST('resolved_reference' AS TEXT)) AND (citation_id IS NULL) AND (citation_snapshot IS NULL)))),
  CONSTRAINT "verse_materials_check6" CHECK ((((citation_basis <> CAST('none' AS TEXT)) AND (NOT marker_start IS NULL) AND (NOT marker_end IS NULL) AND (NOT marker_text IS NULL) AND (marker_start >= 0) AND (marker_end > marker_start) AND (LENGTH(marker_text) = (marker_end - marker_start))) OR ((citation_basis = CAST('none' AS TEXT)) AND (marker_start IS NULL) AND (marker_end IS NULL) AND (marker_text IS NULL)))),
  CONSTRAINT "verse_materials_citation_basis_check" CHECK ((citation_basis IN (CAST('none' AS TEXT), CAST('resolved_reference' AS TEXT), CAST('owner_identified' AS TEXT)))),
  CONSTRAINT "verse_materials_context_basis_check" CHECK ((LENGTH(context_basis) <= 2000)),
  CONSTRAINT "verse_materials_creation_sha256_check" CHECK ((creation_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "verse_materials_id_check" CHECK (((LENGTH(id) >= 1) AND (LENGTH(id) <= 500))),
  CONSTRAINT "verse_materials_language_tag_check" CHECK (((LENGTH(language_tag) >= 1) AND (LENGTH(language_tag) <= 100))),
  CONSTRAINT "verse_materials_link_kind_check" CHECK ((link_kind IN (CAST('representation' AS TEXT), CAST('explicit_citation' AS TEXT), CAST('discussion' AS TEXT), CAST('interpretive_claim' AS TEXT)))),
  CONSTRAINT "verse_materials_material_kind_check" CHECK ((material_kind IN (CAST('arabic_text' AS TEXT), CAST('translation' AS TEXT), CAST('tafsir' AS TEXT), CAST('linguistic_annotation' AS TEXT), CAST('scholarship' AS TEXT)))),
  CONSTRAINT "verse_materials_period_note_check" CHECK ((LENGTH(period_note) <= 2000)),
  CONSTRAINT "verse_materials_pkey" PRIMARY KEY (id),
  CONSTRAINT "verse_materials_profile_id_check" CHECK ((profile_id = CAST('tanzil-structure-1.0' AS TEXT))),
  CONSTRAINT "verse_materials_project_id_annotation_id_fkey" FOREIGN KEY (project_id, annotation_id) REFERENCES reading_annotations (project_id, id),
  CONSTRAINT "verse_materials_project_id_citation_id_fkey" FOREIGN KEY (project_id, citation_id) REFERENCES scripture_citations (project_id, id),
  CONSTRAINT "verse_materials_project_id_document_id_fkey" FOREIGN KEY (project_id, document_id) REFERENCES reading_documents (project_id, id),
  CONSTRAINT "verse_materials_project_id_id_key" UNIQUE (project_id, id),
  CONSTRAINT "verse_materials_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "verse_materials_reading_note_check" CHECK ((LENGTH(reading_note) <= 2000)),
  CONSTRAINT "verse_materials_review_state_check" CHECK ((review_state = CAST('pending' AS TEXT))),
  CONSTRAINT "verse_materials_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "verse_materials_source_scope_check" CHECK (((LENGTH(TRIM(source_scope)) >= 1) AND (LENGTH(TRIM(source_scope)) <= 10000))),
  CONSTRAINT "verse_materials_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "verse_materials_text_sha256_check" CHECK ((text_sha256 REGEXP CAST('^[0-9a-f]{64}$' AS TEXT))),
  CONSTRAINT "verse_materials_tradition_note_check" CHECK ((LENGTH(tradition_note) <= 2000))
);

CREATE TABLE "workspace_annotation_trash" (
  "annotation_id" TEXT NOT NULL,
  "target_revision" INTEGER NOT NULL CHECK ("target_revision" IS NULL OR "target_revision" BETWEEN -2147483648 AND 2147483647),
  "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_annotation_trash_annotation_id_fkey" FOREIGN KEY (annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "workspace_annotation_trash_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_annotation_trash_pkey" PRIMARY KEY (annotation_id),
  CONSTRAINT "workspace_annotation_trash_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_annotation_trash_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('trashed' AS TEXT)))),
  CONSTRAINT "workspace_annotation_trash_target_revision_check" CHECK ((target_revision > 0))
);

CREATE TABLE "workspace_annotation_trash_history" (
  "annotation_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "workspace_annotation_trash_history_annotation_id_fkey" FOREIGN KEY (annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "workspace_annotation_trash_history_pkey" PRIMARY KEY (annotation_id, revision)
);

CREATE TABLE "workspace_collection_items" (
  "collection_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_collection_items_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_collection_items_collection_id_fkey" FOREIGN KEY (collection_id) REFERENCES workspace_collections (id),
  CONSTRAINT "workspace_collection_items_pkey" PRIMARY KEY (collection_id, target_kind, target_id),
  CONSTRAINT "workspace_collection_items_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_collection_items_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('removed' AS TEXT)))),
  CONSTRAINT "workspace_collection_items_target_kind_check" CHECK ((target_kind IN (CAST('entry' AS TEXT), CAST('record' AS TEXT), CAST('annotation' AS TEXT))))
);

CREATE TABLE "workspace_collections" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "title" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "creation_sha256" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_collections_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_collections_creation_sha256_check" CHECK ((LENGTH(creation_sha256) = 64)),
  CONSTRAINT "workspace_collections_pkey" PRIMARY KEY (id),
  CONSTRAINT "workspace_collections_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_collections_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('archived' AS TEXT)))),
  CONSTRAINT "workspace_collections_title_check" CHECK (((LENGTH(TRIM(title)) >= 1) AND (LENGTH(TRIM(title)) <= 300))),
  CONSTRAINT "workspace_collections_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_connections" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "from_kind" TEXT NOT NULL,
  "from_id" TEXT NOT NULL,
  "to_kind" TEXT NOT NULL,
  "to_id" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "attribution" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "evidence_annotation_id" TEXT,
  "state" TEXT NOT NULL DEFAULT (CAST('tentative' AS TEXT)),
  "creation_sha256" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_connections_attribution_check" CHECK ((LENGTH(attribution) <= 1000)),
  CONSTRAINT "workspace_connections_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_connections_check" CHECK (((state <> CAST('accepted' AS TEXT)) OR (relation IN (CAST('personal_association' AS TEXT), CAST('comments_on' AS TEXT), CAST('asks_about' AS TEXT))) OR ((NOT evidence_annotation_id IS NULL) AND (LENGTH(TRIM(attribution)) > 0)))),
  CONSTRAINT "workspace_connections_creation_sha256_check" CHECK ((LENGTH(creation_sha256) = 64)),
  CONSTRAINT "workspace_connections_evidence_annotation_id_fkey" FOREIGN KEY (evidence_annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "workspace_connections_from_kind_check" CHECK ((from_kind IN (CAST('entry' AS TEXT), CAST('record' AS TEXT), CAST('annotation' AS TEXT)))),
  CONSTRAINT "workspace_connections_pkey" PRIMARY KEY (id),
  CONSTRAINT "workspace_connections_rationale_check" CHECK (((LENGTH(TRIM(rationale)) >= 1) AND (LENGTH(TRIM(rationale)) <= 2000))),
  CONSTRAINT "workspace_connections_relation_check" CHECK ((relation IN (CAST('personal_association' AS TEXT), CAST('comments_on' AS TEXT), CAST('asks_about' AS TEXT), CAST('defines' AS TEXT), CAST('supports' AS TEXT), CAST('challenges' AS TEXT), CAST('qualifies' AS TEXT), CAST('interprets' AS TEXT), CAST('historical_influence' AS TEXT)))),
  CONSTRAINT "workspace_connections_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_connections_state_check" CHECK ((state IN (CAST('tentative' AS TEXT), CAST('accepted' AS TEXT), CAST('withdrawn' AS TEXT)))),
  CONSTRAINT "workspace_connections_to_kind_check" CHECK ((to_kind IN (CAST('entry' AS TEXT), CAST('record' AS TEXT), CAST('annotation' AS TEXT)))),
  CONSTRAINT "workspace_connections_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_gutenberg_places" (
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "book_id" INTEGER NOT NULL CHECK ("book_id" IS NULL OR "book_id" BETWEEN -2147483648 AND 2147483647),
  "version" TEXT NOT NULL,
  "section" INTEGER NOT NULL CHECK ("section" IS NULL OR "section" BETWEEN -2147483648 AND 2147483647),
  "position" INTEGER NOT NULL CHECK ("position" IS NULL OR "position" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_gutenberg_places_book_id_version_fkey" FOREIGN KEY (book_id, version) REFERENCES gutenberg_books (book_id, version),
  CONSTRAINT "workspace_gutenberg_places_pkey" PRIMARY KEY (workspace_id, book_id),
  CONSTRAINT "workspace_gutenberg_places_position_check" CHECK ((("position" >= 0) AND ("position" <= 12000))),
  CONSTRAINT "workspace_gutenberg_places_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_gutenberg_places_section_check" CHECK (((section >= 0) AND (section <= 1000))),
  CONSTRAINT "workspace_gutenberg_places_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_investigations" (
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "target_revision" INTEGER NOT NULL CHECK ("target_revision" IS NULL OR "target_revision" BETWEEN -2147483648 AND 2147483647),
  "state" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_investigations_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_investigations_pkey" PRIMARY KEY (target_kind, target_id),
  CONSTRAINT "workspace_investigations_reason_check" CHECK (((LENGTH(TRIM(reason)) >= 1) AND (LENGTH(TRIM(reason)) <= 2000))),
  CONSTRAINT "workspace_investigations_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_investigations_state_check" CHECK ((state IN (CAST('open' AS TEXT), CAST('investigating' AS TEXT), CAST('provisional' AS TEXT), CAST('resolved' AS TEXT), CAST('revisiting' AS TEXT)))),
  CONSTRAINT "workspace_investigations_target_kind_check" CHECK ((target_kind IN (CAST('entry' AS TEXT), CAST('record' AS TEXT)))),
  CONSTRAINT "workspace_investigations_target_revision_check" CHECK ((target_revision > 0))
);

CREATE TABLE "workspace_legacy_collections" (
  "project_id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "mapped_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_legacy_collections_collection_id_fkey" FOREIGN KEY (collection_id) REFERENCES workspace_collections (id),
  CONSTRAINT "workspace_legacy_collections_collection_id_key" UNIQUE (collection_id),
  CONSTRAINT "workspace_legacy_collections_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "workspace_legacy_collections_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE TABLE "workspace_note_trash" (
  "entry_id" TEXT NOT NULL,
  "target_revision" INTEGER NOT NULL CHECK ("target_revision" IS NULL OR "target_revision" BETWEEN -2147483648 AND 2147483647),
  "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_note_trash_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_note_trash_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "workspace_note_trash_pkey" PRIMARY KEY (entry_id),
  CONSTRAINT "workspace_note_trash_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_note_trash_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('trashed' AS TEXT)))),
  CONSTRAINT "workspace_note_trash_target_revision_check" CHECK ((target_revision > 0))
);

CREATE TABLE "workspace_note_trash_history" (
  "entry_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "workspace_note_trash_history_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "workspace_note_trash_history_pkey" PRIMARY KEY (entry_id, revision)
);

CREATE TABLE "workspace_organization_history" (
  "entity" TEXT NOT NULL,
  "identity" TEXT NOT NULL CHECK ("identity" IS NULL OR json_valid("identity")),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "workspace_organization_history_pkey" PRIMARY KEY (entity, identity, revision)
);

CREATE TABLE "workspace_quran_places" (
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "resource_key" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_quran_places_ayah_check" CHECK (((ayah >= 1) AND (ayah <= 286))),
  CONSTRAINT "workspace_quran_places_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_quran_places_chapter_check" CHECK (((chapter >= 1) AND (chapter <= 114))),
  CONSTRAINT "workspace_quran_places_check" CHECK ((ayah <= ATLAS_ARRAY_AT((JSON_ARRAY(7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6)), chapter, 1))),
  CONSTRAINT "workspace_quran_places_pkey" PRIMARY KEY (workspace_id),
  CONSTRAINT "workspace_quran_places_resource_key_check" CHECK ((resource_key IN (CAST('tanzil-uthmani' AS TEXT), CAST('itani-god' AS TEXT)))),
  CONSTRAINT "workspace_quran_places_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_quran_places_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_quran_progress_revisions" (
  "workspace_id" TEXT NOT NULL,
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "workspace_quran_progress_revisio_workspace_id_chapter_ayah_fkey" FOREIGN KEY (workspace_id, chapter, ayah) REFERENCES workspace_quran_reading_progress (workspace_id, chapter, ayah),
  CONSTRAINT "workspace_quran_progress_revisions_pkey" PRIMARY KEY (workspace_id, chapter, ayah, revision)
);

CREATE TABLE "workspace_quran_reading_progress" (
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "chapter" INTEGER NOT NULL CHECK ("chapter" IS NULL OR "chapter" BETWEEN -2147483648 AND 2147483647),
  "ayah" INTEGER NOT NULL CHECK ("ayah" IS NULL OR "ayah" BETWEEN -2147483648 AND 2147483647),
  "is_read" INTEGER NOT NULL CHECK ("is_read" IS NULL OR "is_read" IN (0,1)),
  "read_at" TEXT,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_quran_reading_progress_ayah_check" CHECK (((ayah >= 1) AND (ayah <= 286))),
  CONSTRAINT "workspace_quran_reading_progress_changed_by_check" CHECK (((LENGTH(TRIM(changed_by)) >= 1) AND (LENGTH(TRIM(changed_by)) <= 500))),
  CONSTRAINT "workspace_quran_reading_progress_chapter_check" CHECK (((chapter >= 1) AND (chapter <= 114))),
  CONSTRAINT "workspace_quran_reading_progress_check" CHECK ((is_read = (NOT read_at IS NULL))),
  CONSTRAINT "workspace_quran_reading_progress_check1" CHECK ((ayah <= ATLAS_ARRAY_AT((JSON_ARRAY(7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6)), chapter, 1))),
  CONSTRAINT "workspace_quran_reading_progress_pkey" PRIMARY KEY (workspace_id, chapter, ayah),
  CONSTRAINT "workspace_quran_reading_progress_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_quran_reading_progress_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_reading_desk_revisions" (
  "workspace_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot" TEXT NOT NULL CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  CONSTRAINT "workspace_reading_desk_revisions_pkey" PRIMARY KEY (workspace_id, revision),
  CONSTRAINT "workspace_reading_desk_revisions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_reading_desks" (
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "record_id" TEXT NOT NULL,
  "document_id" TEXT,
  "annotation_id" TEXT,
  "start_pos" INTEGER CHECK ("start_pos" IS NULL OR "start_pos" BETWEEN -2147483648 AND 2147483647),
  "end_pos" INTEGER CHECK ("end_pos" IS NULL OR "end_pos" BETWEEN -2147483648 AND 2147483647),
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_reading_desks_annotation_id_fkey" FOREIGN KEY (annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "workspace_reading_desks_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_reading_desks_check" CHECK ((((document_id IS NULL) AND (annotation_id IS NULL) AND (start_pos IS NULL) AND (end_pos IS NULL)) OR ((NOT document_id IS NULL) AND (NOT start_pos IS NULL) AND (NOT end_pos IS NULL) AND (start_pos >= 0) AND (end_pos >= start_pos)))),
  CONSTRAINT "workspace_reading_desks_document_id_fkey" FOREIGN KEY (document_id) REFERENCES reading_documents (id),
  CONSTRAINT "workspace_reading_desks_pkey" PRIMARY KEY (workspace_id),
  CONSTRAINT "workspace_reading_desks_record_id_fkey" FOREIGN KEY (record_id) REFERENCES records (id),
  CONSTRAINT "workspace_reading_desks_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_reading_desks_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "workspace_reflections" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "entry_revision" INTEGER NOT NULL CHECK ("entry_revision" IS NULL OR "entry_revision" BETWEEN -2147483648 AND 2147483647),
  "reason" TEXT NOT NULL,
  "uncertainty" TEXT NOT NULL DEFAULT (CAST('' AS TEXT)),
  "evidence_annotation_id" TEXT,
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "creation_sha256" TEXT NOT NULL,
  CONSTRAINT "workspace_reflection_revision" FOREIGN KEY (entry_id, entry_revision) REFERENCES notebook_revisions (entry_id, revision),
  CONSTRAINT "workspace_reflections_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_reflections_creation_sha256_check" CHECK ((LENGTH(creation_sha256) = 64)),
  CONSTRAINT "workspace_reflections_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES notebook_entries (id),
  CONSTRAINT "workspace_reflections_entry_revision_check" CHECK ((entry_revision > 0)),
  CONSTRAINT "workspace_reflections_evidence_annotation_id_fkey" FOREIGN KEY (evidence_annotation_id) REFERENCES reading_annotations (id),
  CONSTRAINT "workspace_reflections_pkey" PRIMARY KEY (id),
  CONSTRAINT "workspace_reflections_reason_check" CHECK (((LENGTH(TRIM(reason)) >= 1) AND (LENGTH(TRIM(reason)) <= 2000))),
  CONSTRAINT "workspace_reflections_uncertainty_check" CHECK ((LENGTH(uncertainty) <= 2000))
);

CREATE TABLE "workspace_saved_views" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL DEFAULT (CAST('owner' AS TEXT)),
  "title" TEXT NOT NULL,
  "query" TEXT NOT NULL CHECK ("query" IS NULL OR json_valid("query")),
  "state" TEXT NOT NULL DEFAULT (CAST('active' AS TEXT)),
  "creation_sha256" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT (1) CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "changed_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  "updated_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "workspace_saved_views_changed_by_check" CHECK (((LENGTH(changed_by) >= 1) AND (LENGTH(changed_by) <= 500))),
  CONSTRAINT "workspace_saved_views_creation_sha256_check" CHECK ((LENGTH(creation_sha256) = 64)),
  CONSTRAINT "workspace_saved_views_pkey" PRIMARY KEY (id),
  CONSTRAINT "workspace_saved_views_query_check" CHECK (((ATLAS_JSON_TYPE(query) = CAST('object' AS TEXT)) AND ((query ->> CAST('version' AS TEXT)) = CAST('1' AS TEXT)))),
  CONSTRAINT "workspace_saved_views_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "workspace_saved_views_state_check" CHECK ((state IN (CAST('active' AS TEXT), CAST('archived' AS TEXT)))),
  CONSTRAINT "workspace_saved_views_title_check" CHECK (((LENGTH(TRIM(title)) >= 1) AND (LENGTH(TRIM(title)) <= 300))),
  CONSTRAINT "workspace_saved_views_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES owner_workspaces (id)
);

CREATE TABLE "public_publication_heads" (
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" IS NULL OR "revision" BETWEEN -2147483648 AND 2147483647),
  "snapshot_id" TEXT,
  "status" TEXT NOT NULL,
  "changed_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "publication_heads_check" CHECK ((((status = CAST('published' AS TEXT)) AND (NOT snapshot_id IS NULL)) OR ((status = CAST('withdrawn' AS TEXT)) AND (snapshot_id IS NULL)))),
  CONSTRAINT "publication_heads_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "publication_heads_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "publication_heads_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES public_snapshots (id),
  CONSTRAINT "publication_heads_status_check" CHECK ((status IN (CAST('published' AS TEXT), CAST('withdrawn' AS TEXT))))
);

CREATE TABLE "public_snapshots" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "published_at" TEXT NOT NULL DEFAULT (ATLAS_NOW()),
  CONSTRAINT "snapshots_payload_check" CHECK ((ATLAS_JSON_TYPE(payload) = CAST('object' AS TEXT))),
  CONSTRAINT "snapshots_pkey" PRIMARY KEY (id)
);

CREATE INDEX desktop_artifacts_digest ON desktop_artifacts(sha256);

CREATE INDEX desktop_folder_parent ON desktop_folders(parent_id, id);

CREATE INDEX desktop_folder_pages ON desktop_page_positions(folder_id, entry_id);

CREATE INDEX desktop_page_children ON desktop_page_positions(parent_id, entry_id);

CREATE INDEX lexicon_definitions_annotation ON lexicon_definitions(project_id, annotation_id, id);

CREATE INDEX lexicon_definitions_concept ON lexicon_definitions(project_id, concept_id, id);

CREATE UNIQUE INDEX lexicon_canonical_form ON lexicon_forms(project_id, entry_id) WHERE (form_kind = CAST('canonical' AS TEXT));

CREATE INDEX lexicon_occurrences_sense ON lexicon_occurrences(project_id, sense_id, id);

CREATE INDEX lexicon_senses_concept ON lexicon_senses(project_id, concept_id, id);

CREATE INDEX library_documents_work ON library_document_bindings(work_id, document_id);

CREATE INDEX library_projects_project ON library_project_items(project_id, item_id) WHERE (state <> CAST('removed' AS TEXT));

CREATE INDEX notebook_drafts_active ON notebook_drafts(project_id, state, id);

CREATE INDEX notebook_project_order ON notebook_entries(project_id, id);

CREATE INDEX workspace_notes_recent ON notebook_entries(workspace_id, updated_at DESC, id) WHERE (state = CAST('active' AS TEXT));

CREATE INDEX reading_annotations_document ON reading_annotations(project_id, document_id, id);

CREATE INDEX reading_documents_source ON reading_documents(project_id, source_record_id, id);

CREATE UNIQUE INDEX workspace_documents_content ON reading_documents(source_record_id, content_key) WHERE (project_id IS NULL);

CREATE INDEX reading_drafts_context ON reading_drafts(project_id, record_id, state, id);

CREATE INDEX records_project_kind ON records(project_id, kind);

CREATE INDEX relations_from ON relations(project_id, from_id, predicate);

CREATE INDEX relations_to ON relations(project_id, to_id, predicate);

CREATE INDEX scripture_citations_verse ON scripture_citations(project_id, chapter, ayah_start, ayah_end, id) WHERE (decision = CAST('confirmed' AS TEXT));

CREATE INDEX verse_materials_active_reference ON verse_materials(project_id, chapter, ayah_start, ayah_end, id) WHERE (state = CAST('active' AS TEXT));

CREATE INDEX verse_materials_annotation ON verse_materials(project_id, annotation_id, id);

CREATE INDEX workspace_collection_target ON workspace_collection_items(target_kind, target_id, collection_id) WHERE (state = CAST('active' AS TEXT));

CREATE INDEX workspace_connections_from ON workspace_connections(from_kind, from_id) WHERE (state <> CAST('withdrawn' AS TEXT));

CREATE INDEX workspace_connections_to ON workspace_connections(to_kind, to_id) WHERE (state <> CAST('withdrawn' AS TEXT));
