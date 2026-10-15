"""Real runtime credentials, not administrator credentials, exercise the stores."""
import os
import unittest
import uuid


class GrantPlanTests(unittest.TestCase):
    def test_distinct_bounded_identifiers_are_required(self):
        from islam_research.sql_permissions import grant_plan
        for roles in [("same", "same"), ("", "publisher"), ("é" * 32, "publisher"), ("a\x00b", "publisher")]:
            with self.assertRaises(ValueError):
                grant_plan(*roles)
        rendered = "\n".join(s.as_string() for s in grant_plan('owner"; DROP SCHEMA research; --', "publisher@test.iam"))
        self.assertIn('TO "owner""; DROP SCHEMA research; --"', rendered)
        self.assertNotIn("GRANT ALL", rendered)


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires isolated PostgreSQL")
class RuntimePermissionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        cls.db, cls.sql = db, sql
        cls.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner, cls.publisher = "owner_" + uuid.uuid4().hex, "publisher_" + uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner, cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit()
            configure(connection, cls.owner, cls.publisher, apply=True)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner, cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def connect(self, role):
        from psycopg.conninfo import make_conninfo
        # CI's ephemeral trust login only; no SET ROLE administrator session.
        return self.db.connect(make_conninfo(self.dsn, user=role))

    def test_real_owner_saves_records_reading_and_passages_with_immutable_history(self):
        from islam_research import passage_store
        project, source = "test:" + uuid.uuid4().hex, "test:" + uuid.uuid4().hex
        with self.connect(self.owner) as connection:
            self.db.create_project(connection, project, "Restricted role project")
            record = self.db.save_record(connection, project_id=project, record_id=source, kind="source", title="Source", actor="test-owner")
            self.assertEqual(record["review_state"], "pending")
            self.db.save_record(connection, project_id=project, record_id=source, kind="source", title="Updated", actor="test-owner", expected_revision=1)
            self.db.save_personal_state(connection, project_id=project, record_id=source, actor="test-owner", reading="read", note="Synthetic private note")
            self.db.save_personal_state(connection, project_id=project, record_id=source, actor="test-owner", expected_revision=1, reading="reading", note="Updated note")
            document = passage_store.create_document(connection, project_id=project, source_record_id=source, edition="Synthetic", locator="Abstract", representation_url="", text="tafsīr and evidence", actor="test-owner")
            annotation = passage_store.create_annotation(connection, annotation_uuid=str(uuid.uuid4()), project_id=project, document_id=document["id"], text_sha256=document["text_sha256"], start=0, end=6, exact="tafsīr", capture_kind="term_candidate", body="Define this", actor="test-owner")
            passage_store.update_annotation(connection, annotation_id=annotation["id"], project_id=project, body="Updated question", expected_revision=1, actor="test-owner")
            for table, key, identifier in [("record_revisions", "record_id", source), ("personal_state_revisions", "record_id", source), ("reading_annotation_revisions", "annotation_id", annotation["id"])]:
                count = connection.execute(self.sql.SQL("SELECT count(*) AS n FROM research.{} WHERE {}=%s").format(self.sql.Identifier(table), self.sql.Identifier(key)), (identifier,)).fetchone()["n"]
                self.assertEqual(count, 2)

    def test_owner_cannot_publish_promote_review_rewrite_history_or_create_tables(self):
        from psycopg.errors import InsufficientPrivilege
        statements = [
            "UPDATE research.records SET review_state='reviewed'",
            "UPDATE research.projects SET graph_authority='hosted'",
            "UPDATE research.records SET origin='canonical_rdf'",
            "DELETE FROM research.records",
            "TRUNCATE research.personal_states",
            "UPDATE research.personal_state_revisions SET snapshot='{}'",
            "CREATE TABLE research.unauthorized(id text)",
            "CREATE TABLE public.unauthorized(id text)",
            "INSERT INTO research_public.snapshots(id,project_id,payload) VALUES('bad','bad','{}')",
            "INSERT INTO research.records(id,project_id,kind,title,changed_by,review_state) VALUES('bad','bad','source','Bad','test','reviewed')",
            "UPDATE research.reading_documents SET review_scope='verified'",
        ]
        with self.connect(self.owner) as connection:
            for statement in statements:
                with self.subTest(statement=statement), self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(statement)

    def test_publisher_reads_snapshots_only_and_passes_existing_fail_closed_adapter(self):
        from islam_research.api_store import PostgreSQLStore
        from psycopg.conninfo import make_conninfo
        from psycopg.errors import InsufficientPrivilege
        identifier = "test:" + uuid.uuid4().hex
        with self.db.connect(self.dsn) as connection:
            connection.execute("INSERT INTO research_public.snapshots(id,project_id,payload) VALUES(%s,'synthetic','{\"approved\": true}')", (identifier,))
        self.assertTrue(PostgreSQLStore(make_conninfo(self.dsn, user=self.publisher)).ready("public"))
        self.assertFalse(PostgreSQLStore(make_conninfo(self.dsn, user=self.owner)).ready("public"))
        with self.connect(self.publisher) as connection:
            self.assertEqual(connection.execute("SELECT payload FROM research_public.snapshots WHERE id=%s", (identifier,)).fetchone()["payload"], {"approved": True})
            for statement in ["SELECT note FROM research.personal_states", "SELECT text_body FROM research.reading_documents", "SELECT * FROM research.records", "DELETE FROM research_public.snapshots", "UPDATE research_public.snapshots SET payload='{}'", "CREATE TABLE research_public.unauthorized(id text)"]:
                with self.subTest(statement=statement), self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(statement)

    def test_preview_is_read_only_idempotent_apply_and_excess_grants_fail_closed(self):
        from islam_research.sql_permissions import audit, configure
        from psycopg.errors import InsufficientPrivilege
        with self.db.connect(self.dsn) as connection:
            before = connection.execute("SELECT relacl FROM pg_class WHERE oid='research.records'::regclass").fetchone()
            configure(connection, self.owner, self.publisher)
            self.assertEqual(before, connection.execute("SELECT relacl FROM pg_class WHERE oid='research.records'::regclass").fetchone())
            configure(connection, self.owner, self.publisher, apply=True)
            self.assertEqual(audit(connection, self.owner, publisher=False), [])
            self.assertEqual(audit(connection, self.publisher, publisher=True), [])
            # Grant inside a savepoint; failed bootstrap may not silently remove it.
            with connection.transaction(force_rollback=True):
                connection.execute(self.sql.SQL("GRANT UPDATE(review_state) ON research.records TO {}").format(self.sql.Identifier(self.owner)))
                with self.assertRaisesRegex(ValueError, "review_state"):
                    configure(connection, self.owner, self.publisher, apply=True)
            with connection.transaction(force_rollback=True):
                connection.execute(self.sql.SQL("GRANT {} TO {}").format(self.sql.Identifier(self.owner), self.sql.Identifier(self.publisher)))
                with self.assertRaisesRegex(ValueError, "memberships"):
                    configure(connection, self.owner, self.publisher, apply=True)
