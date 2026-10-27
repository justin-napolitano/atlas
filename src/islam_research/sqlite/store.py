"""Local owner-only store using the existing domain operations over SQLite."""
from pathlib import Path
from ..api_store import PostgreSQLStore
from .connection import Connection,migrate


class SQLiteStore(PostgreSQLStore):
    """Reuse domain contracts; select SQLite only in the trusted desktop launcher.

    The hosted/public entrypoints continue to instantiate PostgreSQLStore. A
    private SQLite file must never serve as an anonymous/public projection.
    """
    def __init__(self,path):
        self.path=Path(path).absolute()
        super().__init__('sqlite:'+str(self.path))
    def ready(self,mode):
        if mode!='owner':return False
        with Connection(self.path) as connection:
            migrate(connection)
            return connection.raw.execute('PRAGMA quick_check(1)').fetchone()['quick_check']=='ok' and not connection.raw.execute('PRAGMA foreign_key_check').fetchall()
    def search(self,*args,**kwargs):
        from .search import search
        with Connection(self.path) as connection:return search(connection,*args,**kwargs)
    def publication_preview(self,**values):raise ValueError('Publish research through the hosted owner workspace')
    def publication_approve(self,**values):raise ValueError('Publish research through the hosted owner workspace')
    def publication_withdraw(self,**values):raise ValueError('Publish research through the hosted owner workspace')
