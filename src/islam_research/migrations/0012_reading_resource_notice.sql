-- Notices travel with immutable text representations and private exports.
ALTER TABLE research.reading_documents ADD COLUMN source_notice text NOT NULL DEFAULT ''
    CHECK (length(source_notice)<=8000);
