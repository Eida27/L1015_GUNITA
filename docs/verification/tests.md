# Test commands and execution register

Use Node 24 (current bundled host 24.22.1, Docker 24.19.0), pnpm 11.25.0 and healthy local PostGIS/Mailpit. `pnpm db:prepare` generates private bootstrap/migration settings. Fixtures create/migrate/seed random `gunita_test_<hex>` DBs/roles and drop only their owned resources; main/retained/unknown DBs are preserved. There is no reset/truncate-main step. Real geographic and DB tests are resource-heavy; use one job at a time on the N5030/8 GB host.

```powershell
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
$env:FORCE_COLOR='0'
$env:NODE_OPTIONS='--max-old-space-size=1536'
pnpm test --maxWorkers=1 --reporter=verbose
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm format:check
pnpm backup:verify
```

`vitest.config.ts` keeps one worker and isolation; six named multi-SMTP lifecycle budgets are 15 seconds, ordinary default 5 seconds and intentional 30 second races remain. Run the whole auth file because its lifecycle cases share setup state. No production timing/SMTP contract was changed to obtain a pass. `GUNITA_AUTH_TIMING` is opt-in/default-silent.

| Area / test files                                 | Meaningful behavior                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/auth.test.ts`                  | Real Better Auth/Mailpit, hostile fields, verify/reset/delete, current sessions/state, deterministic reset/login/delete lock races, durable abuse and no credential logs            |
| `database.test.mjs`, `report-category.test.ts`    | Empty schema/migration/checksum/catalog rollback, runtime permissions, immutable identity/expiry, quotas/deletion/isolation, geometry, retention/cascades/category legacy refusal   |
| `map.test.ts`, `scalability.test.ts`              | Real PH land/H3/seams/tiny islands, coarse-only storage, bounded 10 k/10.5 k count conservation/filter/plans, no unbounded export                                                   |
| `thoughts.test.ts`, `interactions.test.ts`        | Consent/verified writes, grapheme/safety, immutable edits, quotas, cleanup lock; reaction toggles/count privacy/bookmarks/21+pagination/live expiry                                 |
| `moderation.test.ts`, `moderation-review.test.ts` | Actual Siteverify/replay/spent-secret/durable rates; admin authorization/mutations/audit failure; recovery after reports vanish, nullable links, controlled stale-cursor/lock races |
| `backup.test.ts`                                  | Actual dump/encrypt/tamper/restore/cleanup/quarantine/retention/post-snapshot deletion limitation and partial-write cleanup                                                         |
| `mvp-acceptance.test.ts`                          | Literal 280 emoji/281/no-effect, same-pseudonym two posts, actual day 29 edit, quota 4/two-contender fifth race after deletion and forbidden author discovery                       |
| `tests/unit/*`                                    | Setup/startup redaction, streaming JSON, catalogs/SSR/output schemas/security headers/logs/readiness TCP stall, crypto/paths, actual scheduler/state and cleanup subprocess exits   |

For browser tests install pinned Chromium once, build once, then use the guarded disposable standalone harness. Port 3000 must be free; map fixtures use 3002, and retained manual preview uses 3001. Stop only a verified owned listener; do not kill unknown processes. The harness refuses occupied ports and never resets the main DB.

```powershell
pnpm exec playwright install chromium
pnpm build
$env:GUNITA_STANDALONE_TEST='disposable-only'
pnpm test:e2e:standalone tests/e2e/quality.spec.ts tests/e2e/scalability.spec.ts
```

Pass other named `tests/e2e/*.spec.ts` files for focused/full E2 E. `pnpm test:e2e` uses the normal Playwright config/dev server unless an existing configured origin is available. Do not execute against valuable accounts; use the disposable harness for mutation journeys. Browser manual acceptance is separate.

| Executed command / environment                                                                                                                      | Actual retained outcome                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 8 host 24.19: `pnpm test --reporter=verbose`                                                                                                  | 154/154, 27 files, 283.38 s,exit 0. Predates four scoped additions; not full 158. [Details](phase-8.md).                                                                                                                              |
| Phase 8: `pnpm test tests/unit/backup-paths.test.mjs tests/unit/backup.test.mjs tests/integration/backup.test.ts --reporter=verbose`                | 5/5, 3 files, 74.18 s,exit 0; actual Windows case/junction and real restore. History label 2/2 and partial-write 2/2 are distinct earlier scoped receipts.                                                                            |
| Phase 8: guarded standalone quality+scalability command above                                                                                       | 5/5, 5.8 min,exit 0;44 axe scans/zero violations, 8 incomplete contrast contexts, HTTP 30 samples.                                                                                                                                    |
| Phase 8: remaining 11 E2 E files via same guarded launcher                                                                                          | 36 passed/1 failed/4 notrun, 5.9 min,exit 1. Failed stale localized label selector; only failed+unrun+diagnostic rerun 6/6, 2.5 min,exit 0. All 46 original cases have distributed coverage; no single unfiltered passing E2 E claim. |
| Phase 8: `GUNITA_STANDALONE_TEST=disposable-only pnpm test:e2e:standalone tests/e2e/moderation.spec.ts:284 --max-failures=1`                        | Final-label artifact 1/1, 1.1 min,exit 0. Original label-build shell exit lost; fresh sanitizer 0 is separate.                                                                                                                        |
| Phase 9 host 24.22.1: `node node_modules/vitest/vitest.mjs run tests/unit/operations.test.mjs tests/unit/rehearsal-cleanup.test.mjs --maxWorkers=1` | Final 10/10, 2 files, 2.82 s,exit 0; meaningful RED 4 failed/4 passed before fixes. Initial broader Phase 9 focused 21/21, 9 files, 25.38 s is separate.                                                                              |
| Phase 9 Docker 24.19.0: `node scripts/rehearse.mjs config`, `build`, `start`, `verify`                                                              | Corrected actual Compose/build/start/verified-CA TLS/admin/backup/quarantine/maintenance/topology exit 0. Failures and image digests in [Phase 9](phase-9.md).                                                                        |
| Phase 9: `node tests/fixtures/production-failure-check.mjs`                                                                                         | Corrected actual failure/recovery/retry/restart/redaction exit 0. Scoped fix checked ownership and cleanup without a duplicate full rehearsal.                                                                                        |
| Phase 9: context-audit Docker target + `node tests/fixtures/production-artifact-check.mjs`                                                          | Real context 155 files,web 1808/operator 19895 files,zero private data,exit 0. Full-source Linux ESLint 0; scoped fixes Linux ESLint 0.                                                                                               |
| Phase 10 current full gate                                                                                                                          | Exact final command/reporter/environment are in [phase-10.md](phase-10.md), separate from every earlier result above.                                                                                                                 |

Inspect [phase reports 0–10](phase-10.md), [review verdicts](reviews/README.md) and [Browser receipt](phase-8-browser-receipt.md) for failed/interrupted historical runs, including original Phase 6/7 auth timeouts. Do not turn a filtered/skipped/interrupted/lost-exit run into a pass. Current requirements are local feature evaluation; actual offsite/provider/CDN/load/legal obligations are [launch gates](../operations/launch-checklist.md).

The consolidated [final-fix record](final-fix.md) supersedes the pre-fix current-source claim with new receipts. `tests/integration/final-fix.test.ts` covers coherent stale drafts, controlled same-version writers, private snapshot guards, and complete chronological actionable/history traversal with tied microsecond timestamps. `tests/e2e/final-fix.spec.ts` covers stale public representations, real concurrent API saves while the browser draft stays open, localized conflict/reload/retry, status selection, pagination/reset and mobile fit. Existing thought lifecycle E2 E remains required for cancel/focus/viewer regressions.

Final accepted source `e4eb30ab1424fcb4f36fc27aad2f7ed02ecfad37` passed179/179 tests across33files in322.02s,exit0; current build `xhHN262DfbgFrmsztvRMV` exited0. Current EN/Fil scenarios passed within2pass/1fail, then unchanged-artifact queue-only1/1 passed57.3s/exit0. These are distinct reporters, not a single clean3/3 or10/10. The one [scoped re-review](reviews/final-rereview.md) and [controller disposition](final-disposition.md) accepted both findings closed. [Full commands/failures/results](final-fix-report.md), [Browser first/final artifact attribution](final-browser-receipt.md) and [post-approval cleanup/preservation](final-owned-rehearsal-cleanup.json) remain durable. No full test/build/lint/E2E was rerun for later prose curation.
