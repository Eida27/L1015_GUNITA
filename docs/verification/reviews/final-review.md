# Gunita final whole-branch review

Review date: 2026-10-28. This is the single broad final review, continued across session pauses rather than restarted. No helper or additional reviewer participated.

**Technical verdict: Ready to merge — With fixes.** Address FBR-I01 and FBR-I02, then perform the authorized scoped verification and rereview. The local-first architecture is substantially complete and carefully defended, but silent edit loss and the report queue's discovery behavior are material correctness gaps. This verdict grants no deployment, public launch, branch integration, or cleanup authority.

## Scope and authority

- Repository: `C:/endless_refinement/mvp_projects/L1015_GUNITA`.
- BASE: `b4532bd29a1f2841919c1ab535168ccc95e6a452`, the initial approved specification/plan commit.
- HEAD: `8a64198eafe176dbe19a4307a5b20e2e489834b6`, observed unchanged with an empty tracked/untracked status before writing this ignored report.
- Reviewed the supplied 5,707,575-byte, 21-commit package `.superpowers/sdd/IMPLEMENTATION_PLAN-plans/review-b4532bd..8a64198.diff`. Did not regenerate the Git diff.
- Applied the approved implementation specification and plan, `review-global-constraints.md`, `final-review-context.md`, and the nine recorded decisions in `docs/verification/rulings.md`. Applied the Superpowers code-reviewer requirement to judge reasonable behavior as well as literal plan compliance.
- `implementation/local-first` has no main/master/remote integration target. “Ready to merge” here is only a technical assessment.

## Strengths

1. **Privacy is enforced across layers.** Strict public DTOs exclude account identifiers, private reaction totals, and submitted exact coordinates. Coarsening precedes persistence; the original point is not carried into storage or logs. Public reading is separated from private viewer state, confidential responses are not cached, and the warning/content gate prevents authored content from appearing in server-rendered pages before acknowledgment. Client lifecycle handling invalidates private state on visibility/focus transitions and rejects stale asynchronous responses.
2. **Authentication and database authorization are unusually thorough.** Mutations recheck current session/account state under the account lock rather than relying on stale browser state. Verification, suspension, reset revocation, and account deletion have real database coverage. Runtime, migrator, and operator privileges are separated; migration integrity and transactional execution are checked. Public pseudonyms are permanent and generated server-side without exposing account IDs.
3. **Retention and publication limits have real concurrency defenses.** The rolling creation ledger survives thought deletion, uses database serialization, and rejects unsupported transaction isolation. Public and private readers enforce expiry independently of cleanup. Cleanup is bounded, locked, and drainable; cascade/unlink behavior avoids retaining deleted thought content in related records or audit text.
4. **The spatial implementation respects the approved privacy tradeoff.** Frozen land geometry, deterministic coarsening, interior-point selection, escalation/fallback, bounded map aggregation, weighted clustering, and terminal member pagination are coherent. The UI uses manual location selection and does not request GPS. Provenance and the limitations of approximate places are documented honestly.
5. **Operational work is substantive.** The standalone launcher validates configuration before importing the server; the image runs without root and uses separate operator capabilities. Backups authenticate encrypted archives before restore, keep keys outside the checkout/archive paths, and quarantine restored databases until expiry/session cleanup and reconciliation. Maintenance failure, retry, shutdown, lock ownership, and unhealthy states are covered rather than assuming scheduled work always succeeds.
6. **The evidence distinguishes execution from assertion.** Real database concurrency and provider-boundary tests coexist with deliberately mocked failure paths. Historical failures, interrupted commands, distributed browser coverage, and incomplete axe contrast checks remain visible. The current full test receipt is separate from earlier partial/focused runs. The current acceptance matrix, review index, preservation record, and launch gates make the result reviewable without relying only on chat history.

## Issues

### Critical

None identified within the reviewed local-first scope.

### Important

#### FBR-I01 — Stale edits silently overwrite newer saved text

- **Severity:** Important / P2.
- **Primary location:** `src/server/thoughts/service.ts:228–238`, especially line 230.
- **Supporting locations:** `src/server/thoughts/service.ts:201–208`; `src/components/thoughts/thought-detail.tsx:238–250`; `docs/specs/IMPLEMENTATION_DESIGN_SPEC.md:339`.
- **Observed behavior:** The write locks the current thought and checks its author, but does not compare any client revision or precondition. The client sends both its draft body and emotion. There is no stale-edit error path or revision check. The approved error contract explicitly calls for a 409 on a stale edit.
- **Concrete effect:** Two sessions can open the same thought. The first saves a revised body. The second, still holding its older draft, changes only the emotion and saves. Its request resubmits the older body, overwrites the first save, and receives a success receipt. The account/row locks serialize these writes but cannot tell that the second draft was based on an obsolete version. This is ordinary concurrent editing, not a malicious-client scenario, and it loses authored text without warning.
- **Required fix:** Add an optimistic edit precondition tied to the version actually loaded for editing, and compare it atomically under the existing lock before changing the row. An opaque ETag/If-Match or equivalent private edit-version mechanism can preserve the approved body fields and public identity/privacy contracts. Map a mismatch to the specified safe 409 response; retain the user's draft and offer an understandable reload/reconcile path. Do not merely refresh immediately before saving, because that would accept a newer version while still submitting an older draft.
- **Focused verification:** Have two independent edit snapshots of one real database row. Save the first; submit the second and require 409, with the first body/emotion and immutable publication fields unchanged. Cover the browser conflict message/draft preservation and a subsequent edit based on the refreshed version. Existing sequential edit, ownership, and quota tests do not establish this property.

#### FBR-I02 — New actionable reports are buried among resolved reports in random order

- **Severity:** Important / P2.
- **Primary location:** `src/server/moderation/reports.ts:105–107`.
- **Supporting locations:** `src/server/db/migrations/0002_domain.sql:110–117`; `src/components/moderation/admin-view.tsx:297–308`, `:394–431`; `docs/specs/IMPLEMENTATION_DESIGN_SPEC.md:102`.
- **Observed behavior:** The report listing includes all statuses and orders/pages solely by report UUID. Those IDs are generated with `gen_random_uuid()`, so they do not encode report age. The console offers Next page, Back to first page, and Refresh, but no actionable-status filter or time order. Resolving a report leaves it in the same queue position while the underlying thought remains unexpired.
- **Concrete effect:** Once a moderator has processed a page of reports, a newly submitted open report with a lower UUID can appear behind that page of resolved reports. Refresh continues to show the same resolved page. As retained reports accumulate, discovering new work requires paging through the entire retained collection repeatedly; the first page neither identifies outstanding work nor shows the newest reports. This undermines the ordinary purpose of the manual moderation queue even though every record is technically reachable. This finding does not require automatic hiding, report-volume decisions, or a new notification system.
- **Required fix:** Provide an actionable view that surfaces open/reviewing reports without resolved entries obscuring them, and use a meaningful deterministic chronological order with a stable tie-breaker and matching keyset cursor. Preserve an explicit way to inspect resolved reports where needed. Choose and document the queue direction/status behavior; keep audit-on-inspection, fresh admin checks, and expiry handling intact.
- **Focused verification:** Seed more than one page of resolved reports plus open/reviewing reports whose UUID order conflicts with creation order. Verify actionable reports are discoverable in the intended view, cursor traversal is complete and stable, and resolving a report updates that view appropriately. Include the console status/view control and existing access-audit expectations.

### Minor

No separate minor finding. The previously deferred minor rollup is not being reopened without a concrete residual defect.

## Recommendations for the single fix wave

Treat the two findings as bounded changes to existing contracts. Add the specific failing cases above, preserve the current privacy and authorization boundaries, and update the acceptance/error-contract documentation where necessary. The scoped rereview should inspect the resulting precondition/409 path and queue cursor/status behavior together with their relevant tests; it need not repeat this entire broad review. Follow the controller's existing final validation policy rather than representing this read-only review as a new test pass.

Keep the currently disclosed dependency and deployment limitations visible. The retained moderate development-tool advisory is not grounds for silently loosening pins, changing the approved stack, or claiming a clean current vulnerability audit. The measured local map latency is useful evidence but has limited margin at the world view; retain the real-load launch gate.

## Coverage and checks

### Source and test reading

Read the supplied package in bounded sequential passes through its end at approximately line 35,727. This included all functional scripts, application pages/API routes, client components, server services, SQL migrations/roles/seed and privacy queries, styles, configuration, E2E suites, fixtures, integration tests, and unit tests. Functional source was complete through approximately line 24,975; E2E and remaining tests/configuration were then completed through package end. Recovered the genuinely truncated locale and Browser-ledger segments. Findings were checked against current files for exact line references; no defect is inferred from an unread implementation.

Read the full approved specification/plan/rulings and current Phase 10 report, full-suite receipt, preservation record, tests command register, acceptance matrix, Phase 9 report, Browser ledger, and Phase 8 Browser receipt. Read the architecture/ADR/operator/backup/retention/deployment/launch documents and geographical provenance material. Historical review coverage was the review index and targeted prior-finding/closure inspection, not a claim to have reread every original historical report and every Phase 0–8 paragraph. Prior task approval informed context and did not override cross-cutting defects.

Outside the diff, read the relevant installed Next 16.4.2 error-boundary documentation to resolve the `retry` API question: the current code uses the documented API. Also made targeted current-file reads for the two findings and read-only Git status/HEAD/ignore checks. No test, build, migration, backup, restore, browser acceptance run, DB query, service change, provider call, or cleanup was performed by this reviewer.

### Generated assets and lockfile

- Did not flood the review with raw geographical coordinate lines. Instead, inspected provenance, schema/feature identity, bounds, coordinate validity, hashes, consuming code, and tests. The PH FeatureCollection contains 87 unique areas and 79,716 coordinate pairs; the world FeatureCollection contains 177 features and 10,654 pairs. Both contain Polygon/MultiPolygon geometry; the scan found no non-finite/out-of-range coordinate pairs. This is not an independent geographical/topological or population-density certification.
- PH asset: 3,140,454 bytes; SHA-256 `fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189`.
- World asset: 838,726 bytes; SHA-256 `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.
- These match the documented frozen provenance. Read the land/privacy consumers and fallback behavior; did not reinterpret historical administrative names as current legal boundary guarantees.
- Lockfile: 225,640 bytes; SHA-256 `ffe925d59a914069ff38a65bc94c23aa4f5e98002fbb7569826989cd964d9bba`. Inspected the importer pins and dependency metadata; 659 integrity entries, no custom tarball/local/Git dependency reference identified. A read-only indentation-aware structural scan found 659 package records, 659 snapshots, and 1,276 dependency/optional-dependency links, with no snapshot missing its package or link missing its target. This validates graph references, not package code, install-script safety, or current upstream advisories. The first optional YAML-parser lookup was unavailable; the successful scan used a self-contained reader and installed nothing.
- The final text-only structural utility used the shell's Node 26.4.0; it was not an application compatibility test and does not replace the recorded Node 24 test/build evidence.
- Did not re-inspect all five binary PNGs visually; their actual curation was task-reviewed and the current receipts/hash checks were inspected. No concrete image concern justified repeating that work.

### Evidence accepted with its actual limits

- Current unfiltered suite: **174/174 tests, 32 files, 397.37 seconds, exit 0**. This review read the receipt; it did not rerun the suite. Current recorded TypeScript, corrected scoped Linux lint, formatting, and documentation checks passed. The earlier lint command without the mounted source is retained as inadequate evidence, not relabeled a clean check.
- Earlier 154-test full run and later focused additions are distinct from the final 174-test run. Original E2E coverage is distributed 5 + 36 + 5; the initial failure/unrun cases and recovery are preserved. No claim of a single clean full E2E execution is made.
- Forty-four axe scans recorded zero violations but eight contrast-incomplete occurrences; manual visual follow-up is not numeric contrast certification.
- Warm HTTP measurements for 10,560 thoughts on the recorded N5030/8 GB machine show p95 world 739.93 ms, PH 493.62 ms, metro 188.12 ms, emotion 342.42 ms. These are local samples, not an operational SLA or proof for all artificial dense arrangements/future scale.
- The old label-build shell exit was lost. The later real Phase 9 Docker build/TypeScript exit 0 is separate positive evidence, not a reconstruction of the old exit.
- Phase 9 documents real isolated Docker staging, private DB/web networking, loopback Caddy with request-scoped CA validation, nonroot execution, actual encrypted backup/tamper/quarantined restore and runtime CONNECT denial, expiry/session cleanup, maintenance locking, and failure/recovery/retry/restart/redaction. The two subsequent operator findings have scoped closure and are included in current full-suite coverage.
- Retained artifact scans and preservation records cover the reported context/image sets and identified main/manual resources. This reviewer did not inspect or mutate the unknown database, reuse the blocked Phase 0 cleanup path, or perform broad resource cleanup.

## Declined to judge

These are explicit scope/authority limits, not silently waived implementation defects:

- **Public deployment and real-provider readiness:** real domain/VPS/DNS/TLS/Cloudflare/origin restrictions, SMTP/Turnstile/tile credentials, and public exposure require separately authorized launch work. Reviewed the local safeguards and documented gates, not a nonexistent live deployment.
- **Genuine remote backup operations and host-wide retention/alerting:** offsite transfer/key recovery/remote seven-day retention, external alerts, and host journald enforcement need the eventual operator environment. Local encrypted restore and scheduler evidence do not establish those properties.
- **Twenty-four-hour soak, Internet load, and capacity guarantees:** immediate/daily/hourly scheduling plus retry/restart receipts are not a continuous soak or production load test. No additional heavy work was authorized for this review.
- **Legal, clinical/crisis-resource, native-language, and real-world geographic/privacy certification:** reviewed honest wording, localization structure, provenance, and technical safeguards; authoritative Philippines launch review, resource validation, demographic adequacy, and legal compliance remain explicit launch gates.
- **Knowledge of deletions/moderation after a backup snapshot:** a snapshot cannot contain later events. The approved quarantined-restore/reconciliation requirement is the boundary; did not demand an unapproved cross-snapshot deletion service or call quarantine a completed public restoration.
- **Fresh external dependency security audit:** assessed the pinned graph and retained one-moderate/zero-high-or-critical result, not today's upstream vulnerability state or every dependency's internals. No external rescan or dependency change was performed.
- **Integration and cleanup decisions:** no authorized target branch exists, and the inactive Phase 0 clone cleanup was explicitly blocked. Neither technical approval nor this report authorizes merging, public launch, or equivalent cleanup retries.

## Assessment

**Ready to merge? With fixes — FBR-I01 and FBR-I02 remain open.** The implementation broadly follows the approved local-first plan and has strong privacy, transactional, retention, operational, and test foundations. The two bounded workflow defects should be corrected and receive the one authorized scoped rereview before the final technical gate is considered approved.
