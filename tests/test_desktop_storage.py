"""Filesystem gates run before any privileged backup restoration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import desktop_storage as storage


class DesktopStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.state=Path(self.temporary.name);self.directory=self.state/'backups'
        self.directory.mkdir(mode=0o700)
        self.archive=self.directory/'synthetic.dump';self.archive.write_bytes(b'synthetic snapshot')
        self.archive.chmod(0o600)
        self.receipt=self.archive.with_suffix('.json')
        self.receipt.write_text(json.dumps({'format':1,'kind':'atlas-local-backup','postgres_major':17,
            'bytes':self.archive.stat().st_size,'sha256':hashlib.sha256(self.archive.read_bytes()).hexdigest(),'counts':{}}))
        self.receipt.chmod(0o600)

    def tearDown(self):self.temporary.cleanup()

    def test_only_own_verified_snapshot_inside_private_backup_directory_is_accepted(self):
        self.assertEqual(storage.verified_backup(self.state,self.archive)[0],self.archive)
        external=self.state/'outside.dump';external.write_bytes(self.archive.read_bytes());external.chmod(0o600)
        with self.assertRaises(ValueError):storage.verified_backup(self.state,external)
        linked=self.directory/'linked.dump';linked.symlink_to(self.archive)
        with self.assertRaises(ValueError):storage.verified_backup(self.state,linked)
        self.archive.chmod(0o644)
        with self.assertRaises(ValueError):storage.verified_backup(self.state,self.archive)

    def test_corrupted_archive_or_receipt_cannot_enter_restore(self):
        self.archive.write_bytes(b'changed snapshot')
        with self.assertRaises(ValueError):storage.restore(self.state,Path('/not-a-binary'),self.archive)
        self.archive.write_bytes(b'synthetic snapshot');self.receipt.chmod(0o644)
        with self.assertRaises(ValueError):storage.verified_backup(self.state,self.archive)

    def test_unknown_cluster_major_is_rejected_without_changing_it(self):
        data=self.state/'postgres-data';data.mkdir(mode=0o700);version=data/'PG_VERSION';version.write_text('99')
        args=argparse.Namespace(state_dir=self.state,postgres_bin=Path('/not-a-binary'))
        with self.assertRaises(ValueError):storage.bootstrap(args)
        self.assertEqual(version.read_text(),'99')
        self.assertFalse((self.state/'local-config.json').exists())

    def test_symlinked_state_directory_is_rejected(self):
        link=self.state/'redirect';link.symlink_to(self.directory,target_is_directory=True)
        args=argparse.Namespace(state_dir=link,postgres_bin=Path('/not-a-binary'))
        with self.assertRaises(ValueError):storage.bootstrap(args)


if __name__=='__main__':unittest.main()
