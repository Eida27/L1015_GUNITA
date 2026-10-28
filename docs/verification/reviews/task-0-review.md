# Phase 0 task review

## Spec compliance

- **✅ Spec compliant for Phase 0.** Reviewed application range `b4532bd..6eeef800cae946bcfed12d2322c9f595a892ff38` through the supplied review package, against the full task brief, design specification and plan operating/global requirements. This is a foundation gate, not approval of the later product or production deployment.
- Reproducibility, strict TypeScript, aliases, scripts, formatting and test harnesses are present: `package.json:6`, `package.json:11`, `tsconfig.json:7`, `tsconfig.json:17`, `playwright.config.ts:3`, `vitest.config.ts:4`; the package includes the committed integrity-bearing pnpm lockfile. The reported frozen installation, lint, typecheck and build evidence is recorded at `task-0-report.md:64` in this directory.
- Architecture rationales and implementation boundaries cover all requested topics: `docs/adr/README.md:5`. No later-phase feature is represented as finished: `src/app/page.tsx:32`, `README.md:5`; no fictional thoughts or product controls were introduced.
- Local setup uses generated untracked credentials, preserved existing configuration and loopback services: `scripts/setup-lib.mjs:8`, `scripts/setup-lib.mjs:13`, `.gitignore:7`, `.env.example:1`, `compose.yaml:11`, `compose.yaml:26`. No real provider credential or production domain is required for local development/build.
- The DB-only host-access bridge is a documented local exception to the design's eventual internal-only DB topology, not an undisclosed production claim: `compose.yaml:14`, `compose.yaml:51`, `docs/adr/README.md:20`, `README.md:40`. It retains the internal network, publishes only on loopback, and keeps Mailpit/Caddy off both DB networks. The supplied readiness evidence confirms the actual loopback binding and HTTP 200. This is acceptable for the host-run Phase 0 app; production must remove both the bridge and DB port as documented.
- GitHub Actions is conditionally required only when GitHub is used. The supplied no-remote audit and explicit deferral at `README.md:78` satisfy this boundary. Schema, role separation, auth, localization, map, security suite, backups and production packaging remain in their named later phases; their absence is not a Phase 0 omission.

## Strengths

- `scripts/start.mjs:6` validates configuration before the generated server import at line 13; preview forcibly binds loopback at line 11. `tests/unit/startup.test.mjs:13` tests the observable failure-before-import contract using a subprocess fixture and checks redaction.
- `src/lib/validation/json.ts:14` and `src/lib/validation/json.ts:21` enforce both declared and actual byte limits; decoding rejects malformed UTF-8 and JSON, and caller schemas determine the returned value. The tests cover oversized, malformed, overposted and misleading-length input (`tests/unit/http.test.ts:54`, `tests/unit/http.test.ts:74`).
- `src/lib/api/errors.ts:28` maps unknown exceptions to a closed generic response and does not serialize exception messages or Zod details. Both health routes use no-store responses (`src/app/api/health/route.ts:3`, `src/app/api/ready/route.ts:6`). DB access remains behind the server route; the changed page/layout have no credential or DB imports.
- `scripts/setup-lib.mjs:8` uses exclusive creation rather than overwriting `.env`, with unique random secrets and a restrictive creation mode. Behavioral filesystem tests verify preservation and uniqueness (`tests/unit/setup.test.mjs:23`, `tests/unit/setup.test.mjs:47`).
- `tests/e2e/foundation.spec.ts:3` exercises readiness across the real host/container boundary. The controller's separate Browser and service observations supplement these tests instead of replacing them. Semantic landmarks, visible focus, minimum link targets and reduced-motion support are implemented (`src/app/layout.tsx:17`, `src/app/page.tsx:18`, `src/styles/globals.css:29`, `src/styles/globals.css:143`, `src/styles/globals.css:342`).

## Issues

### Critical

- None found.

### Important

- None found within Phase 0 scope.

### Minor

1. **Bound the readiness query as well as connection establishment.** `src/server/db/readiness.mjs:8` sets only `connectionTimeoutMillis`; `src/server/db/readiness.mjs:11` awaits the query without a deadline. If a connected database stops answering, the endpoint can remain pending rather than return its generic 503, and repeated checks create additional pools. Add an end-to-end query deadline with connection destruction/cleanup on expiry when hardening this probe. The current healthy and connection-refused evidence does not exercise a stalled established connection. This does not invalidate the observed local boot/readiness gate.
2. **Make the unavailable-readiness unit test independent of inherited environment.** `tests/unit/http.test.ts:39` calls the route without explicitly clearing/restoring `DATABASE_URL`. In a shell that exports a valid URL, the test can connect successfully and fail its expected 503 even though the application is correct. Stub that environment variable to absent for this test and restore it afterward. The existing clean-shell pass remains valid.
3. **Remove the conflicting test-runner color settings.** `task-0-report.md:62` records an inherited `NO_COLOR`/`FORCE_COLOR` warning in the E2E run. This is runner noise, not an application-console defect or failing test. Configure the verification invocation to use one color policy so future output is clean; the recorded successful assertions need not be rerun solely to regenerate this review's evidence.

## Version and operational limits

- `docs/adr/README.md:23` discloses the reported ESLint 9 end-of-support constraint and incompatible ESLint 10 plugin peers. Exact compatible stable pins plus successful peer/build checks meet the Phase 0 baseline requirement; this review does not certify ongoing upstream support. Upgrade work remains explicit.
- `compose.yaml:5` pins an immutable image; `docs/adr/README.md:51` and the supplied service evidence identify its actual PostgreSQL 17.5/PostGIS 3.5 contents. An immutable digest is reproducibility evidence, not patch/security currency. The old patch baseline is explicitly local-only and must be revisited before production; no claim of current security support is approved here.
- `task-0-report.md:99` records the approval-blocked temporary-clone deletion. This is a cleanup residual, not an application defect or failure of the successful fresh-clone boot. Do not claim complete filesystem cleanup. The controller reports test services/networks/volume removed and the inactive directory preserved.

## Verification and cannot-verify items

- Read the task brief, detailed implementation report, packaged commit/stat/diff, approved design and relevant plan requirements. Large tool output truncated during the initial combined read, so source/configuration/test sections were read in bounded package slices; no changed source file was opened separately and no Git diff was regenerated. No tests or application commands were rerun; no application files were changed.
- Named compatibility risk checked outside the diff: standalone static-asset placement and hostname handling. The bundled Next 16.4.2 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md:34` documents standalone output, manual static/public copying and `HOSTNAME`/`PORT`; the implementation follows that pattern. The bundled route-handler guide confirms the native Request/Response convention and uncached route behavior.
- Read controller evidence `phase-0-readiness-green.json:2` (HTTP 200, no-store, exact loopback DB publishing), `phase-0-services-evidence.json:5` (actual database/PostGIS versions), and `phase-0-services-evidence.json:20` (Mailpit HTTP success), plus the progress record. These corroborate the report without replaying the checks.
- **⚠️ Runtime results are recorded evidence, not newly executed by this reviewer.** The report provides 19 unit tests, 3 E2E tests, lint/typecheck/build/frozen-install and fresh-clone outcomes (`task-0-report.md:64`, `task-0-report.md:89`); the controller separately reports Browser/SMTP acceptance. This review checks their consistency with the implementation and does not independently certify every raw log line, current process state, or temporary-directory cleanup.
- **⚠️ Production and later-phase guarantees cannot be verified from this diff.** Credential validity, provider delivery, maintained security baseline, least-privilege roles, auth/authorization, content privacy, migration integrity and deployment isolation require their later phase gates. Startup field validation is not evidence of those guarantees (`README.md:68`, `README.md:70`).

## Assessment

**Task quality: Approved.**

The implementation provides the requested reproducible local foundation with honest scope, safe startup ordering, useful HTTP contracts and substantive behavioral verification. The three minor findings do not block Phase 0 acceptance; approval does not erase the documented dependency/cleanup limitations or authorize a production launch.
