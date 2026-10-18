-- Private semantic resume location; independent of viewport geometry and review status.
CREATE TABLE research.quran_places (
 project_id text PRIMARY KEY REFERENCES research.projects(id),
 resource_key text NOT NULL CHECK(resource_key IN ('tanzil-uthmani','itani-god')),
 chapter integer NOT NULL CHECK(chapter BETWEEN 1 AND 114),
 ayah integer NOT NULL CHECK(ayah BETWEEN 1 AND 286),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(ayah <= (ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6])[chapter])
);
REVOKE ALL ON research.quran_places FROM PUBLIC;
