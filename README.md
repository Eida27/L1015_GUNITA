# Gunita

_A place for feelings left unsaid._

Gunita is being built as a calm, Philippines-first space for adults to leave short thoughts on an approximate map. This repository contains the **Phase 1 database foundation**: typed domain/auth tables, guarded migrations, versioned Philippines land data and expiry maintenance. The app still displays the honest local-foundation page. Authentication flows, the age/content acknowledgment, map, publishing and moderation are subsequent phases; no user accounts or thoughts are seeded.

The approved [design specification](docs/specs/IMPLEMENTATION_DESIGN_SPEC.md) and [implementation plan](docs/plans/IMPLEMENTATION_PLAN.md) define the product. Architecture and exact versions are recorded in [ADRs](docs/adr/README.md).

## Local setup

Install **Node 24.19.0 LTS**, **pnpm 11.25.0**, and Docker Desktop with Linux containers/Compose. Set the Node 24 binary first in `PATH` if multiple Node versions exist. The package engine rejects other major versions. Activate the pinned pnpm using your existing package-manager installation (`npm install --global pnpm@11.25.0` if needed).

From a fresh clone, with Docker Desktop running:

```powershell
pnpm install --frozen-lockfile
pnpm local
```

`pnpm local` generates local settings if absent, starts healthy PostGIS/Mailpit, prepares separate database roles, applies reviewed explicit SQL migrations, verifies/imports the static geographic seed, then starts Next.js. It preserves the database password and existing data/volumes. On first Phase 1 preparation it updates only the runtime database URL in `.env` and creates private ignored `.env.db` operator settings. Open [Gunita](http://127.0.0.1:3000) and [Mailpit](http://127.0.0.1:8028). Stop the app with Ctrl+C; services continue until `pnpm services:down`.

Equivalent separate commands are useful when troubleshooting:

```powershell
pnpm setup
pnpm services:up
pnpm db:prepare
pnpm dev
```

`.env.example` is a reference with placeholders, not shared credentials. Setup generates random secrets. Keep `.env` and `.env.db` private. To change a database port after preparation, edit `DB_PORT` and all database URL ports in both files; edit app `PORT` plus `APP_ORIGIN` together. Do not change an existing role password without rotating the actual role password too. Use `127.0.0.1` consistently; switching between `localhost` and `127.0.0.1` creates different browser origins.

| Service              | Default address         | Persistence                        |
| -------------------- | ----------------------- | ---------------------------------- |
| App                  | `http://127.0.0.1:3000` | Source and `.next` on host         |
| PostgreSQL/PostGIS   | `127.0.0.1:55435`       | Compose `gunita_pgdata` volume     |
| Mailpit SMTP         | `127.0.0.1:1028`        | Development only, captured locally |
| Mailpit web          | `http://127.0.0.1:8028` | Ephemeral messages                 |
| Optional local Caddy | `http://127.0.0.1:8088` | No production TLS configured       |

The `gunita_database` network is internal. The DB also joins a separate DB-only `gunita_host-access` bridge so Docker can publish the loopback port to the host app; development DB egress is therefore permitted. Mailpit and Caddy do not join either DB network. Production must omit this host-access bridge and the published database port. Container and volume names are scoped by Compose project `gunita`; use another project name when intentionally running a second checkout. Check existing resources and port listeners before starting another instance.

Optional local HTTP proxy: `docker compose --profile proxy up -d caddy`. The proxy targets the host app; when testing through it, intentionally use its origin in `APP_ORIGIN`, set `LOCAL_PROXY=true`, and keep `PORT=3000`. This profile is a local convenience, not a deployment configuration.

## Checks

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

`pnpm test` includes real PostGIS integration tests and requires local DB services plus the private local bootstrap settings (`pnpm db:prepare` creates them). Tests create randomly named `gunita_test_<hex>` databases, migrate with a separate non-superuser owner, seed only static geometry, run disposable content fixtures, then drop exactly their test database/roles. They never truncate the main database. The bootstrap user needs CREATEDB/CREATEROLE only for this local test harness; web runtime does not. `pnpm test:integration` runs that suite alone. Use one worker on small hosts.

Playwright requires local services, starts a dev server unless one exists at the configured origin, and checks readiness, the labeled foundation page, keyboard focus and mobile overflow. Browser acceptance in the Codex Browser remains separate evidence. Next production builds use one static worker; a 1536 MB Node heap cap is suitable for this local 8 GB host.

`GET /api/health` reports process liveness. `GET /api/ready` reports database readiness (503 if no DB connection); neither exposes configuration. Readiness uses the least-privilege runtime connection after preparation.

## Database operations and integrity

```powershell
pnpm db:prepare       # Local bootstrap roles + explicit migrations + static seed
pnpm db:migrate       # Reviewed versioned SQL only; repeat is a no-op
pnpm db:seed:geo      # Checksum-bound static data; repeat verifies against drift
pnpm maintenance:expire # One bounded transaction/batch; no scheduler yet
```

The local bootstrap `gunita` account is separate from `gunita_migrator` (application object owner) and `gunita_app` (web runtime). Web launchers load only `.env`; operator commands explicitly load `.env.db`. In production, inject `DATABASE_URL` into web alone, provide `MIGRATION_DATABASE_URL` only to the migration/maintenance process, and keep bootstrap credentials in an operator secret store. Local Compose needs its generated initialization password; local files are not a production secrets architecture.

SQL files in `src/server/db/migrations` and `schema_migrations` record version and SHA-256. A transaction advisory lock serializes migrations. File/history mismatches and live catalog drift fail closed. There is no destructive auto-sync, database reset, or ledger-forcing option. Drizzle schema lives in `src/server/db/schema.ts`; `drizzle.config.ts` writes optional proposals under ignored `.local/drizzle-proposals` for human review, never directly to production.

Before applying a new migration to valuable data, take and verify a recoverable backup. The initial schema has **no automatic destructive down command**. Failed pending migrations roll back as one transaction; a committed schema/data change requires a reviewed forward fix or restoration into a separate private database/volume. Never edit a previously applied migration or its ledger checksum to silence drift. Review [ADR 011](docs/adr/011-database-integrity.md) for ownership, auth generation and producer contracts.

Thought SQL triggers protect immutable public ID, author, creation/expiry and coarse location. Expiry is a fixed 720-hour UTC duration. Publication records its quota event automatically under an account lock; deleting a thought does not restore quota. Later services must not double-insert quota events. Typed schema does not replace these SQL triggers or later session/verification/authorization guards.

`findPublishedThought(client,publicId)` in `src/server/db/published.mjs` returns a minimal allowlisted object. The shared predicate requires published status and `expires_at > statement_timestamp()`, so expired/hidden/deleted records are unavailable before maintenance. It contains no account IDs, role/status, email, or interaction totals. Later map/bookmark/count queries must reuse the same condition.

`cleanupExpired(client,{batchSize:500})` owns an atomic transaction and returns per-table deletion counts. It removes expired thoughts (cascading reactions/bookmarks/reports), expired verification/session/rate records, quota events older than 25 hours and audits older than 90 days. Each table is bounded to the batch size with `SKIP LOCKED`; repeat until counts are zero to drain a backlog. Hourly scheduling, whole-job locking, draining and operational alerts are Phase 5 work. No private expired-content archive exists.

Boundary attribution, checksum, source-age limitations, island/coastline/disputed coverage policy and conservative privacy tiers are documented in [assets/geo](assets/geo/README.md). Version 1 stores 87 valid SRID4326 polygons. Original picked coordinates have no persistence columns; H3 coarsening is Phase 4 work. Seed commands never create sample users or public thoughts.

## Image upgrades, backup and restore

PostgreSQL 17.11/PostGIS 3.6.4 is pinned by immutable image digest. [ADR 012](docs/adr/012-postgis-baseline-refresh.md) records the scoped backup, verified restore and 3.5.2 → 3.6.4 upgrade. Future image changes must preserve the volume, review extension/glibc/ICU compatibility, rebuild affected indexes before refreshing collation metadata, and pass isolated restore/integration checks. Do not downgrade the mutated volume.

Backups contain private content, tokens and role password hashes. Encrypt with authenticated encryption, retain keys separately, and never commit or print plaintext dumps. Ignored `.local/` is a local operator artifact area, not an offsite backup. Automated seven-day encrypted offsite backup and `backup:verify` remain later-phase work.

Restore into an isolated database/volume with no public app traffic; use compatible binaries, apply reviewed migrations and run cleanup repeatedly until expired-content/token/rate/quota/audit batches are empty **before** allowing reads. Review pending account-deletion/retention obligations as well. Backups can retain old encrypted copies until retention ends; never promise immediate backup erasure or restore directly over a running production database.

## Production-binary smoke test

```powershell
pnpm build
$env:LOCAL_PREVIEW='true'
pnpm start
```

The preview runs the standalone build on loopback using local generated settings; clear `LOCAL_PREVIEW` afterward. `pnpm start` validates configuration **before** importing `.next/standalone/server.js`. Without local preview it requires an HTTPS origin, a database URL, non-placeholder auth secret, production Turnstile keys, SMTP sender/host and HTTPS map style. Errors list field names only. Building does not require paid provider credentials.

No production deployment or readiness is claimed. Later phases must provide verified SMTP delivery, authorized map tiles, boundary provenance, auth/permissions, expiry, moderation, reviewed legal/help content, encrypted offsite backups with restore proof, TLS and monitoring before launch. A multi-stage web Docker image and production Compose are planned in the deployment phase.

## Teardown

```powershell
pnpm services:down
```

This removes only this Compose project's containers/networks and **retains** `gunita_pgdata`. The explicit destructive reset `docker compose down --volumes` deletes the local database; use only when you intend that deletion. No cleanup script prunes unrelated Docker resources. No remote is configured and GitHub CI is deferred; local checks require no secrets beyond generated local settings.
