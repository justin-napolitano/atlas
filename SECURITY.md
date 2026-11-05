# Security

Report a suspected vulnerability privately through GitHub's **Report a
vulnerability** feature when available. Otherwise request a private reporting
channel from the maintainer without posting exploit details, credentials or
personal workspace contents in a public issue.

Atlas stores private writing and imported material outside the source tree.
Local launchers bind to loopback and use a private launch credential and an
HttpOnly session. Keep your operating-system account and backups protected;
SQLite storage is not itself encrypted by Atlas.

GitHub backup/export requires an explicit connection and reviewed selection.
Publishing the application source does not publish a workspace. Hosted API,
identity and infrastructure configuration require separate deployment review.

Use synthetic isolated workspaces for testing. Preserve authentication, origin
checks, revision guards and backup verification when extending the application.
Never commit tokens, private notes, imported files, databases or backup archives.

This source release has extraction checks and automated tests; it has not
received an independent security audit.
