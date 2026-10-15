"""Real PostgreSQL integration tests; never substitute SQLite for these contracts."""
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

DSN = os.environ.get("RESEARCH_TEST_DATABASE_URL")
try:
    from islam_research import database as db
except ModuleNotFoundError:
    if DSN:
        raise
    db = None


@unittest.skipUnless(DSN, "Set RESEARCH_TEST_DATABASE_URL to an isolated PostgreSQL database")
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connection = db.connect(DSN)
        db.migrate(cls.connection)

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def setUp(self):
        self.project = "test:" + str(uuid.uuid4())
        db.create_project(self.connection, self.project, "Synthetic test project")
        self.record_id = "test:" + str(uuid.uuid4())
        self.record = self.save()

    def save(self, **changes):
        values = dict(record_id=self.record_id, project_id=self.project, kind="source",
                      title="Synthetic source", actor="test-owner")
        values.update(changes)
        return db.save_record(self.connection, **values)

    def test_migrations_are_idempotent(self):
        self.assertEqual(db.migrate(self.connection), [])

    def test_revision_history_and_stale_write(self):
        updated = self.save(title="Updated title", expected_revision=1)
        self.assertEqual(updated["revision"], 2)
        with self.assertRaises(db.RevisionConflict) as error:
            self.save(title="Stale title", expected_revision=1)
        self.assertEqual(error.exception.current["title"], "Updated title")
        with self.connection.transaction():
            revisions = self.connection.execute("""SELECT snapshot->>'title' AS title
                FROM research.record_revisions WHERE record_id=%s ORDER BY revision""", (self.record_id,)).fetchall()
        self.assertEqual([r["title"] for r in revisions], ["Synthetic source", "Updated title"])

    def test_duplicate_create_returns_conflict_without_extra_revision(self):
        with self.assertRaises(db.RevisionConflict):
            self.save()
        with self.connection.transaction():
            count = self.connection.execute("SELECT count(*) AS n FROM research.record_revisions WHERE record_id=%s", (self.record_id,)).fetchone()["n"]
        self.assertEqual(count, 1)

    def test_two_sessions_cannot_overwrite_same_revision(self):
        def change(title):
            with db.connect(DSN) as connection:
                try:
                    db.save_record(connection, record_id=self.record_id, project_id=self.project,
                                   kind="source", title=title, actor="test-owner", expected_revision=1)
                    return "saved"
                except db.RevisionConflict:
                    return "conflict"
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(change, ["First edit", "Second edit"]))
        self.assertCountEqual(results, ["saved", "conflict"])

    def test_private_progress_is_durable_and_independent_of_review(self):
        state = db.save_personal_state(self.connection, record_id=self.record_id, project_id=self.project,
                                      actor="test-owner", reading="read", decision="not_relevant", note="Synthetic private note")
        with db.connect(DSN) as second:
            persisted = second.execute("SELECT * FROM research.personal_states WHERE record_id=%s", (self.record_id,)).fetchone()
            self.assertEqual(persisted["note"], "Synthetic private note")
            self.assertIsNotNone(persisted["read_at"])
            self.assertEqual(db.get_record(second, self.record_id)["review_state"], "pending")
        with self.assertRaises(db.RevisionConflict):
            db.save_personal_state(self.connection, record_id=self.record_id, project_id=self.project,
                                   actor="test-owner", expected_revision=0)
        changed = db.save_personal_state(self.connection, record_id=self.record_id, project_id=self.project,
                                        actor="test-owner", expected_revision=state["revision"], reading="reading")
        self.assertIsNone(changed["read_at"])

    def test_same_project_foreign_keys_reject_cross_project_state(self):
        with self.assertRaises(Exception) as error:
            db.save_personal_state(self.connection, record_id=self.record_id, project_id="missing-project",
                                   actor="test-owner")
        self.assertEqual(error.exception.sqlstate, "23503")

    def test_missing_role_has_no_private_or_public_access(self):
        with self.connection.transaction():
            # PUBLIC is the implicit grant inherited by every login role.
            rows = self.connection.execute("""SELECT c.relname, a.privilege_type FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
                CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
                WHERE n.nspname IN ('research','research_public') AND a.grantee=0""").fetchall()
        self.assertEqual(rows, [])

    def test_invalid_read_state_and_revision_are_rejected(self):
        with self.assertRaises(ValueError):
            db.save_personal_state(self.connection, record_id=self.record_id, project_id=self.project,
                                   actor="test-owner", reading="verified")
        with self.assertRaises(ValueError):
            self.save(expected_revision=True)


if __name__ == "__main__":
    unittest.main()
