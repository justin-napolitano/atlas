CREATE INDEX reading_annotations_text ON research.reading_annotations
    USING gin(to_tsvector('simple',exact || ' ' || body));
