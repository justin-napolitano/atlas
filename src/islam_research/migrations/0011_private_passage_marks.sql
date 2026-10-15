-- Presentation of an existing private annotation, never scholarly review state.
-- 0009 and 0010 are reserved for independent verse/source-intake slices.
ALTER TABLE research.reading_annotations ADD COLUMN mark_style text NOT NULL DEFAULT 'highlight'
    CHECK (mark_style IN ('highlight','underline','none'));
-- Existing revision snapshots intentionally retain their original shape.
-- Subsequent revisions use the existing to_jsonb history trigger and include it.
