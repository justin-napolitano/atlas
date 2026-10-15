import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from islam_research.note_format import parse_note, render_note
from islam_research.note_sync import NoRedirect, OwnerHTTP, SyncProblem, transfer


class SyntheticAPI:
    def __init__(self):
        self.record = {"id":"urn:test:source","project_id":"test-project","kind":"source","title":"Synthetic source","attributes":{}}
        self.state = {"record_id":self.record["id"],"project_id":"test-project","reading":"unread","decision":"unreviewed","note":"Cloud note","revision":1}
        self.writes = []
        self.race = False
        self.lose_response = False
    def request(self,path,params=None,value=None):
        if path == "record":
            if params["record_id"] != self.record["id"]:
                raise SyncProblem(404)
            return copy.deepcopy(self.record)
        if path == "personal-state":
            return copy.deepcopy(self.state)
        if path == "personal-states":
            self.writes.append(value)
            if self.race:
                self.state.update(note="A third concurrent version",revision=self.state["revision"]+1); self.race=False
            if value["expected_revision"] != self.state["revision"]:
                raise SyncProblem(409,copy.deepcopy(self.state))
            self.state = {k:v for k,v in value.items() if k != "expected_revision"}
            self.state["revision"] = value["expected_revision"]+1
            if self.lose_response:
                self.lose_response=False
                raise SyncProblem(503)
            return copy.deepcopy(self.state)
        raise AssertionError("Unexpected API operation")


class NoteSyncTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file=Path(self.directory.name).resolve()/"A source.md"
        self.api=SyntheticAPI()
    def pull(self,**extra):
        return transfer(self.api,self.file,"pull",record_id=self.api.record["id"],project_id="test-project",**extra)
    def edit(self,text):
        original=self.file.read_text(encoding="utf-8")
        self.file.write_text(original.replace("\n\nCloud note","\n\n"+text),encoding="utf-8")

    def test_app_to_vault_push_and_idempotent_repeated_transfers(self):
        self.assertFalse(self.pull()["applied"]); self.assertFalse(self.file.exists())
        self.assertTrue(self.pull(apply=True)["applied"])
        self.edit("An offline reading note")
        self.assertTrue(parse_note(self.file.read_text())["locally_changed"])
        preview=transfer(self.api,self.file,"push")
        self.assertEqual(preview["status"],"push_ready"); self.assertEqual(self.api.writes,[])
        saved=transfer(self.api,self.file,"push",apply=True)
        self.assertTrue(saved["applied"]); self.assertEqual(self.api.state["note"],"An offline reading note")
        self.assertFalse(parse_note(self.file.read_text())["locally_changed"])
        self.assertEqual(transfer(self.api,self.file,"push",apply=True)["status"],"unchanged")
        self.assertEqual(len(self.api.writes),1)
        self.assertTrue((self.file.parent/saved["previous_copy"]).exists())

    def test_clean_pull_updates_cloud_edits_but_renames_do_not_change_identity(self):
        self.pull(apply=True)
        renamed=self.file.with_name("Renamed in Obsidian.md"); self.file.rename(renamed); self.file=renamed
        self.api.state.update(note="Changed in the web app",reading="read",revision=2)
        result=self.pull(apply=True)
        self.assertEqual(result["status"],"pull_ready")
        parsed=parse_note(self.file.read_text())
        self.assertEqual(parsed["state"]["note"],"Changed in the web app")
        self.assertEqual(parsed["state"]["reading"],"read")
        self.assertEqual(parsed["metadata"]["research_id"],"urn:test:source")

    def test_pull_never_discards_unsaved_offline_changes(self):
        self.pull(apply=True); self.edit("Local offline draft")
        result=self.pull(apply=True)
        self.assertEqual(result["status"],"local_changes_pending")
        self.assertIn("Local offline draft",self.file.read_text())
        self.assertEqual(self.api.state["note"],"Cloud note")

    def test_conflict_preserves_both_versions_and_resolution_checks_exact_revision(self):
        self.pull(apply=True); self.edit("Local offline draft")
        self.api.state.update(note="Different cloud edit",revision=2)
        result=transfer(self.api,self.file,"push",apply=True)
        self.assertEqual(result["status"],"conflict")
        self.assertIn("Local offline draft",self.file.read_text())
        self.assertIn("Different cloud edit",(self.file.parent/result["cloud_copy"]).read_text())
        self.assertEqual(self.api.writes,[])
        with self.assertRaises(ValueError):
            transfer(self.api,self.file,"push",apply=True,resolution="draft",expected_remote_revision=1)
        transfer(self.api,self.file,"push",apply=True,resolution="draft",expected_remote_revision=2)
        self.assertEqual(self.api.state["note"],"Local offline draft")
        self.assertEqual(self.api.state["revision"],3)

    def test_explicit_cloud_resolution_retains_old_draft_without_a_cloud_write(self):
        self.pull(apply=True); self.edit("Local offline draft")
        self.api.state.update(note="Cloud to keep",revision=2)
        result=transfer(self.api,self.file,"pull",apply=True,resolution="cloud",expected_remote_revision=2)
        self.assertEqual(parse_note(self.file.read_text())["state"]["note"],"Cloud to keep")
        self.assertIn("Local offline draft",(self.file.parent/result["previous_copy"]).read_text())
        self.assertEqual(self.api.writes,[])

    def test_server_change_after_preview_returns_conflict_without_overwrite(self):
        self.pull(apply=True); self.edit("My new draft"); self.api.race=True
        result=transfer(self.api,self.file,"push",apply=True)
        self.assertEqual(result["status"],"conflict")
        self.assertEqual(self.api.state["note"],"A third concurrent version")
        self.assertIn("My new draft",self.file.read_text())

    def test_lost_successful_response_recovers_without_duplicate_writes(self):
        self.pull(apply=True); self.edit("My new draft"); self.api.lose_response=True
        with self.assertRaises(SyncProblem):
            transfer(self.api,self.file,"push",apply=True)
        result=transfer(self.api,self.file,"push",apply=True)
        self.assertEqual(result["status"],"base_refreshed")
        self.assertFalse(parse_note(self.file.read_text())["locally_changed"])
        self.assertEqual(len(self.api.writes),1)

    def test_unknown_ids_wrong_project_symlinks_and_record_deletion_are_safe(self):
        self.pull(apply=True); original=self.file.read_text()
        with self.assertRaises(SyncProblem):
            transfer(self.api,self.file.with_name("unknown.md"),"pull",record_id="unknown",project_id="test-project",apply=True)
        with self.assertRaises(ValueError):
            transfer(self.api,self.file,"push",project_id="other-project",apply=True)
        link=self.file.with_name("Symlink.md"); link.symlink_to(self.file)
        with self.assertRaises(ValueError):
            transfer(self.api,link,"push",apply=True)
        self.api.record["deleted_at"]="synthetic tombstone"
        self.assertEqual(self.pull(apply=True)["status"],"record_removed")
        self.assertEqual(self.file.read_text(),original)
        self.assertEqual(self.api.writes,[])


class NoteTransportTests(unittest.TestCase):
    def test_https_origin_and_credentials_are_bounded_and_redirects_are_denied(self):
        for origin in ["http://example.invalid","https://owner@example.invalid","https://example.invalid/path","https://example.invalid/?token=bad"]:
            with self.assertRaises(ValueError):
                OwnerHTTP(origin,"synthetic-token")
        with self.assertRaises(ValueError):
            OwnerHTTP("https://example.invalid","token\nInjected: header")
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,"",{},"https://other.invalid"))

    def test_token_stays_in_authorization_and_conflict_body_is_bounded(self):
        calls=[]
        class Opener:
            def open(self,request,timeout):
                calls.append(request)
                raise HTTPError(request.full_url,409,"Synthetic conflict",{},io.BytesIO(json.dumps({"current":{"revision":2}}).encode()))
        api=OwnerHTTP("https://example.invalid","synthetic-token",opener=Opener())
        with self.assertRaises(SyncProblem) as error:
            api.request("personal-states",value={"record_id":"urn:test:source"})
        self.assertEqual(error.exception.current,{"revision":2})
        self.assertEqual(calls[0].get_header("Authorization"),"Bearer synthetic-token")
        self.assertNotIn("synthetic-token",calls[0].full_url)
        self.assertNotIn(b"synthetic-token",calls[0].data)
        self.assertNotIn("synthetic-token",str(error.exception))
        with self.assertRaises(ValueError):
            api.request("https://other.invalid")
