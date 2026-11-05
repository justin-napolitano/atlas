-- Search remains private and uses the same transaction/revision authority as notes.
CREATE INDEX personal_states_note_text ON research.personal_states
    USING gin (to_tsvector('simple', note));
