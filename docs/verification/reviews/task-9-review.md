## Spec Compliance

- **Verdict: Spec compliant within the Phase 9 deployment-template scope.** The diff supplies the requested production images, isolated Compose topology, Caddy configurations, operational jobs/metrics, provider and launch documentation, and dummy-secret staging rehearsal. Ruling9 is respected: the new container bind requires the existing production local-preview/local-proxy contract; it does not add a staging hostname or production authentication mode (`scripts/env.mjs:7`, `scripts/start.mjs:11`, `compose.staging.yml:13`). The two task-quality defects below need correction before approval; they do not retroactively invalidate the successful runs already recorded.
- **Cannot verify from this diff:** actual Docker build/run exits, final image contents, retained runtime ownership, and raw staging/failure/artifact reporters. The implementer reports these in `docs/verification/phase-9.md:15` and the FINAL sections of `task-9-report.md`; the controller states it inspected the raw final logs. This reviewer did not rerun those gates or independently inspect their private raw logs.
- **Cannot verify from this diff, correctly separate launch gates:** actual domain/provider credentials, external origin lockdown/Cloudflare behavior, real offsite mount and remote retention, real email/Turnstile delivery, external alerts/certificate monitoring, and host-enforced seven-day log disposal (`docs/operations/launch-checklist.md:5`, `infra/journald/60-gunita-retention.conf:1`). The package explicitly does not claim these are deployed. Their absence is not a Phase 9 template defect under the controller ruling.
- **Cannot verify from this diff:** unchanged application identity, authorization, privacy DTOs, full earlier-phase Browser acceptance, and all pre-existing backup/restore security behavior. These remain prior-phase/controller evidence; this review checks the new integration rather than reopening those phases.

## Strengths

- The web image retains the sanitizer-produced standalone artifact and configuration-validating launcher, runs as UID/GID10001, and receives only its service-specific secret. Unknown secret keys are rejected before environment mutation (`Dockerfile:37`, `scripts/container-secrets.mjs:21`, `scripts/container-entry.mjs:25`).
- Production isolates PostgreSQL on the internal database network without a host port; staging overrides only Caddy ingress to loopback and uses a separate project/volumes (`compose.prod.yml:48`, `compose.staging.yml:18`, `scripts/rehearse.mjs:67`). No Docker socket or operator secret is added to web.
- The awaited scheduler has explicit failure health, bounded retry, signal-aware sleep, and preserves the last successful timestamp across failures within the process. Maintenance delegates to the existing session-lock-protected drain (`scripts/job-runner.mjs:25`, `scripts/operations.mjs:41`, `src/server/db/maintenance.mjs:5`).
- Operational output is a fixed aggregate schema with generic failure events; the new code does not log SQL errors, bodies, emails, tokens, or client IPs (`scripts/operations.mjs:53`, `scripts/job-runner.mjs:38`).
- The rehearsal uses request-scoped CA trust with normal hostname verification and exercises real database permissions, admin controls, encryption/tampering, quarantined restore, and maintenance locking (`scripts/rehearse.mjs:126`, `tests/fixtures/production-probe.mjs:43`). Historical failed attempts remain distinct from final successful evidence in `docs/verification/phase-9.md:51`.

## Issues

### Critical

- None found in the reviewed scope.

### Important

- **P9-I01 — Serialize the documented one-off backup with the scheduled service.** `docs/operations/deployment.md:49` instructs the operator to run `run --rm backup backup --once` before stopping the running backup service. Both processes use the same `/state/backup.json` writer (`scripts/operations.mjs:88`), whose temporary filename is always `${file}.tmp` (`scripts/job-runner.mjs:4`). The scheduler's `await` serializes only its own process; it does not serialize this second container. If an immediate/daily/retry run overlaps the documented pre-upgrade command, the processes can overwrite each other's state and race the same temporary-file rename, potentially terminating a worker or publishing another attempt's success/failure state. It also breaks the documented one-backup-worker resource assumption. Stop and drain the scheduled backup before invoking the one-off operation and document its safe resumption, or add shared cross-process ownership plus a state protocol that cannot clobber another worker. Update the failure-check harness's one-off usage consistently. A focused concurrency/ordering regression is appropriate; another full build or rehearsal is unnecessary solely for this issue.

- **P9-I02 — Do not swallow rehearsal fixture cleanup failures.** `tests/fixtures/production-probe.mjs:202`–`204` turns a failed `DELETE FROM "user"` into success with `.catch(() => {})`. If this deletion fails after the assertions have passed, the probe can exit zero, allowing `scripts/rehearse.mjs` to write its verified receipt and report a passed rehearsal while the synthetic admin remains in the database. This contradicts the verification/runbook claim that the probe removes its fixtures and hides an actionable failure. Preserve generic/redacted diagnostics, but propagate cleanup failure to a nonzero exit while still closing all connections; verify absence of the owned fixture when cleanup succeeds. Add a focused cleanup-failure regression. This does not assert that cleanup failed during the reported successful run; it identifies an uncovered false-success path in the shipped verifier.

### Minor

- None requiring a separate finding. Retained cold dependency/debconf warnings and the stopped host lint attempt are explicitly historical infrastructure attempts, with final lint reported clean; they are not relabeled as passing tests.

## Checks and review limits

- Reviewed `c4b069d2a58447446fcdaa01bcb46732e49926ef..9d808d6951f14421fce65f723ed4a987909a012c` through the supplied 94,778-byte diff package. Read the diff sequentially; recovered only the deployment-document segment omitted by tool-output truncation. No changed product file was separately reread, and no Git command was run.
- Read the exact task brief, task/global binding constraints, local execution/handoff context, reviewer method, and final implementer report. The handoff's early manual-UI-open note is superseded as instructed.
- Named outside-diff check: **new hourly scheduling might fail to drain existing bounded cleanup or lose cross-process locking**. Inspected `src/server/db/maintenance.mjs:5`; it acquires the session advisory lock, drains batches until empty, and releases in `finally`.
- Named outside-diff check: **scheduled backups might bypass invariants previously enforced by the CLI**. Compared the integration with `scripts/backup.mjs:18` and the validation/key-separation anchors in `scripts/backup-lib.mjs:190`; the scheduler retains external path validation and library destination/retention/key-separation checks. This did not re-review unchanged restore internals.
- Named outside-diff check: **new initialization/operator entry routing might bypass migration guards or runtime grants**. Inspected `scripts/db.mjs:56` and `src/server/db/roles.mjs:7`; initialization uses the existing role/migration/grant APIs and the routed migration command retains grant application. The common security logic remains in those existing helpers; no separate duplication finding is warranted for the small orchestration wrapper.
- Consulted authoritative specification section 8 only (`docs/specs/IMPLEMENTATION_DESIGN_SPEC.md:407`–`426`) to confirm the template-versus-launch and observability boundaries. No broad codebase crawl, helpers, product edits, runtime mutations, tests, builds, or rehearsal reruns were performed. The only write is this requested review report.

## Assessment

**Task quality: Needs fixes.** P9-I01 is a real two-process ownership/state race reachable through the shipped upgrade instructions. P9-I02 permits a false successful rehearsal receipt after fixture cleanup fails. The deployment architecture otherwise matches the scoped requirements and presents production launch prerequisites honestly.
