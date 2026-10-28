### Spec Compliance

- ❌ Issues found: the backup path guards do not fully enforce the promised external-checkout and separate-key boundaries (`scripts/backup.mjs:15`, `scripts/backup.mjs:28`, `scripts/backup-lib.mjs:209`). See P8-I01. Otherwise, the task-scoped implementation matches the requested quality, security, performance, localization, and isolated recovery scope.
- Reviewed BASE `8f92126bd678046dc4f0f0e55db14109356efafb` to HEAD `e1ec3f8af1d591e5d30ea3358c115e8011054cb5`, using the supplied review package. Subsequent uncommitted moderation-test strengthening is outside this verdict.
- Scope checks: role/language/theme accessibility journeys and five-width overflow checks are implemented in `tests/e2e/quality.spec.ts:121`; 10,500 synthetic thoughts and guarded fixture ownership in `tests/fixtures/scale-database.mjs:3`; HTTP latency measurement in `tests/e2e/scalability.spec.ts:39`; query plans/index verification in `tests/integration/scalability.test.ts:19`; threat review in `docs/verification/phase-8.md:75`; operational backup/restore instructions in `docs/operations/backups.md:5`. No unrelated product feature was introduced.

### Strengths

- Archive authentication is completed before connecting to the operator database or creating any restore database (`scripts/backup-lib.mjs:267`). The database starts with connections disabled, effective runtime CONNECT privileges are checked before enabling operator access, and the restore stays quarantined after expiry/session/token cleanup (`scripts/backup-lib.mjs:270`, `scripts/backup-lib.mjs:278`, `scripts/backup-lib.mjs:299`). The explicit post-snapshot reconciliation requirement accurately avoids promising deletion knowledge absent from a snapshot (`docs/operations/backups.md:22`).
- Backup integration exercises real dump/encryption/restore, bad-key and tampering rejection, actual runtime connection denial, retention, and a deliberately later-deleted record that remains only in quarantine (`tests/integration/backup.test.ts:96`). Partial-write cleanup reserves its filename exclusively before acquiring cleanup authority (`scripts/backup-lib.mjs:216`); its added regression has a retained failing and passing receipt (`docs/verification/phase-8.md:52`).
- CSP overwrites caller-supplied nonce/CSP headers, supplies the same policy to rendering and response, and forces dynamic rendering (`src/proxy.ts:15`, `src/app/layout.tsx:16`). This follows the installed Next 16.4.2 guide's request-header nonce and dynamic-rendering contract. Production scripts omit unsafe-eval; configured map origins reject non-origin/injection values; HSTS is tied to the configured HTTPS origin (`src/server/security/headers.ts:12`).
- Strict runtime map schemas reject unknown fields and malformed output before serialization, with count conservation and bounded feature/member lists (`src/lib/map-contract.ts:34`, `src/app/api/map/pins/route.ts:15`, `src/app/api/map/members/route.ts:15`). The private account DTO keeps its private/no-store boundary (`src/server/auth/service.ts:174`).
- Readiness now has a total deadline and disposes the stalled connection; the regression uses an actual TCP peer that completes authentication and then stalls the query (`src/server/db/readiness.mjs:3`, `tests/unit/readiness.test.mjs:8`). Request logging accepts neither a Request nor arbitrary error text and emits only fixed route groups, generated IDs, status, and elapsed time (`src/server/security/request-log.ts:4`).
- Performance evidence distinguishes direct SQL from standalone HTTP and cold startup, retains the machine/query plans, and explicitly calls out the world request's narrow margin below 750ms (`docs/verification/phase-8.md:30`, `docs/verification/phase-8.md:61`). Inspection history is localized with an explicit Manila timezone and preserves nullable references (`src/components/moderation/audit-entry.tsx:42`).

### Issues

#### Critical (Must Fix)

- None found in this task-scoped diff.

#### Important (Should Fix)

- **P8-I01 — Canonicalize and correctly compare backup containment boundaries.** `scripts/backup.mjs:15` and `scripts/backup.mjs:28` use a case-sensitive textual `startsWith(root + separator)` test. A destination exactly equal to the checkout root passes; Windows case variants and directory junctions can also identify paths inside the checkout while passing this test. Separately, `scripts/backup-lib.mjs:208-210` classifies any relative name beginning with `..` as outside: a key at `<destination>/..backup.key` therefore passes even though it is inside the archive directory. This contradicts the runbook's mandatory external key/archive locations and separate recovery key (`docs/operations/backups.md:7-9`), and can place a key in a directory copied offsite or tracked with source. Resolve existing parent directories/canonical paths, account for Windows path comparison, reject equality, and distinguish the parent segment `..`/`..` plus a separator from filenames merely starting with two dots. Add focused boundary tests for equal-root destinations, in-destination `..backup.key`, Windows case variants, and an existing linked parent. This is a configuration safety defect, not a claim of a remotely exploitable endpoint or an observed credential leak.

#### Minor (Nice to Have)

- None required for this review.

### Cannot Verify / Remaining Acceptance

- **Final changed-label artifact:** `docs/verification/phase-8.md:3` and `docs/verification/phase-8.md:94` explicitly leave the rebuilt artifact and affected history check pending. The label unit regression passes, but I have not received completed final-artifact receipts. The controller should attach the actual rebuild/history result when available; the older build and unaffected E2E results remain attributable to their earlier source state.
- **Actual manual Browser/device acceptance:** `.superpowers/sdd/IMPLEMENTATION_PLAN/phase-8-browser-receipt.md:3` records partial guest/warning/map/thought checks. Member/private-list/admin/report-widget/reversible moderation acceptance and the remaining attribution/device checks are still open after an actual Browser-disabled denial, including after the user's re-enable message. Automated journeys cannot close this gate. Eight axe contrast-incomplete occurrences are disclosed, with partial visual follow-up rather than an all-eight numeric contrast claim (`docs/verification/phase-8.md:63`).
- **Full-suite attribution:** the actual complete reporter is 154/154 in 27 files, not 156/156. I inspected that receipt and the subsequent whole backup-file 2/2 and history-label 2/2 scoped receipts. The two added cases have separate RED/GREEN evidence; no additional unfiltered run is inferred or requested merely to tidy the record (`docs/verification/phase-8.md:49-56`). Expected content-free map log noise in the original suite was subsequently captured/asserted by its scoped tests; it is not being silently relabeled pristine historical output.
- **E2E attribution:** retain the original 36 passed / 1 failed / 4 not run result. Together with the first five quality/performance cases and recovery's five original cases, all 46 original cases have distributed pre-label-artifact coverage; recovery also adds one contrast diagnostic. I inspected the recovery reporter's 6/6 result. This is not one clean unfiltered E2E run (`docs/verification/phase-8.md:51`).
- **Cross-task security invariants:** unchanged auth/CSRF/IDOR/expiry/cache/Turnstile implementations and all previous-phase acceptance cannot be independently established from this task diff. Their threat-review matrix and earlier suite receipts are evidence to retain, not a substitute for the controller's remaining manual gate (`docs/verification/phase-8.md:75`). No broad whole-branch certification is given here.
- **Deployment-only operations:** actual offsite credentials, daily scheduling, production TLS/proxy topology, final provider configuration, and deployment log retention remain deployment gates (`docs/operations/backups.md:8-11`, `docs/verification/phase-8.md:5`). The local simulated destination does not prove an actual offsite mount. The retained dependency audit records zero high/critical and one moderate advisory; it does not support a zero-advisory claim (`docs/verification/phase-8-dependency-audit.json:31`).

### Review Checks and Boundaries

- Read the task brief, implementation report, global constraints, review context, relevant authoritative specification sections, supplied diff, durable JSON evidence, installed Next CSP guide, and partial Browser receipt. No suite, build, or database operation was rerun.
- Named unchanged-producer risk: the new strict map schemas could reject formerly valid group IDs/cursors/counts. One focused check of `src/server/geo/pins.ts:54`, `src/server/geo/pins.ts:81`, and `src/server/geo/pins.ts:116` confirmed its 31-by-31 bin limit, discriminated output shapes, 20-member cap, and public-ID cursor grammar match the new schemas. No broader producer crawl was performed.
- The initial diff command was interrupted across the session pause and another result was output-truncated. Only undelivered/truncated segments were recovered from the same supplied package; no changed source file was separately reread and no Git diff was regenerated. Repetitive query-plan JSON was also inspected through its retained query labels, timings, plan node types, and selective index name.
- Product source, index, HEAD, databases, and runtime state were left unchanged. This report is the only reviewer-written file.

### Assessment

**Task quality: Needs fixes.**

**Counts:** 0 Critical, 1 Important, 0 Minor. Implementation is otherwise cohesive and backed by meaningful boundary and integration evidence. Correct the backup path safety guard with focused regression evidence, then preserve the separately open final-artifact and manual acceptance gates before claiming Phase 8 completion.
