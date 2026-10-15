"""Real restricted-login exports and concurrent publication changes in CI."""
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class PublicReleaseStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db, publication as pub
        from islam_research import public_release as release, public_release_store as store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db, cls.pub, cls.release, cls.store, cls.sql = db, pub, release, store, sql
        cls.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner, cls.publisher = "export_owner_" + uuid.uuid4().hex, "export_reader_" + uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner, cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit()
            configure(connection, cls.owner, cls.publisher, apply=True)
        cls.owner_dsn = make_conninfo(cls.dsn, user=cls.owner)
        cls.publisher_dsn = make_conninfo(cls.dsn, user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner, cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project, self.source = "export:" + uuid.uuid4().hex, "source:" + uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection, self.project, "Synthetic public export")
            self.db.save_record(connection, record_id=self.source, project_id=self.project, kind="source",
                                title="Synthetic source", summary="PRIVATE_UNSELECTED_SUMMARY",
                                attributes={"note": "PRIVATE_ATTRIBUTE"}, actor="synthetic-owner")
            self.db.save_personal_state(connection, record_id=self.source, project_id=self.project,
                                        actor="synthetic-owner", note="PRIVATE_PERSONAL_NOTE")
            preview = self.pub.preview(connection, project_id=self.project, selections=[{"record_id": self.source}],
                                       relation_ids=[], actor="synthetic-owner")
            self.pub.approve(connection, preview_id=preview["id"], expected_sha256=preview["payload_sha256"],
                             expected_revision=0, rationale="Synthetic rights review", actor="synthetic-owner", rights_checked=True)

    def export(self, root):
        return self.store.export_approved(self.publisher_dsn, root, ROOT / "semantic")

    def withdraw(self):
        with self.db.connect(self.owner_dsn) as connection:
            return self.pub.withdraw(connection, project_id=self.project, expected_revision=1,
                                     rationale="Synthetic correction", actor="synthetic-owner")

    def wait_for_lock(self, *, shared):
        # Inspect real server wait state, not just whether a Python thread is alive.
        deadline = time.monotonic() + 3
        with self.db.connect(self.dsn) as connection:
            while time.monotonic() < deadline:
                found = connection.execute("""SELECT 1 FROM pg_locks WHERE locktype='advisory'
                    AND classid=184512 AND objid=1 AND objsubid=2 AND NOT granted
                    AND mode=%s""", ("ShareLock" if shared else "ExclusiveLock",)).fetchone()
                if found:
                    return
                time.sleep(0.02)
        self.fail("Expected publication/export advisory lock waiter was not observed")

    def test_real_publisher_exports_only_active_approved_rows_and_never_private_state(self):
        from psycopg.errors import InsufficientPrivilege
        with tempfile.TemporaryDirectory() as root:
            directory, identifier = self.export(root)
            manifest = self.release.verify_bundle(directory, expected_id=identifier)
            self.assertTrue(any(h["project_id"] == self.project for h in manifest["heads"]))
            data = b"".join(path.read_bytes() for path in directory.rglob("*") if path.is_file())
            self.assertNotIn(b"PRIVATE_", data)
            self.assertNotIn(b"synthetic-owner", data)
            with self.db.connect(self.publisher_dsn) as connection:
                for query in ("SELECT * FROM research.personal_states", "UPDATE research_public.publication_heads SET revision=revision+1"):
                    with self.assertRaises(InsufficientPrivilege), connection.transaction():
                        connection.execute(query)
            self.withdraw()
            directory, _ = self.export(root)
            manifest = self.release.verify_bundle(directory)
            head = next(h for h in manifest["heads"] if h["project_id"] == self.project)
            self.assertEqual(head["status"], "withdrawn")
            filename = "graph-" + self.release.digest(self.project.encode()) + ".json"
            self.assertFalse((directory / "data" / filename).exists())

    def test_export_rejects_privileged_login_owner_login_and_disabled_guard(self):
        with tempfile.TemporaryDirectory() as root:
            for dsn in (self.dsn, self.owner_dsn):
                with self.assertRaises(ValueError):
                    self.store.export_approved(dsn, root, ROOT / "semantic")
            with self.db.connect(self.dsn) as connection:
                connection.execute("ALTER TABLE research_public.publication_heads DISABLE TRIGGER public_head_export_guard")
            try:
                with self.assertRaises(ValueError):
                    self.export(root)
            finally:
                with self.db.connect(self.dsn) as connection:
                    connection.execute("ALTER TABLE research_public.publication_heads ENABLE TRIGGER public_head_export_guard")

    def test_withdrawal_waits_until_local_activation_then_next_export_excludes_it(self):
        captured, proceed = threading.Event(), threading.Event()
        real_write = self.store.write_bundle
        def slow_write(*args):
            captured.set()
            if not proceed.wait(5):
                raise RuntimeError("Synthetic capture gate timeout")
            return real_write(*args)
        with tempfile.TemporaryDirectory() as root, ThreadPoolExecutor(max_workers=2) as pool:
            with patch.object(self.store, "write_bundle", side_effect=slow_write):
                export = pool.submit(self.export, root)
                try:
                    self.assertTrue(captured.wait(8))
                    withdrawal = pool.submit(self.withdraw)
                    self.wait_for_lock(shared=False)
                finally:
                    proceed.set()
                export.result(timeout=8)
                self.assertEqual(withdrawal.result(timeout=8)["revision"], 2)
            directory, _ = self.export(root)
            head = next(h for h in self.release.verify_bundle(directory)["heads"] if h["project_id"] == self.project)
            self.assertEqual(head["status"], "withdrawn")

    def test_waiting_export_reads_withdrawal_committed_after_lock_statement_started(self):
        with tempfile.TemporaryDirectory() as root, ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.connect(self.owner_dsn) as connection:
                connection.execute("SELECT pg_advisory_xact_lock(184512,1)")
                self.pub.withdraw(connection, project_id=self.project, expected_revision=1,
                                  rationale="Synthetic concurrent correction", actor="synthetic-owner")
                future = pool.submit(self.export, root)
                try:
                    self.wait_for_lock(shared=True)
                finally:
                    connection.commit()
            directory, _ = future.result(timeout=10)
            manifest = self.release.verify_bundle(directory)
            self.assertEqual(next(h for h in manifest["heads"] if h["project_id"] == self.project)["status"], "withdrawn")

    def test_lost_acknowledgement_after_filesystem_activation_is_reported_uncertain(self):
        real_write = self.store.write_bundle
        def lost_ack(*args):
            real_write(*args)
            raise OSError("SYNTHETIC_LOST_ACK")
        with tempfile.TemporaryDirectory() as root, patch.object(self.store, "write_bundle", side_effect=lost_ack):
            with self.assertRaises(self.release.ActivationUncertain):
                self.export(root)
            self.assertTrue(self.release.current_bundle(root)[1]["release_id"].startswith("release-"))
