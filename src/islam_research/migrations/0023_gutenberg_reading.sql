-- Public text snapshots are separate from project membership/private notes.
CREATE TABLE research.gutenberg_books (
 book_id integer NOT NULL CHECK(book_id BETWEEN 1 AND 999999),
 version text NOT NULL CHECK(version ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<16000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(book_id,version)
);
CREATE TABLE research.gutenberg_places (
 project_id text NOT NULL REFERENCES research.projects(id),
 book_id integer NOT NULL,
 version text NOT NULL,
 section integer NOT NULL CHECK(section BETWEEN 0 AND 1000),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 12000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,book_id),
 FOREIGN KEY(book_id,version) REFERENCES research.gutenberg_books(book_id,version)
);
REVOKE ALL ON research.gutenberg_books,research.gutenberg_places FROM PUBLIC;
