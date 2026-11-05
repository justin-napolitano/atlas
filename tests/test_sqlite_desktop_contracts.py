"""Run desktop behavior contracts independently against an embedded fixture.

The original PostgreSQL classes and their integration jobs remain unchanged.
These subclasses exercise identical application actions on private SQLite files;
they do not stand in for PostgreSQL permissions, trigger or migration tests.
"""
from pathlib import Path
import tempfile
import unittest
import uuid
try:import sqlglot
except ModuleNotFoundError:raise unittest.SkipTest('Install the desktop-sqlite extra for embedded-store tests')

from test_desktop_sources import DesktopSourceTests
from test_desktop_pages import PageTests
from test_desktop_folders import FolderTests
from test_owner_workspace import OwnerWorkspaceTests
from test_workspace_organization import OrganizationTests
from test_workspace_reading import WorkspaceReadingTests
from test_vault_tasks import TaskTests,FakeIssues
from test_vault_connection import ConnectionTests,FakeGitHub
from islam_research.sqlite.connection import Connection,migrate
from islam_research import workspace_store as workspace


class EmbeddedFixture:
    __unittest_skip__=False
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='atlas-sqlite-contract-')
        self.root=Path(self.temporary.name)/'objects'
        self.c=Connection(Path(self.temporary.name)/'workspace.sqlite3',create=True)
        migrate(self.c)
    def tearDown(self):self.c.close();self.temporary.cleanup()
    def separate_connection(self):return Connection(self.c.path)


class SQLiteSources(EmbeddedFixture,DesktopSourceTests):pass
class SQLitePages(EmbeddedFixture,PageTests):pass
class SQLiteFolders(EmbeddedFixture,FolderTests):pass
class SQLiteReading(EmbeddedFixture,WorkspaceReadingTests):pass
class SQLiteWorkspace(EmbeddedFixture,OwnerWorkspaceTests):
    def setUp(self):
        super().setUp()
        self.projects=0
class SQLiteOrganization(EmbeddedFixture,OrganizationTests):
    def setUp(self):
        super().setUp()
        self.a=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='An independent thought.',actor='synthetic')
        self.b=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='What would change my mind?',thought_type='question',actor='synthetic')
class SQLiteTasks(EmbeddedFixture,TaskTests):
    def setUp(self):
        super().setUp();self.c.autocommit=True;self.remote=FakeIssues()
class SQLiteVaultConnection(EmbeddedFixture,ConnectionTests):
    def setUp(self):
        super().setUp();self.remote=FakeGitHub()

# Imported base classes are covered by their PostgreSQL job, not collected here.
del DesktopSourceTests,PageTests,FolderTests,OwnerWorkspaceTests,OrganizationTests,WorkspaceReadingTests
del TaskTests,ConnectionTests
