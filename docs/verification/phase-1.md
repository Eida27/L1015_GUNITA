# Phase 1: database, boundaries and domain integrity

Baseline `7d92063`, branch `implementation/local-first`. Phase 1 application implementation only; Phase 2 authentication flows remain gated for fresh controller review. No push, deployment, public service, fictional production content, real provider credentials, or new worktree was created.

## Delivered files and contracts

- `src/server/db/auth-schema.ts`: actual Better Auth 1.7.11 generated UUID auth schema, with supported UTC date adaptation and additional email/retention indexes. Raw generator output: `docs/verification/auth-schema-1.7.11.ts.txt`. Generation config: `scripts/auth-schema.config.ts`.
- `src/server/db/schema.ts`, `client.ts`, `drizzle.config.ts`: typed full domain and non-logging Drizzle factory; migration proposals stay ignored and require review. SQL migrations are authoritative for triggers, checks and privileges.
- `src/server/db/migrations/0001_auth.sql` through `0004_schema_inventory.sql`: auth, domain, email/token integrity, and an explicit ledger extension for relation inventory. The fourth migration preserves the prior fingerprint/checksum history and adds relation/view/RLS drift coverage; previously applied SQL was not rewritten to change the guard.
- `src/server/db/migrate.mjs`: version/checksum/history and catalog fingerprint guards, transaction advisory lock, all-pending-migrations rollback. `roles.mjs`: distinct non-superuser migration owner and least-privilege runtime grants.
- `seed-geo.mjs`, `assets/geo/phl-adm2.geojson`, `source-metadata.json`, `README.md`: checksum-bound, versioned 87-feature land import, safe broad labels and conservative privacy-tier data. Repeat import verifies every geometry/label/tier and refuses drift.
- `published.mjs`: reusable active-published predicate and minimal public data access. `cleanup.mjs`: atomic, bounded, idempotent live-data/retention cleanup.
- `scripts/database-env.mjs`, `scripts/db.mjs`, `scripts/local.mjs`, package scripts, `.env.example`: local role preparation, migration, seed and cleanup commands with private operator configuration.
- `compose.yaml`: PostgreSQL 17/PostGIS 3.6 digest refresh, preserved volume/network boundaries, explicit SQL/parameter/error/duration log suppression.
- `scripts/prepare-standalone.mjs`: strips copied private environment files and an accidentally traced local operator directory from the portable artifact while retaining root settings, static and public assets.
- `tests/integration/database.test.mjs`: real disposable PostGIS databases, owned non-superuser migration role, runtime permission matrix, migrations/rollback/drift, immutable identity/lifetime, cascades, quota race, strict expiry, land/coastline/islands, cleanup and index-plan proofs.
- Unit tests: configuration split, explicit missing-DATABASE_URL isolation, package canary and preserved startup/HTTP contracts. `.local` is excluded from Git, Docker, formatting, lint and typecheck; scratch ledger remains ignored.
- Updated README/ADR inventory plus [ADR 011](../adr/011-database-integrity.md) and [ADR 012](../adr/012-postgis-baseline-refresh.md) document operations, rollback/restore protections and sequencing decisions.

## Auth generation provenance

Registry/package metadata independently verified exact `better-auth`, separate `@better-auth/drizzle-adapter`, and official `auth` CLI **1.7.11**, Drizzle ORM **0.45.4**, Kit **0.31.11**. Installed `@types/pg` **8.15.6**; exact pins and transitive integrity are in the lockfile. The CLI's package metadata points to `better-auth/better-auth/packages/cli`, not an unrelated auth package.

Executed with bundled Node 24.19.0 first in PATH:

```powershell
node node_modules/auth/dist/index.mjs generate --config scripts/auth-schema.config.ts --output src/server/db/auth-schema.ts --yes
```

CLI exited 0 and generated the four actual tables. Its offline empty-adapter preflight reported missing tables and an unset base URL before generation; these are recorded generation diagnostics, not a live-auth pass. The actual generated fields, FKs and relations were preserved. Supported `withTimezone:true` was applied to every generated date column; Drizzle Kit's installed `generateDrizzleJson/generateMigration` API generated migration 0001 from that schema. Additional case-insensitive email and expiry indexes live in explicit migration 0003. No runtime Better Auth routes or signup/password behavior are claimed yet.

## Producer interfaces for later phases

Auth exports are `user`, `session`, `account`, `verification`, `userRelations`, `sessionRelations`, `accountRelations`. All auth IDs/FKs are PostgreSQL UUID, generated under Better Auth's supported `advanced.database.generateId='uuid'` setting. SQL field names are snake_case; TypeScript fields are generated camelCase. User retains required internal `name`, unique email, `email_verified`, optional image; session retains optional IP/user-agent for compatibility. Phase 2 must supply internal name server-side, disable unnecessary IP/user-agent retention, and create `profiles` atomically in the auth transaction with server-generated unique permanent pseudonym/collision retry. This phase does not auto-create profiles or allow public role promotion.

Domain Drizzle exports: `profiles`, `userConsents`, `geoDatasets`, `privacyTiers`, `geoAdminAreas`, `thoughts`, `postQuotaEvents`, `reactions`, `bookmarks`, `reports`, `adminAudit`, `rateLimitCounters`; enum exports: `profileRole`, `profileStatus`, `emotion`, `thoughtStatus`, `reactionType`, `reportReason`, `reportStatus`, `auditAction`, `auditSubject`. `createDatabase(pool)` returns a Drizzle database with the full schema and SQL logging disabled. Do not serialize ORM models as public responses.

`profiles.user_id` owns one immutable pseudonym; role defaults member, status active. Runtime can insert only user ID/pseudonym/timestamps and update suspension/status timestamps; it cannot insert/update role or rename a pseudonym. Future verified operator bootstrap uses migration/operator credentials. Normal application authorization is still required inside later services/routes.

Thought INSERT triggers derive fixed 720-hour expiry and atomically record a quota event under an account advisory transaction lock. The sixth event in the prior rolling 24 hours raises SQLSTATE `23514` with a safe quota message and rolls back its thought/event. **Phase 5 must not double-insert `post_quota_events`.** The ledger stores author ID/time only, survives thought deletion and cascades on account deletion. Every publication counts, including hidden content. Later posting services must verify membership, status, email and current guideline consent; the trigger alone is not authorization.

`loadLocalEnv()` loads `.env`; `loadDatabaseEnv()` is operator/test-only and loads ignored `.env.db`. `prepareLocalDatabaseEnv(directory)` preserves original bootstrap DB password, writes independent random migration/runtime credentials, and changes only `.env`'s runtime URL. `db:prepare` creates/provisions roles, migrates with `MIGRATION_DATABASE_URL`, grants runtime access, and seeds. Subsequent `db:migrate`, `db:seed:geo`, `maintenance:expire` explicitly load operator settings. Production web must receive runtime secrets only; local Compose's bootstrap initialization password is a development convenience.

`publishedPredicate` is `t.status='published' AND t.expires_at > statement_timestamp()`; alias `t` must be used when composing SQL. Statement time advances between queries inside long transactions. `findPublishedThought(client,publicId)` parameterizes the slug and returns null or flat allowlisted `{publicId,body,emotion,pseudonym,locationLabel,lng,lat,createdAt,expiresAt}`. Coordinates are the stored coarse public point. There are no IDs, emails, role/status or interaction counts in the result. Map/bookmark/count/aggregation services must reuse the predicate and later route DTOs can shape the flat safe fields.

`cleanupExpired(client,{batchSize=500})` requires a maintenance/migration connection, owns BEGIN/COMMIT/ROLLBACK, bounds each table to 1..5000 rows, orders by retention time, and uses row locks with SKIP LOCKED. Return keys are `thoughts`, `post_quota_events`, `rate_limit_counters`, `verification`, `session`, `admin_audit`. Delete predicates are expiry <= current statement time; quota <=25 hours old (24-hour window plus one-hour cleanup allowance); audits <=90 days old. Thought deletion cascades post-specific dependencies; account deletion clears audit/reporter links. Caller must repeat batches until all counts are zero to drain backlogs. Phase 5 owns hourly scheduling, whole-job locking and draining. No expired-content archive exists.

Geometry: `geo_datasets.version=1`; areas keyed `(dataset_version,source_feature_id)` with source label, broad public label, privacy tier and valid `geometry(MultiPolygon,4326)` `geom`. Tier keys **7/6/5** are urban/intermediate/sparse-island H3 resolutions; `privacy_tiers.algorithm_version=1`. NCR labels are Metro Manila; other province labels and historical source limitations are documented. Phase 4 owns H3 cell and deterministic inland representative construction. No original coordinate columns, raw-pin log/queue storage, fictional thoughts, or empirical anonymity claim are introduced.

## TDD evidence

1. Native real PostGIS empty-database test ran before schema implementation: **1 failed**, expected `thoughts` but `to_regclass` returned null, exit 1. The test-owned DB was dropped afterward.
2. After SQL migration implementation, real integration suite produced **10 failed / 12 passed**: missing allowlisted published data, visible active read, 87-area import/Manila-Cebu-Iloilo-Davao-Batanes-Siargao coverage and hard cleanup. Implemented the previously inert helpers; **22/22 passed** on the original image.
3. Least-privilege provisioning test produced **1 failed / 23 passed**, expected runtime role booleans but role was absent. Implemented role provisioning/grants. Concurrent six-way publishing committed exactly five thoughts/events and rejected the sixth.
4. Logging regression produced **1 failed / 26 passed**: DB error SQL logging was `error`, parameter length `-1`, instead of `panic`/`0`. Explicit Compose logging settings fixed the actual DB configuration; **27/27 passed** after image refresh.
5. Local credential split unit test produced **1 failed / 7 passed**, expected preparation true but inert helper returned false. Implemented split/idempotent preservation; **8/8 passed**.
6. Zero-column relation drift regression produced **1 failed / 30 passed** because migrate incorrectly resolved 0. Added migration 0004's supplemental relation inventory (names/kinds/view definitions/RLS flags), preserving old applied checksums. Targeted integration/package run **32/32 passed**.
7. Actual postbuild subprocess canary test produced **1 failed** because portable `.env` still existed. Added owned-tree sanitization; root `.env` remains intact, required static/public copies work, every fixture private environment file disappears. Package regression is included in the final green suite.
8. Final guard review found a nullable/missing relation inventory could bypass the supplemental check. A targeted real-DB regression failed as intended (migrate incorrectly resolved 0; other tests were deliberately filtered and not counted as passes). The minimal runner fix now requires inventory after migration 0004. The full suite was rerun after this operator-only change: **53/53**, including **32 real PostGIS tests**, no skipped tests.

The Phase 0 missing-DATABASE_URL test now explicitly stubs/restores that environment variable. Temporary-directory/database/role deletion validates exact test-owned targets. No skipped tests are counted as passes. Tests use the real PostGIS engine and actual scripts/filesystem effects, not mock SQL or source-text assertions.

## Spatial baseline and backup evidence

Owned container labels and `gunita_pgdata` mount were verified before change; main held only `spatial_ref_sys`/extension data. Source version was PostgreSQL **17.5**, PostGIS **3.5.2**, glibc collation **2.31**. Before the upgrade, actual pg_dump custom archive and pg_dumpall globals were created. Logical dump SHA-256: `865581f6362376de2f5b814e90ff0c700c0e2f191d9a0f34d7fae56c923e9563`.

Backups are now authenticated AES-256-GCM encrypted under ignored `.local/backups`, with a separate ignored key and Windows ACL restricted to the current user and SYSTEM. Plaintext local copies were removed; dump contents/key/password hashes were not printed or committed. Encrypted database artifact SHA-256: `9941198345e7168c7c20e25c5bf7818443bc88c0fc9311839fa033077d0f66e3`.

Independently inspected/pulled image index digest: `sha256:d7053f57b0d62c427ffbf412208b6625317124d62eebf40672e990fea81e9d53`. Only owned DB container was recreated, same PostgreSQL major and volume. `update-postgis.sh` upgraded gunita/template_postgis extensions; REINDEX SYSTEM + DATABASE then REFRESH COLLATION VERSION were completed for gunita/postgres/template1/template_postgis. All connectable DB collation versions now match **2.41**. Actual new runtime: PostgreSQL **17.11**, PostGIS **3.6.4**, GEOS runtime **3.14.1**, PROJ runtime **9.8.1** (compiled-version metadata differs and is retained in actual `postgis_full_version` evidence).

Authenticated old dump decrypted only in memory and real pg_restore succeeded into a guarded disposable DB. Migrations/static seed on that restored DB passed with **0 users / 87 areas / PostGIS 3.6.4**. Both encrypted backup files authenticated successfully; globals were not reapplied over live roles. Restore DB was dropped, main volume preserved. This is local recoverability proof, not automated offsite backup certification.

Geographic source SHA-256: `fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189`, 3,140,454 bytes, 87 valid SRID4326 features. Pinned source/CC BY 3.0 IGO attribution, source age, historical province labels, disputed/tiny-island fail-closed policy and conservative tier limitations are in `assets/geo/README.md`.

## Verification and limits

The application commit SHA is supplied in the controller handoff and ignored task report. All commands used bundled Node 24.19.0 first in PATH; pnpm is 11.25.0. Heavy checks ran with one worker; the build used a 1536 MB heap cap. Playwright used one color policy (NO_COLOR removed, FORCE_COLOR=0).

| Command or observation                          | Actual result                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                     | PASS final **53/53**, 5 files, **14.85s**, exit 0; includes **32 real PostGIS tests**                                                        |
| `pnpm format:check`                             | PASS, all matched files use Prettier style, exit 0                                                                                           |
| `pnpm lint`                                     | PASS final fresh run, zero diagnostics, exit 0                                                                                               |
| `pnpm typecheck`                                | PASS, route types generated and tsc completed, exit 0                                                                                        |
| `pnpm peers check`                              | PASS, no peer dependency issues, exit 0                                                                                                      |
| `pnpm build`                                    | PASS, compile **43s**, TypeScript **52s**, all four static pages generated, exit 0                                                           |
| `node scripts/db.mjs prepare`                   | PASS first migration 3 + 87 geometry areas, then explicit version 4 applied once                                                             |
| `node scripts/db.mjs migrate`, `seed`, `expire` | PASS repeats: 0 migrations, 0 imported areas, all six cleanup counts 0                                                                       |
| `LOCAL_PREVIEW=true pnpm start`                 | PASS, new sanitized standalone at 127.0.0.1:3000, process session **97762** retained for review                                              |
| Actual HTTP standalone smoke                    | Root 200 with honest Local foundation; health/ready 200 `{status:'ok'}` and no-store                                                         |
| `pnpm test:e2e`                                 | PASS **3/3**, **11.0s**, actual Chromium against the new standalone                                                                          |
| Generated artifact private-value scan           | PASS **1,560 files**, private env filenames `[]`, literal generated secret/credential matches `[]`; root runtime/operator settings preserved |
| Direct runtime-role proof                       | `current_user=gunita_app`; superuser, CREATEDB, CREATEROLE, public schema CREATE all false                                                   |
| Main inventory / isolated-test cleanup          | **0 accounts / 0 thoughts / 87 areas / 4 migration versions**; no remaining gunita_test databases/roles                                      |
| Services / volume                               | DB + Mailpit healthy, loopback bindings, same owned gunita_pgdata volume                                                                     |
| `git diff --check`, ignores                     | PASS; `.env`, `.env.db`, backup/key files remain ignored                                                                                     |

Controller independently confirmed current HTTP health/readiness no-store responses and recursively found no private env/local entries in standalone. Browser reloaded the new foundation with no console warnings/errors. Evidence: `.superpowers/sdd/IMPLEMENTATION_PLAN/phase-1-browser-smoke.png` and `phase-1-controller-app-evidence.json` (ignored controller artifacts).

An initial whole-tree lint process stalled without diagnostics and was stopped by its verified owned PID; the final fresh lint with explicit ignored operator/scratch directories passed. One explicit formatter invocation included `.env.example`, for which Prettier has no parser; it was removed from explicit file targets, and the normal complete format check passed. These command/setup observations are not recorded as application test failures or passes.

Index tests deliberately disable sequential scans on tiny fixtures to prove index eligibility. They are not natural planner selectivity/load benchmarks; 10k map scaling is a later-phase gate. Authentication, verification/consent/authorization guards, UI, H3 coarsening, whole-job scheduling, production secret isolation, offsite backup automation, legal/geographic review and production launch are not claimed by this schema phase. The original Phase 0 query-deadline follow-up remains Phase 8 work. No attempt was made to remove the previously approval-blocked inactive Phase 0 clone.

After the final operator-runner guard fix, changed-file ESLint and a real main migration repeat passed (0 pending). The already-passed production build/start/artifact proof remains valid: the changed migration runner is operator-only and is not traced into the app artifact. Final frozen-lockfile installation also passed (already up to date, 2s).
