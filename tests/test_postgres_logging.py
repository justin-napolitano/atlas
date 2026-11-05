import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

try:
    import psycopg
except ModuleNotFoundError:
    psycopg=None


@unittest.skipUnless(psycopg,"Install database extra for logging-probe checks")
class PostgresLoggingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location("logging_probe",Path(__file__).resolve().parents[1]/"scripts/check_postgres_logging.py")
        cls.probe=importlib.util.module_from_spec(spec); spec.loader.exec_module(cls.probe)

    def test_configure_refuses_nonisolated_or_remote_databases_before_connecting(self):
        for dsn,permit in [("postgresql://postgres@localhost/research_test",""),
                           ("postgresql://postgres@example.invalid/research_test","isolated-ci-only"),
                           ("postgresql://postgres@localhost/production","isolated-ci-only")]:
            with patch.dict(os.environ,{"RESEARCH_TEST_DATABASE_URL":dsn,"RESEARCH_LOGGING_PROBE_ALLOW_CONFIGURE":permit}),patch.object(self.probe.psycopg,"connect") as connect:
                with self.assertRaises(ValueError): self.probe.connection()
                connect.assert_not_called()

    def test_empty_incomplete_or_leaking_logs_cannot_pass_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/"marker.txt").write_text("SYNTHETIC-NOTE-MARKER")
            logs=root/"postgres.log"
            with patch.object(self.probe,"WORK",root):
                for text in ["",self.probe.SENTINEL,"violates check constraint statement timeout",
                             self.probe.SENTINEL+" violates check constraint statement timeout SYNTHETIC-NOTE-MARKER"]:
                    logs.write_text(text)
                    with self.assertRaises(ValueError): self.probe.verify(logs)
                logs.write_text(self.probe.SENTINEL+" violates check constraint statement timeout")
                self.probe.verify(logs)

    def test_large_logs_and_chunk_boundary_markers_are_fully_scanned(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);marker="SYNTHETIC-NOTE-MARKER"
            (root/"marker.txt").write_text(marker);logs=root/"postgres.log"
            with logs.open("w") as stream:
                stream.write("x"*65536*800)
                stream.write(self.probe.SENTINEL+" violates check constraint statement timeout")
            with patch.object(self.probe,"WORK",root):
                self.probe.verify(logs)
                # A leak at the end, straddling two scan chunks, must still fail.
                with logs.open("a") as stream:
                    stream.write("x"*((65536-logs.stat().st_size%65536)-5))
                    stream.write(marker)
                with self.assertRaises(ValueError):self.probe.verify(logs)

    def test_unsafe_policy_changes_are_rejected_before_server_configuration(self):
        baseline=json.loads((self.probe.ROOT/"config/postgres-observability.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/"config").mkdir()
            for flag,value in [("log_parameter_max_length","-1"),("log_parameter_max_length_on_error","64"),
                               ("log_error_verbosity","verbose"),("log_statement","all")]:
                changed=json.loads(json.dumps(baseline)); changed["native"][flag]=value
                (root/"config/postgres-observability.json").write_text(json.dumps(changed))
                with patch.object(self.probe,"ROOT",root),self.assertRaises(ValueError): self.probe.settings()
