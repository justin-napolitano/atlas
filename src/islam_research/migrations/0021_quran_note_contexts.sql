-- Personal organizational context, never an exact selector or evidence assertion.
CREATE TABLE research.quran_note_contexts (
 entry_id text PRIMARY KEY,
 project_id text NOT NULL,
 resource_key text NOT NULL CHECK(resource_key IN ('tanzil-uthmani','itani-god')),
 note_scope text NOT NULL CHECK(note_scope IN ('verse','surah','source')),
 chapter integer, ayah_start integer, ayah_end integer,
 FOREIGN KEY(project_id,entry_id) REFERENCES research.notebook_entries(project_id,id),
 CHECK((note_scope='source' AND chapter IS NULL AND ayah_start IS NULL AND ayah_end IS NULL)
  OR (note_scope='surah' AND chapter IS NOT NULL AND chapter BETWEEN 1 AND 114 AND ayah_start IS NULL AND ayah_end IS NULL)
  OR (note_scope='verse' AND chapter IS NOT NULL AND ayah_start IS NOT NULL AND ayah_end IS NOT NULL AND chapter BETWEEN 1 AND 114 AND ayah_start>=1 AND ayah_end>=ayah_start AND ayah_end<=286))
);
REVOKE ALL ON research.quran_note_contexts FROM PUBLIC;
