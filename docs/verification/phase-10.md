# Phase 10 — final handoff and MVP acceptance

Base `5ab8f2ae96303261cad2d7a96d4c445a951f3f25`, branch `implementation/local-first`. Phase 10 integrates the operator handoff and all 32 local acceptance IDs; no product behavior/schema/role/dependency changes. Controller-approved phases 0–9 precede this task. **Fresh Phase 10 task review and broad whole-branch review are pending**, to be appended by the controller in the [review index](reviews/README.md). No integration target/main branch is assumed; no merge/push/PR/deployment occurred.

## Delivered handoff

- Replaced stale Phase 1 README with current boot/evaluation/maintenance/testing instructions and safe `.env.example` operator references.
- Added [architecture](../architecture.md), [migrations/seed](../operations/database.md), [moderation](../operations/moderation.md), [retention](../operations/retention.md), [tests/command register](tests.md), [release notes](../RELEASE_NOTES.md), [32-row evidence matrix](acceptance-matrix.md). Existing [backup/restore](../operations/backups.md), [deployment](../operations/deployment.md) and [launch checklist](../operations/launch-checklist.md) remain authoritative runbooks.
- Curated [all nine exact rulings](rulings.md), with original reasons/costs and ADR/runbook pointers; refreshed ADR inventory/current phase dispositions.
- Preserved all original phase 0–9 task/scoped review reports and actual verdict/fix chain in [reviews](reviews/README.md), plus [Browser ledger](browser-acceptance.md), [final 7/8 receipt](phase-8-browser-receipt.md), safe authenticated cache JSON and five inspected real [UI PNGs](ui/README.md). No replacement mocks, private email/settings/config/token captures.
- Moved useful accidentally tracked Phase 0 scratch report into [phase-0.md](phase-0.md). Only its index entry is removed from scratch; local scratch file/workspace remain for controller use. No ignored secret/scratch force-added.

## Actual final test gate

Environment: Windows 10.0.19045, Intel Pentium Silver N5030/4 logical CPUs/~8 GB RAM, bundled host **Node 24.22.1**, pnpm 11.25.0, Vitest 5.0.5, real Docker PostgreSQL 17.11/PostGIS 3.6.4. One worker, `NODE_OPTIONS=--max-old-space-size=1536`, inherited `NO_COLOR` removed, `FORCE_COLOR=0`, auth timing unset. Docker image/build evidence remains Node 24.19.0; environments are not conflated.

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=verbose
```

Actual final reporter: **32 files passed; 174 tests passed; 397.37 s; exit 0**, started 10:33:16 on 2026-10-28. [Complete safe reporter](phase-10-full-suite.txt); original private `.local/phase-10-full-suite.log` and `.exit` retained. This is the single controller-required final current full suite after Phase 9 fixes/new acceptance cases, not a repeat to tidy the older 154 receipt. No build/E2 E/image-audit repeat.

Five new real-DB/API acceptance cases in `tests/integration/mvp-acceptance.test.ts` prove:

1. Actual 201 for 279 ASCII plus one joined-family emoji; 281→422 with no content/quota effect; same permanent pseudonym across two posts and no private DTO keys.
2. Guest thought/reaction/bookmark 401 and live-session unverified 403; outside-PH create 422; all content/interaction/quota counts unchanged.
3. An actual 29-day-old thought PATCH 200 keeps exact original identity/coarse location/creation/day-30 expiry, using the normal SQL trigger and current auth.
4. Four API creations including later deletion, then two concurrent fifth contenders yield exactly 201+429, quota 5/live 4.
5. Author query 422 with no identity response, absent profile/user service routes 404 and private userId list query 422.

These cases use actual Better Auth/scrypt/session/guards and least-privilege PostGIS writes in one new random owned DB; mail transport alone is stubbed because no email delivery claim belongs to these cases. Actual SMTP/Mailpit/reset/revocation remain in the full auth suite. Established fixture teardown removes only the newly owned DB/roles.

First focused command `node node_modules/vitest/vitest.mjs run tests/integration/mvp-acceptance.test.ts --maxWorkers=1 --reporter=verbose` yielded 4 pass / 1 fail, 84.16 s, exit 1: the author-query test expected 404 but received 422. Source inspection confirmed the pre-existing explicit `url.search` INVALID_INPUT guard. The approved requirement forbids query modes rather than mandating 404, so the oracle now asserts 422 for author queries and 404 for absent profile/user routes. No product change. All five passed in the final unfiltered gate; the failed attempt is retained as a test-expectation error, not feature RED/TDD implementation proof.

## Attribution and retained limits

Read [tests](tests.md), [Phase 8](phase-8.md), [Phase 9](phase-9.md) and [release notes](../RELEASE_NOTES.md) for exact historical commands/results. Full 154 plus four scoped cases, 46 distributed E2 E/extra diagnostic/final-label case, 44 axe/8 incomplete visual follow-up, 10,560-thought/30-sample HTTP, lost old build exit versus fresh Docker 0, 21 initial Phase 9 focused/10 repair checks and one moderate advisory remain distinct. Historical failed/interrupted auth/E2 E/build/setup attempts are not erased. No screenshot or test presence alone closes a matrix row.

Local boot/evaluation has executed proof: Phase 0 literal fresh clone; current isolated production initialization of 87 areas/zero demo accounts/thoughts and verified private ready/TLS; normal restored native Browser share/roles at later phases. Static seeds create no users. Owner-created fictional accounts are sufficient; no preexisting public users/cloud provider/domain is needed. See [current check addendum](#current-document-and-preservation-checks) below.

Real production providers/offsite persistence/remote retention/external alerts/legal/native-language/geography/load/DNS/TLS/Cloudflare/cache/host log disposal remain [launch gates](../operations/launch-checklist.md). Daily/hourly configuration and retry/restart are not a 24-hour soak. Final whole-branch approval remains pending.

## Current document and preservation checks

Executed final checks:

| Command / check                                                  | Actual outcome                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host Node24.22.1 `node node_modules/typescript/bin/tsc --noEmit` | Exit0, no diagnostics. The earlier pause-lost managed session is not counted; current explicit `.local/phase-10-typecheck.*` supplies the result.                                                                                                                                                                                                                                                                                                 |
| Pinned Linux scoped ESLint                                       | Exit0, empty log. `docker run --rm --network none -e NODE_OPTIONS=--max-old-space-size=1536` with real `eslint.config.mjs`, `src`, `tests` mounted read-only; `gunita-checks:phase9 node node_modules/eslint/bin/eslint.js tests/integration/mvp-acceptance.test.ts --max-warnings 0`. No secrets, disabled rules or stub source. First missing-src-mount attempt exited0 with a Next pages-context diagnostic and remains a noisy setup attempt. |
| `node node_modules/prettier/bin/prettier.cjs --check .`          | Exit0, all matched files use Prettier style. Final addenda are checked after formatting.                                                                                                                                                                                                                                                                                                                                                          |
| `node .local/phase-10-doc-check.mjs`                             | Exact32 matrix rows/scenarios/expectations match brief; exact9 ruling lines match ledger;151 local links resolve;38 package commands exist;5 inspected screenshots match original bytes; staged private-path/settings/browser-email/credential scan PASS; errors[]. Final receipt is also retained privately.                                                                                                                                     |
| Product/authority preservation diff                              | `git diff HEAD -- src scripts infra compose.yaml compose.prod.yml compose.staging.yml Dockerfile package.json pnpm-lock.yaml docs/specs docs/plans` empty. New test and docs only; scratch report remains on disk/ignored after index removal.                                                                                                                                                                                                    |
| `git diff --cached --check`                                      | Exit0 after removing the copied reporter's extra EOF blank line; no substantive reporter output changed.                                                                                                                                                                                                                                                                                                                                          |

After the app pause, the first read-only probe found native listeners unavailable and Docker pipe absent; [unavailable receipt](phase-10-preservation-unavailable.json) is retained without inferring a source defect. The controller resumed the original runtime owner for normal same-resource restoration. Fresh [read-only receipt](phase-10-preservation.json),2026-10-28T03:35:17.057Z:

- Native3000/3001 readiness200, minimal `{status:'ok'}`, `Cache-Control:no-store`.
- Original DB `bef039778816`/Mailpit `8aff39410feb` running/healthy; same `gunita_pgdata`.
- Main3users/0thoughts/87areas/7migrations; only retained `gunita_test_7919223391409efc` and unknown `gunita_test_e7153586855c485a`, with their existing four roles. No additional test DB/role remains from the final suite.
- Retained original body/creation/expiry match exactly and status published. No credential, consent, body or timestamp change by Phase10; unknown DB content was not opened or changed.

These are live read-only observations, separate from retained manual Browser acceptance. No new UI gate,24hour soak or public-provider operation is inferred. Self-review found no remaining local implementation blocker; root task/broad reviews remain pending.

Automatic approval review rejected one bulk PowerShell here-string documentation write as “blocked by policy,” with no specific reason. It changed no files. Narrow individual `apply_patch` edits succeeded; that rejected command was not retried.

Automatic approval review twice rejected deletion of inactive Phase 0 clone `C:/Users/anula/AppData/Local/Temp/gunita-phase0-proof-6eeef800` as “blocked by policy.” Its services/networks/volume were removed in Phase 0; directory remains untouched. No equivalent cleanup was retried.
