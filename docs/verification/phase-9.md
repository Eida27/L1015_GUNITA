# Phase9 — portable deployment package

Implementation prepares production deployment and proves an isolated local staging simulation. No real domain/VPS/provider was selected or deployed, no public ingress enabled, no real provider credentials used, and no push/PR/merge performed. Earlier Phase7/8 Browser acceptance belongs to the controller; this phase did not replace or mutate its retained database/identities/thought.

## Contracts and package

- Multi-stage Dockerfile: pinned Node24.19.0 base, pnpm11.25.0 lockfile install, standalone build with one worker/1536MiB build heap, existing sanitizer and pre-import startup validation, UID/GID10001 web/operator targets.
- Explicit production/staging Compose: internal-only PostgreSQL, no DB/web/SMTP/metrics host port, Caddy-only ingress; isolated rehearsal binds127.0.0.1:8449. No Docker socket. Read-only web/operator filesystems, dropped capabilities, bounded resources, restart/health/graceful-stop configuration.
- Separate service secrets, explicit initialization/migration/admin/restore operator commands, no demo seeding. Backup credential uses the existing full-dump operator contract because the PostGIS image includes extension schemas not readable by the migrator. No grants were broadened for web.
- Separate hourly maintenance preserves its advisory lock; daily encrypted7day backup preserves external paths, private separate key, bounded archive/tools and authenticated quarantined restore; metrics emits fixed operational aggregates only. Failed jobs remain unhealthy and retry after5minutes.
- Production journald logging plus dedicated-host7day retention template and mandatory operator verification. Staging uses bounded local logs, requiring exact owned-container removal within7days. No host journald changes were applied. Non-systemd hosts need an explicitly verified equivalent collector.
- Runbooks document Cloudflare Full(strict), proxy/cache/origin trust gates, optional Tunnel, current official provider options, launch/admin/rollback and quarantine requirements. Provider validity, actual offsite delivery, external alerts, production certificate expiry monitoring and real load sizing remain launch gates.

## Observed proof

Focused TDD: RED identified missing container hostname and absent operations modules. GREEN expanded regression: **21/21 tests,9/9 files**,25.38s, exit0, including setup, startup, Turnstile, readiness, backup paths/encryption and sanitizer. One worker, NO_COLOR removed, FORCE_COLOR0. This phase intentionally did not repeat the prior full154test/46E2E evidence solely for a fresh reporter.

Actual production Compose config exit0. Actual corrected web Docker build exit0: compile79s, TypeScript41s,18static pages, all route table emitted, sanitizer completed. Final web image `sha256:b1d5cb457a9e3d5dfa1a6e8c6830264e2cb9556066278cba24756689dc7efceb`. Operator image `sha256:6ccbde9e588e078fcfc5081cdb8f6e2b3aca655e6d03d7f56d9a71ea47cadc96`; local runtime inspection confirms UID10001. Host bundled Node changed during app resume from24.19 to24.22.1; Docker proof remains pinned24.19.0.

Owned rehearsal project `gunita-rehearsal-a817917e`, private receipt `.local/phase-9-rehearsal.json`. Actual startup/recovery returned all services healthy. `node scripts/rehearse.mjs verify` final exit0:

```text
PASS topology: private DB, no web/DB/SMTP/metrics host ports; Caddy loopback only; web secret isolation
PASS verified CA + hostname HTTPS /api/health: 200, no-store, HSTS
PASS verified CA + hostname HTTPS /api/ready: 200, no-store, HSTS
PASS verified CA + hostname HTTPS /api/me/thoughts: 401, no-store, HSTS
PASS non-root web and no operator secret
PASS initialized 87 areas, zero demo users/thoughts, least-privilege runtime
PASS admin bootstrap verification, exact confirmation and operator-only privilege
PASS scheduled archive present; encrypted backup, tamper rejection, isolated restore/expiry/session cleanup, runtime CONNECT denied
PASS maintenance no-overlap lock and actual expired-row deletion
PASS local staging rehearsal; not a production launch
```

TLS uses a request-scoped public CA copied from the owned Caddy volume; hostname/certificate validation remains enabled. No OS/browser trust installation or insecure flags. Official local Turnstile contract remains unchanged; narrow `CONTAINER_PREVIEW=true` requires production local-preview+local-proxy and existing loopback origin, choosing only the container bind address.

`node tests/fixtures/production-failure-check.mjs` corrected run exit0:

```text
PASS invalid preview/production settings fail startup without exposing dummy secrets
PASS DB outage returns bounded minimal503 readiness
PASS same owned DB recovery restores readiness200
PASS backup failure is unhealthy; actual successful retry repairs health
PASS maintenance graceful restart and fresh successful health
PASS real logs contain aggregate metrics and no fixture body/email or dummy secret values
```

Observed metrics: web/database ready true, expired-live rows0, cleanup lag0, moderation queue/age0, backup/maintenance success age, archive free bytes. Spot resource snapshot: web~60MiB, DB~89MiB, maintenance~16MiB, backup~21MiB, metrics~31MiB, Caddy~13MiB. This is an idle local sample, not a load/capacity/SLA claim.

## Failures retained and corrected

1. Initial deny-all build context omitted imported locale catalogs. Docker compilation failed explicitly; narrowly allowlisted `locales/en.json` and `fil.json`; corrected real build passed. Failed log remains `.local/phase-9-build.log`.
2. Docker Desktop stopped across app pauses. Restored same engine/resources without resetting volumes; unavailable-engine attempt is retained separately. Main DB/Mailpit IDs remained `bef039778816`/`8aff39410feb`.
3. Initial backup source used migrator; whole-DB pg_dump failed on image-owned tiger schema. Corrected only isolated backup source secret to existing operator contract. No schema exclusions/grants changed. Failed startup/health receipt retained; scoped recovery exit0.
4. Probe fixture inserted a profile despite existing account-profile trigger (23505), then used an invalid H3 string(23514). Corrected test fixture to rely on trigger and actual H3 cell; product unchanged. Failed receipts remain; final probe passed and deleted its owned fixture user/thought and restore database.
5. Failure harness initially omitted the entry command when Compose replaced CMD. Correct command is service `backup` plus `backup --once`; corrected harness/runbook and real failure/retry proof passed.

## Actual artifact audit

`docker build --target context-audit --output type=local,dest=.local/phase-9-context-proof .` exported the real5.15MiB build context and exited0. `node tests/fixtures/production-artifact-check.mjs` exited0 with all checks:

```text
PASS actual exported build context: 155 allowlisted files, locale catalogs present, no private env/keys/archives/values
gunita-web:phase9: PASS image private-data scan files=1808
gunita-operator:phase9: PASS image private-data scan files=19895
```

The audit compares sampled actual private database-password/auth-secret values without printing them. Both image scans ran with network disabled and no secret mounts. This verifies actual exported files and images, rather than only inspecting ignore-pattern text. The owned source/main database volumes were not modified.

## Final quality checks

Full-source ESLint passed with exit0 and no warnings/errors using the same pinned ESLint9.39.5, eslint-config-next16.4.2 and unchanged project configuration in the Linux Node24.19.0 dependency image. The host attempt stalled at config import without diagnostics; its exact owned process was stopped and the failed attempt retained, rather than described as a source failure or a pass.

The fallback built the cached `dependencies` target as `gunita-checks:phase9` (exit0), then ran `node node_modules/eslint/bin/eslint.js . --max-warnings 0` with read-only mounts for every root JS/TS config plus `src`, `scripts`, `tests` and `locales`. Network was disabled, build heap bounded at1536MiB, and no private environment files/keys were mounted. This linted the full project source, including the new fixtures, rather than only standalone output. Final reporter: `Linux full-source ESLint exit=0`. The exact argument array is retained privately in `.local/phase-9-linux-lint-args.json`.

The actual Docker production build already completed TypeScript checking; no TypeScript source changed afterward. `git diff --check` passed. Self-review covered startup/secret isolation, topology, least privilege, key/archive ownership, restore quarantine/reconciliation, job termination/failure health, sanitized metrics, meaningful tests, and production launch limitations. No unresolved implementation failure was found in this self-review; independent controller review remains separate.

Raw private receipts are retained under `.local/phase-9-*` and are intentionally uncommitted. The task report records the local commit. Runbooks: [deployment](../operations/deployment.md), [launch checklist](../operations/launch-checklist.md), [backup quarantine](../operations/backups.md).
