# Phase 0 implementation report

Status: Phase 0 functional exit gate PASS, including literal fresh-clone proof. Test containers, networks and volume removed; temporary clone-directory deletion remains automatically approval-blocked.

Application commit: `6eeef800cae946bcfed12d2322c9f595a892ff38` (`feat: establish Gunita local-first foundation`). Baseline: `b4532bd`; branch: `implementation/local-first`. No remote, push, deployment, schema migration, user account, map, or thought content was created. The approved specification and plan files are unchanged.

## Delivered files

- Reproducibility/configuration: `.gitattributes`, `.gitignore`, `.dockerignore`, `.node-version`, `.nvmrc`, `.npmrc`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`.
- Application: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/icon.svg`, `src/styles/globals.css`. The page explicitly says **Local foundation** and **Map, accounts, and publishing are still to come**. No fictional posts, disabled product controls, accounts, age gate, or map were implemented.
- Server contracts: `src/app/api/health/route.ts`, `src/app/api/ready/route.ts`, `src/server/db/readiness.mjs`, `src/lib/api/errors.ts`, `src/lib/validation/json.ts`.
- Launch/setup: `scripts/setup-lib.mjs`, `scripts/setup.mjs`, `scripts/load-env.mjs`, `scripts/env.mjs`, `scripts/local.mjs`, `scripts/dev.mjs`, `scripts/start.mjs`, `scripts/prepare-standalone.mjs`.
- Infrastructure/docs: `compose.yaml`, `infra/Caddyfile`, `.env.example`, `README.md`, `docs/adr/README.md`, and Next-generated `AGENTS.md`.
- Tests: `vitest.config.ts`, `playwright.config.ts`, `tests/unit/http.test.ts`, `tests/unit/setup.test.mjs`, `tests/unit/startup.test.mjs`, `tests/e2e/foundation.spec.ts`.

## Exact versions and compatibility

All npm pins were queried from the registry before use, installed with exact package versions, and integrity-bound by the committed pnpm lockfile.

| Component | Exact version |
| --- | --- |
| Node LTS | 24.19.0 |
| pnpm | 11.25.0 |
| Next.js / eslint-config-next | 16.4.2 |
| React / React DOM | 19.3.1 |
| Zod | 4.6.7 |
| pg | 8.23.1 |
| TypeScript | 6.0.3 |
| ESLint | 9.39.5 |
| Prettier | 3.9.10 |
| Vitest / Vite | 5.0.5 / 8.3.4 |
| Playwright | 1.64.1 |
| @types/node | 24.19.2 |
| @types/react / @types/react-dom | 19.3.0 |
| PostgreSQL / PostGIS in selected image | 17.5 / 3.5 |
| Mailpit | 1.31.6 |
| Optional Caddy | 2.11.7-alpine |
| Docker daemon observed | 29.8.2 |

Verified later-phase candidates, recorded in ADRs but not prematurely installed/implemented: Better Auth and separate `@better-auth/drizzle-adapter` 1.7.11; Drizzle ORM 0.45.4 / Kit 0.31.11; MapLibre GL JS 6.15.0; h3-js 4.5.0.

TypeScript 7.0.2 was the registry default, but the current ESLint TypeScript parser peer requires `<6.1.0`; 6.0.3 satisfies that constraint. ESLint 10.13.0 initially exposed real incompatible peer ranges in Next's transitive React/import/a11y plugins. Switched to verified stable 9.39.5; `pnpm peers check` then printed **No peer dependency issues found**. ESLint 9 is registry-deprecated/end-of-support; upgrade when those plugin peers support 10. This is recorded as an explicit tooling limitation.

Immutable Docker index pins:

- PostGIS: `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6`.
- Mailpit: `sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387`.
- Caddy: `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`.

The PostGIS pin contains old PostgreSQL patch 17.5 on Debian 11. This is a reproducible **local-only** baseline, not current-patch certification. Replace/review its patch/security baseline during security hardening before production use.

## TDD evidence

Tests exercise real responses, streaming/body parsing, filesystem effects, subprocess startup, actual PostgreSQL readiness, and browser behavior. None grep source/configuration text to pretend runtime proof.

1. Before implementation, a native Node assertion harness observed RED: health returned `{}` instead of `{status:'ok'}`; generic errors returned 200 instead of 500; development origin was undefined; production validation did not throw; setup returned false instead of creating local configuration. All five assertions failed for the intended absent behavior.
2. First complete Vitest RED run: **9 failed, 10 passed, 3 files**. Failures were actual assertions: readiness 200 versus expected 503; JSON helper resolved `{}` instead of validated input/rejections; unsafe/malformed/oversized/overposted bodies were accepted; invalid production configuration imported the standalone fixture and exited 0. Output read in full. Native harness-covered health/environment/setup behavior was already green by this run.
3. Implemented bounded streamed JSON parsing (byte-counting even with misleading content-length), strict Zod schemas at callers, sanitized closed-code errors, random exclusive-create `.env` setup, and startup validation before dynamic generated-server import. Vitest GREEN: **19/19**, first in 19.17s; final `pnpm test` **19/19 in 13.04s**.
4. The rendered baseline page was requested over HTTP before final page implementation; assertion failed with **Foundation must identify itself honestly as Local foundation**. Added the labeled foundation page. Browser/E2E verified final rendered behavior.
5. Actual host database access initially failed `ECONNREFUSED 127.0.0.1:55435`; Docker's published map was `{"5432/tcp":[]}` although the DB was healthy internally. Added a persistent Playwright readiness regression before the fix: RED **expected 200, received 503**. A single configuration change attached DB to a separate DB-only host-access bridge while retaining the internal database network and loopback-only binding. Recreated only this project's DB container, preserving its volume. GREEN actual binding `127.0.0.1:55435`, `/api/ready` 200, all **3/3 E2E passed in 9.3s**.

An initial E2E attempt failed before browser launch because Chromium was not installed. It is recorded as a setup failure, **not** valid TDD RED evidence. Installed the pinned browser (Chromium 156.0.8078.4, Playwright build 1248) and reran successfully. Runner emitted an inherited NO_COLOR/FORCE_COLOR warning; the application Browser console had no warnings/errors.

## Checks and measured results

All commands used bundled Node 24.19.0 first in PATH. Initial package installation took 12m39.1s under host memory pressure; no failure was inferred as a pass. The host has 4 logical CPUs / 8 GB RAM (Pentium Silver N5030); Vitest, Playwright, and Next static workers are bounded to one. Builds used a process-local 1536 MB Node heap cap and disabled telemetry.

| Command / observation | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (main checkout) | PASS, Already up to date; 6s; exit 0 |
| `pnpm peers check` | PASS, no peer issues; exit 0 |
| `pnpm lint` | PASS after correcting Next's root-link lint error with `next/link`; final exit 0 |
| `pnpm format:check` | PASS, all matched files use Prettier style; exit 0 |
| `pnpm typecheck` | PASS, route types generated and tsc exit 0 |
| `pnpm test` | PASS, 19 tests / 3 files, 13.04s; exit 0 |
| `pnpm build` | PASS, final rebuild compiled 15.8s, TypeScript 26.9s; all static pages generated; exit 0 |
| `LOCAL_PREVIEW=true pnpm start` | PASS, standalone bound to 127.0.0.1:3000 |
| `pnpm test:e2e` | PASS, 3 tests, 9.3s; exit 0 |
| `/api/health` and `/api/ready` | PASS, 200 `{status:'ok'}`, `Cache-Control:no-store` |
| Main DB/Mailpit | PASS, both healthy; SQL/database/extensions and real Mailpit HTTP/SMTP observed |
| Optional Caddy profile | PASS, pinned image started; `127.0.0.1:8088/api/health` and `/api/ready` both 200; then stopped optional Caddy |
| `git diff --cached --check` before application commit | PASS, no whitespace errors |
| Secret and approved-document check | Only `.env.example` tracked; `.env` ignored; approved spec/plan absent from staged diff |

Main service facts and independent controller proof: `.superpowers/sdd/IMPLEMENTATION_PLAN/phase-0-services-evidence.json` and `phase-0-readiness-green.json`. Actual database is `gunita`, PostgreSQL 17.5, PostGIS 3.5, `postgis`/topology/tiger extensions present. Mailpit HTTP 200 and real SMTP `220` banner observed. Internal `gunita_database` network remains `Internal=true`.

Controller Browser acceptance PASS against final standalone: desktop system-dark view; 320x740 mobile view with no horizontal overflow (`scrollWidth=305 <= innerWidth=320`); health link clicked and JSON read; back navigation works; no console warnings/errors. Screenshot: `.superpowers/sdd/IMPLEMENTATION_PLAN/phase-0-browser-desktop.png`. Separate Playwright checks include narrow layout and first-Tab skip-link focus.

## Fresh-clone proof

A literal `git clone --no-hardlinks` of application commit `6eeef800` was created under `C:\Users\anula\AppData\Local\Temp\gunita-phase0-proof-6eeef800`. It used its own Compose project `gunita-p0-6eeef800` and alternate documented loopback ports (app 3001, DB 55436, SMTP 1029, mail UI 8029), generated its own fresh random `.env`, and preserved the main project's resources.

- `pnpm install --frozen-lockfile`: PASS, lock resolution skipped, 381 packages reused, zero downloads, 54.5s, exit 0.
- `pnpm local`: PASS, independently initialized a new PostGIS volume, healthy DB and Mailpit, Next ready at `127.0.0.1:3001` in 3.6s.
- Fresh app rendered the honest foundation label; `/api/health` and `/api/ready` both returned 200 `{status:'ok'}`. Fresh Mailpit `127.0.0.1:8029/api/v1/info` returned 200 / v1.31.6.
- `pnpm test`: PASS, 19/19 tests across three files, 12.18s, exit 0.
- `pnpm format:check`: PASS; all matched files formatted. Fresh SQL `PostGIS_Version()` returned `3.5 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`.

Cleanup: a combined ownership-check/process-stop/Compose-down/recursive-delete command was automatically rejected with **blocked by policy**, without a more specific reason. It performed no action. Narrowed read-only checks independently verified the exact resolved temporary directory, proof listener PID 16548 belonging to that directory, and volume label `com.docker.compose.project=gunita-p0-6eeef800`.

The explicit narrowed process-stop and `docker compose -p gunita-p0-6eeef800 ... down --volumes` succeeded (exit 0): both test containers, all three test networks, and the test volume were removed. Main `gunita` resources were preserved. A separate literal PowerShell `Remove-Item -LiteralPath 'C:\Users\anula\AppData\Local\Temp\gunita-phase0-proof-6eeef800' -Recurse -Force` was again automatically rejected as **blocked by policy**, with no more specific reason. No equivalent workaround was attempted. The inactive temporary clone directory, dependencies/generated cache and its private local `.env` remain at that exact path as an explicit residual; no test service or listener is intentionally left running.

## Decisions, boundaries, and handoff

- Ten accepted architecture defaults have concise ADR rationale. No later-phase implementation is claimed.
- Database runtime-role separation, schema/Better Auth generation and migrations start in Phase 1; the Phase 0 local bootstrap role is intentionally not represented as least privilege production access.
- Development DB has an internal database network plus a separate DB-only host-access bridge to make loopback publishing work on Docker Desktop. This allows development DB egress. Production must omit this bridge and published DB port. Mailpit/Caddy do not join DB networks.
- Setup preserves an existing `.env` and existing DB volume. Secrets are random and untracked; sample values are placeholders. `.gitattributes` ensures LF checkout on Windows for reproducible formatting/container files.
- Production startup requires HTTPS origin, non-placeholder secrets/provider settings and validates before standalone import; explicit local preview is loopback-only. Provider/domain/VPS keys are not required for local dev or build, and no actual production launch is certified.
- GitHub Actions is deferred because no GitHub remote is configured; checks are local and secrets-free beyond generated development settings.
- Optional Caddy is a tested local HTTP convenience, stopped after proof. PostgreSQL/Mailpit and the main standalone preview are left running for controller review. App process session: `89031`; origin: `http://127.0.0.1:3000`.
- No application migrations, domain schema, auth, age/content gate, localization controls, map, publishing, or moderation were added. No Phase 1 work performed.
