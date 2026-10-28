# Database, migrations and geographic seed

Local setup creates private `.env` runtime settings and `.env.db` bootstrap/migration settings. Web uses `gunita_app`; reviewed SQL/maintenance use non-superuser `gunita_migrator`; only operator/test setup needs bootstrap CREATEDB/CREATEROLE. Production splits service secrets in the [deployment guide](deployment.md).

```powershell
pnpm db:prepare
pnpm db:migrate
pnpm db:seed:geo
pnpm maintenance:expire
```

`db:prepare` provisions local roles, applies reviewed SQL/grants and verifies/imports geometry. `db:migrate` applies pending SQL and runtime grants; `db:seed:geo` verifies existing geometry instead of overwriting drift. Repetition returns zero migrations/areas imported. These commands never reset the DB, add fictional public content or rotate an existing password.

| SQL migration                    | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `0001_auth.sql`                  | Generated pinned Better Auth tables, UTC timestamps                         |
| `0002_domain.sql`                | Domain/spatial schema, immutability, quota, cascades and audit unlinking    |
| `0003_auth_integrity.sql`        | Email/token integrity and indexes                                           |
| `0004_schema_inventory.sql`      | Supplemental relation/view/RLS guard                                        |
| `0005_publication_isolation.sql` | Reject publication outside READ COMMITTED                                   |
| `0006_account_identity.sql`      | Atomic server-owned profile/pseudonym                                       |
| `0007_reporter_category.sql`     | Immutable original category, linked-member backfill, ambiguous-NULL refusal |

SQL in `src/server/db/migrations` is authoritative; types live in `schema.ts`/`auth-schema.ts`. `schema_migrations` records version, SHA-256 and guarded catalog state. Advisory locking serializes runners; all pending migrations share one transaction. Changed files/history/catalog drift or absent inventory fail closed. Never edit applied SQL/checksums, force the ledger or execute generated proposals without review. Drizzle proposals stay ignored under `.local/drizzle-proposals`.

Before valuable-data updates, create and verify a recoverable encrypted backup. Stop/drain the production scheduled backup before its one-off backup and resume even after failure; quiesce web/maintenance/metrics during migration as [documented](deployment.md). Failed pending migrations roll back. There is no automatic destructive down migration: use a reviewed forward fix or compatible prior app image. Schema-incompatible rollback requires an isolated [quarantined restore/reconciliation](backups.md).

Geography dataset 1 has 87 valid SRID 4326 land polygons, versioned labels/tiers, checksum-bound metadata and SHA-256 `fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189`. See [source/license/island limitations](../../assets/geo/README.md). Basemap data never authorizes posting. Seed replay checks exact data and refuses drift. Migration 0007 refuses ambiguous legacy NULL reporters: reconcile reliable evidence rather than guessing guest/deleting rows to bypass the guard.

Publication is READ COMMITTED only, with trigger-owned quota events; deletion cannot recover a slot. Lifetime is 720 UTC hours. `publishedPredicate` checks strict statement time independently of cleanup. `maintenance:expire` takes the whole-job advisory lock and drains bounded SKIP LOCKED batches to zero; competing jobs skip. `maintenance:run` drains immediately and hourly in a separate terminal/service. Hourly deletion requires a healthy worker. See [retention](retention.md).
