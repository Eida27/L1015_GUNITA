### Spec Compliance

- ❌ Issues found: the required transaction-safe five-publication cap can be exceeded under REPEATABLE READ. `src/server/db/migrations/0002_domain.sql:90` serializes execution, but the count at line 91 can retain a snapshot that excludes already committed publications. A focused reproduction against the supplied migrations committed six thoughts and six quota events for one author.
- ✅ The remaining reviewed Phase 1 producer contracts are present: generated auth schema and UTC adaptation (`src/server/db/auth-schema.ts:15`), versioned domain migrations (`src/server/db/migrations/0002_domain.sql:1`), checksum-bound static geography (`src/server/db/seed-geo.mjs:29`), allowlisted strict-expiry public reads (`src/server/db/published.mjs:3`), and transactional retention cleanup (`src/server/db/cleanup.mjs:3`).
- ⚠️ Cannot verify from this phase: actual random public-ID generation, atomic signup/profile creation, all future map/bookmark/count/aggregation callers, expired-unhide route enforcement, H3 coarsening, scheduled cleanup draining, and production secret isolation. Those consumers/lifecycle operations are explicitly later-phase work; their absence is not an additional Phase 1 finding.
- ⚠️ Verification limit: the supplied report records the final 53/53 suite and build/browser results. I reviewed the test implementations and the two controller evidence JSON files; I did not rerun those suites or independently replay the historical auth-generator or encrypted backup/restore operations. Literal GeoJSON coordinates were reviewed through focused byte/hash/structure inspection rather than reading millions of coordinate characters.

### Strengths

- `src/server/db/published.mjs:7` selects a small explicit public projection, parameterizes the slug, and applies strict statement-time expiry even inside a long transaction; private ownership and interaction totals never enter this result.
- `src/server/db/migrations/0002_domain.sql:64` makes thought identity, location and expiry immutable, while independent quota rows survive content deletion. `tests/integration/database.test.mjs:301` and the following expiry/cascade/race tests exercise actual PostgreSQL behavior.
- `src/server/db/migrate.mjs:62` checks ordered migration history, SQL checksums, catalog fingerprints, and supplemental relation inventory before applying all pending changes in one transaction. Tests cover drift, missing inventory and rollback without losing prior data.
- `src/server/db/roles.mjs:54` grants constrained profile updates, prevents runtime quota/audit erasure, and keeps static geography read-only. `src/server/db/migrations/0002_domain.sql:134` preserves audit history while allowing FK identifier erasure.
- `assets/geo/README.md:3` documents source age, provenance, license and limitations. The actual vendored file has 3,140,454 bytes, SHA-256 `fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189`, 87 unique feature IDs, only Polygon/MultiPolygon geometries and only PHL feature groups, matching the import contract.
- `tests/unit/standalone.test.mjs:15` invokes the actual packaging script and verifies private-file removal plus retained root settings/static assets. The controller artifact evidence also reports no private packaged entries.

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- **[P2] Make the quota trigger safe for fixed transaction snapshots.** `src/server/db/migrations/0002_domain.sql:90` acquires an advisory transaction lock, then line 91 counts ledger rows. Under REPEATABLE READ, acquiring that lock does not refresh the transaction snapshot. Six concurrent transactions can each see the same initially empty ledger, take the lock in sequence, insert distinct rows and all commit. The existing default-isolation race test does not exercise this case. This violates the binding five-post cap and makes a future service's isolation choice silently weaken the database invariant. Add an explicit fail-closed isolation requirement (with documented READ COMMITTED support), or a serialization mechanism that forces conflicting fixed-snapshot transactions to abort. Add a regression using pre-established REPEATABLE READ snapshots. Preserve applied migration checksums by using a new reviewed migration.

#### Minor (Nice to Have)

- None raised.

### Checks and focused reproduction

- Reviewed the supplied diff in passes, with focused dependency-pin/link inspection and GeoJSON byte/hash/structure parsing. No changed application file was separately reread; file/line references were derived from diff hunks. No Git commands or full suites were run.
- Outside-diff check for the named geographic provenance risk: read the vendored GeoJSON bytes solely to calculate SHA-256, byte count, feature count, unique IDs, geometry types and country groups. All matched the documented source contract.
- Outside-diff check for the named packaging/runtime evidence risk: inspected `.superpowers/sdd/IMPLEMENTATION_PLAN/phase-1-controller-db-evidence.json` and `phase-1-controller-app-evidence.json`. They record PostgreSQL 17.11/PostGIS 3.6.4, 87 areas, zero users/thoughts/raw-coordinate columns, healthy uncached endpoints, and an empty private-artifact list.
- Focused quota test: executed an inline Node program using `pg`, the actual exported `migrate()`, and private operator configuration loaded without printing credentials. Created one guarded `gunita_test_<16 hex>` database, installed PostGIS, applied the exact supplied migrations, inserted one disposable user, and opened six clients. Each ran `BEGIN ISOLATION LEVEL REPEATABLE READ` and `SELECT count(*) FROM post_quota_events` before any inserts. Ran all six valid thought inserts concurrently, committing each successful insert. No application files, main data or roles were modified.
- Exact observed result: `{"isolation":"repeatable read","results":["committed","committed","committed","committed","committed","committed"],"counts":{"thoughts":6,"quota_events":6}}`. The program exited 0 and printed `Owned disposable review database dropped` after its guarded `finally` cleanup. A subsequent read-only `pg_stat_activity` inspection returned no `gunita_test_%` sessions.
- Compact regression recipe: establish all six fixed snapshots before dispatching the inserts; use a valid distinct `t_` plus 16 random base64url bytes for each slug, the same author, and the existing valid integration thought fixture. Expect no execution path to commit more than five publications. If unsupported isolation is rejected, also assert the rejection leaves both thought and quota tables unchanged.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The schema, privacy boundaries, import validation and real-database tests form a strong Phase 1 foundation, but the reproduced isolation-dependent quota bypass breaks a critical producer invariant. Resolve this finding and rerun the targeted isolation/default-concurrency checks before advancing the phase gate.
