# Project directories

The owner workspace lists projects directly in the sidebar. Select a project to open its reading workspace; Sources, Questions, and Notes operate within that project's existing ID. Use **New project**, enter a name, and choose **Create project**. The existing authenticated `POST /v1/projects` API stores the project in PostgreSQL. Creating a project does not publish it.

Creation keeps a generated stable project ID for the entire attempt. After an uncertain response, retry checks the owner project list for that exact ID and title before posting again. Fields remain frozen until the attempt succeeds or is explicitly cancelled. The project list survives reload through the owner API, rather than browser storage. The existing endpoint currently returns up to 100 projects; this interface does not add pagination, nested folders, renaming, deletion, or filesystem directories.

The ignored local review adapter stores project creation on this Mac only. It supports project-scoped source intake and independent notes, but remains a limited review adapter; hosted PostgreSQL and owner sign-in are separate deployment work.
