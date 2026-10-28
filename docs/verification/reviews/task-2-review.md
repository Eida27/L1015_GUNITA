### Spec Compliance

- ❌ **Issues found.** The requested account lifecycle is substantially implemented, but login can issue a usable session from the old password after a concurrent password reset has committed. The account lock is acquired after credential validation and session creation: `src/server/auth/service.ts:175` and `src/server/auth/service.ts:188`. This leaves the reset/revalidation security contract incomplete.
- Scope checked: supplied Phase 2 diff, base `a3efb26a4f4486ebae13915b24c431b0f8794249`, head `b6d70bcfb5909ac62b847dd83a222de096a88b7e`. No broad branch review or implementation changes.
- ⚠️ **Cannot verify from this diff:** production provider delivery, trusted proxy configuration, Turnstile, operational HMAC-key rotation, scheduled retention, and later posting/interactions integration remain controller-owned later-phase gates. The local shared bucket and expiry timestamps are visible at `src/server/auth/rate-limit.ts:12`; operational rotation is not demonstrated by that implementation. These deferred production items are not additional Phase 2 blockers.
- ⚠️ **Cannot independently verify historical executions:** the supplied report records 75 passing tests, seven passing standalone E2E cases, artifact scanning and runtime privilege checks at `docs/verification/phase-2.md:48`. The controller JSON records standalone settings/logout/guest acceptance. I inspected their evidence and corresponding test code; I did not rerun those suites, inspect private credentials, or independently repeat Browser acceptance.

### Strengths

- `src/server/db/migrations/0006_account_identity.sql:6` creates the profile and replaces internal identity atomically, with bounded real uniqueness retries. Hostile fields are stripped by the request schema and library hook, and the collision/exhaustion integration test checks actual database behavior.
- `src/server/auth/service.ts:43` owns one PoolClient transaction, checks COMMIT's command, and propagates swallowed email failures before committing. The tests exercise rollback of password/token/session changes under a forced database failure rather than mocking persistence.
- `src/server/auth/service.ts:80` exposes an explicit endpoint allowlist, validates Origin and bounded input, and returns minimal private responses. `src/server/auth/guards.ts:25` rechecks current session, verification, status, ownership and role rather than trusting client state.
- `src/server/auth/library.ts:65` binds unique verification tokens to the account through a one-use digest. `src/server/auth/email.ts:17` uses fragments, and `src/components/auth/auth-form.tsx:76` removes them from the displayed URL. Public resend deliberately removes another caller's session context.
- `src/server/auth/rate-limit.ts:21` persists failed-attempt counters outside the lifecycle transaction; the regression checks cross-instance enforcement and unrelated-cookie bypass.
- React checklist: `src/app/(member)/settings/page.tsx:44` serializes only private email/pseudonym props; `src/components/auth/use-hydrated.ts:7` provides a stable hydration gate; forms have labels, status/error announcements, explicit POST and disabled pre-hydration submission. Login/logout use document navigation to clear private router state. No speculative caching or parallelization is needed.

### Issues

#### Critical

- None identified.

#### Important

- **[P1] Lock the account before validating login credentials.** `src/server/auth/service.ts:175` calls `signInEmail` before `existingActive` takes the user/profile lock at line 188. Installed Better Auth reads the credential at `node_modules/better-auth/dist/api/routes/sign-in.mjs:317`, verifies that captured hash at line 331, and creates the session at line 352. A possible ordering is: login reads the old hash; reset obtains the user lock, changes the password, removes existing sessions and commits; login then inserts its session and acquires the account lock. The latter check confirms only active status, so the old-password login receives a valid session after the reset. A surrounding READ COMMITTED transaction does not serialize those earlier reads. Acquire a common account lock before the library reads credentials, keep it through session creation, and preserve generic failure responses. Add a controlled interleaving regression requiring that an old-password login either completes before reset and is revoked by it, or fails after reset; no surviving old-password session is acceptable. Existing sequential old-password rejection and concurrent reset-token consumption tests do not exercise this race.

- **[P2] Use a consistent lock order across reset, deletion and session guards.** `src/server/auth/service.ts:247` locks a verification row before locking its user, whereas deletion obtains user/profile/session locks via `requireVerifiedMember` and later deletes verification rows at `src/server/auth/service.ts:152`. Reset can therefore hold the token while waiting for deletion's user lock, and deletion can hold the user while waiting for reset's token: one ordinary lifecycle request aborts with a database error and becomes HTTP 500. There is a second inversion at `src/server/auth/guards.ts:19`: the library may refresh and lock a session before the explicit user/profile/session lock, while reset already holds the user before revoking sessions. Establish one account-first ordering, then lock/revalidate tokens and sessions consistently; disable implicit refresh during initial identity discovery or perform it after the account lock. Add deterministic reset-versus-delete and refresh-versus-reset tests. This finding concerns availability/transaction ordering; the rollback boundary prevents partially committed deletion.

#### Minor

- None identified.

### Checks and outside-diff inspection

- Read the supplied diff in sequential passes covering documentation/dependencies, routes/UI, auth/SQL, and tests. Obtained line references from the supplied diff; did not regenerate it with Git or reread changed source files separately.
- Named risk: stale credential validation across reset. Checked installed `sign-in.mjs:317`, `internal-adapter.mjs:583`, and `password.mjs:154` to establish credential-read/session-write ordering and the reset path. The internal adapter lookup does not request a row lock.
- Named risk: implicit session writes defeating the application's lock order. Checked installed `session.mjs:153` and `session.mjs:199`; ordinary `getSession` can update the session before the application acquires its account locks. Checked `src/server/db/auth-schema.ts:52` for the session-to-user foreign key.
- Named risk: confidential error/settings responses becoming cacheable through unchanged configuration. Checked `src/lib/api/errors.ts:70` for `no-store` and `next.config.ts:8` for global header overrides; found no additional issue. Authenticated settings is explicitly dynamic in the diff.
- No tests were rerun. The two findings follow from explicit conflicting operation order in the application and pinned library; their proposed deterministic regressions were not part of the supplied evidence and remain for the implementer/controller. No runtime race reproduction is claimed.

### Assessment

**Task quality: Needs fixes.**

The implementation has strong privacy boundaries, real database/email tests, and clear ownership of transactions. The account lock must precede credential reads, and all lifecycle paths must share a consistent lock order before this Phase 2 gate can be approved.
