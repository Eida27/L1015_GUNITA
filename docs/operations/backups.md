# Encrypted backup and quarantined restore

Use Node24.19 and PostgreSQL17 client tools matching the database. `BACKUP_PG_CONTAINER=gunita-db-1` uses the existing local container's tools; omit it for installed `pg_dump`/`pg_restore`. Passwords are passed in the child environment, never command arguments or logs. Supply operator configuration through a private shell/secret manager, never committed files. Runtime database credentials cannot create or restore databases.

## Create

1. Set `BACKUP_KEY_FILE` to an absolute private file outside the checkout and archive destination. Run `pnpm backup:keygen` once. It refuses overwrite, establishes a private ACL before writing a random32byte key, and permits only the current Windows user/SYSTEM/Administrators (POSIX mode0600). Protect a separate recovery copy of this key. Losing it makes the backups unrecoverable.
2. Set `BACKUP_DATABASE_URL` to the source operator connection, `BACKUP_DESTINATION` to an absolute directory outside the checkout, and `BACKUP_DESTINATION_KIND` explicitly to `local-simulation` or `offsite-mounted`. The latter must be an already authorized, separately hosted mounted destination. The program cannot prove a mount is offsite; verify that operationally. Provider acquisition and real credentials remain deployment-blocked.
3. Run `pnpm backup:create`. It produces a custom-format `pg_dump`, AES256GCM encryption with a fresh96bit nonce and full128bit tag, then a private `gunita-<timestamp>-<random>.gunitabackup` archive. It logs only completion/size/retention/destination kind. No plaintext archive is written to disk.
4. The Phase9 [production package](deployment.md) supplies a separate daily backup service with completion/failure/freshness monitoring and5minute failure retry. Default rolling retention is7days; `BACKUP_RETENTION_DAYS` accepts7–365 only for an explicitly documented retention exception. Rotation happens only after a successful new backup and touches only this tool's regular archive filenames. A real offsite destination and external alerts remain launch requirements; the local rehearsal uses a separate owned volume explicitly marked as simulation.

The bounded implementation accepts at most128MiB of plaintext dump; each database tool invocation has a120second deadline. Larger deployments need a separately reviewed bounded staging solution. Do not remove these limits to silence an error. Only one backup/restore worker should run at a time on the documented low-memory test host.

CLI paths are resolved through existing parent directories before use, including Windows case aliases and junctions. The checkout root itself and every descendant are rejected. The key must also be outside the resolved archive directory: a filename such as `..backup.key` is still inside that directory. Missing final directories are checked through their nearest existing ancestor; inaccessible paths and broken links fail closed. Keep these operator-controlled directories protected from concurrent path replacement.

## Restore stays closed to application traffic

Set `BACKUP_ARCHIVE`, the separate `BACKUP_KEY_FILE`, `RESTORE_OPERATOR_DATABASE_URL` to an isolated PostgreSQL operator connection with database creation rights, and `RESTORE_RUNTIME_ROLE` to the known application role. Then run `pnpm backup:restore`.

The entire archive is authenticated before any import process receives plaintext or any destination database is created. Wrong key, truncated archive and tampering fail closed. Intermediate unauthenticated bytes and key/plaintext buffers are cleared when their operation ends. Diagnostic output from PostgreSQL is suppressed because it can contain data.

The restore creates a new random `gunita_restore_*` database with connections disabled. It revokes `CONNECT` from PUBLIC and the named runtime role, verifies effective privileges (including inherited grants), then permits operator connections. A superuser runtime cannot be quarantined and is rejected. It restores without source ownership/ACLs, runs migrations and retention maintenance, checks expired thoughts are gone, and clears restored sessions and verification/reset tokens. Failure removes only that newly created random database. Success reports its name, cleanup totals and `reconciliationRequired:true`; the runtime remains denied. There is no automatic release command.

Before any future traffic release, the operator must reconcile account/thought deletions and moderation changes made after the snapshot against an authoritative current source, verify the resulting privacy invariants, review role grants and rerun expiry cleanup immediately before release. If authoritative post-snapshot state cannot be established, keep the restored database quarantined. Do not point the application at it or grant runtime access. This procedure does not invent a deletion ledger or claim the snapshot knows later deletions.

## Local proof

`pnpm backup:verify` creates guarded random test databases and an OS-temp archive destination explicitly labeled local simulation. It checks real dump/encryption/restore, wrong key/tamper rejection before database creation, private key non-overwrite,7day rotation, inherited/superuser quarantine refusal, actual runtime connection denial, migrations and expiry cleanup. Deleted-before-snapshot content is absent. The test deliberately deletes another thought after the snapshot and verifies that the quarantined restore retains it, proving why reconciliation is required. Test keys, archives, source/restore databases and roles are removed afterward. It never operates on the main database or retained Browser fixtures.

Archive authentication follows [Node24.19 crypto documentation](https://nodejs.org/download/release/v24.19.0/docs/api/crypto.html#decipherupdatedata-inputencoding-outputencoding): output from `update()` is not trusted until `final()` succeeds.
