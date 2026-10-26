# Phase8 quality evidence

Status: implemented; fresh review and final manual Browser acceptance pending. Local-only; actual offsite credentials and deployment remain blocked. The final inspection-label correction is awaiting its rebuilt artifact and affected history check; earlier artifact results below are preserved explicitly.

HSTS trust handoff: headers use validated server `APP_ORIGIN`, not client `Forwarded`/`X-Forwarded-Proto`. An HTTPS production origin behind the later TLS-terminating proxy receives HSTS even when the internal Next listener uses HTTP. Local HTTP preview does not. Phase9 must configure and validate that topology; this phase adds no general forwarded-header trust framework.

## Changes

- Strict map and private-account output allowlists, generic malformed-output errors, private/no-store boundaries.
- Nonce CSP on dynamic Next rendering, production HTTPS-only HSTS, existing secure-cookie/origin/DB-abuse controls retained. MapLibre requires inline style attributes; production script CSP does not allow unsafe-eval. Explicit HTTPS map resource origins are server configuration.
- Content-free JSON request group/status/duration/correlation logs; no request URLs, querystrings, bodies, user identifiers, email, cookies or coordinates. Dedicated readiness client with total1500ms deadline and closed stalled socket.
- Localized moderation history with EN/Fil action/reason/subject/status and Asia/Manila timestamp; real21+private pagination regression.
- Guarded10500thought synthetic dataset and query/HTTP benchmark harness, role/theme/language accessibility harness using pinned axe.
- Authenticated encrypted backup and quarantined isolated restore, documented in [backup runbook](../operations/backups.md).

## Focused evidence before consolidated gate

All commands use bundled Node24.19/pnpm11.25, one worker, FORCE_COLOR0 and no NO_COLOR. Private raw logs are under `.local/phase-8-*`; they are deliberately excluded from Git.

| Check                                        | Actual result                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth unchanged-budget timing diagnostic      | 19passed/6failed/147.66s exit1; first reset case5023ms with initial request4004ms. Later overlapping unfinished lifecycle failures are not independent defect evidence. Historical timeout causes remain unproven.                          |
| Approved six multi-SMTP lifecycle budgets15s | 25/25,114.60s exit0; default5s and intentional30s concurrency unchanged; no production SMTP change. Timing opt-in/defaultsilent, bounded Mailpit fetch.                                                                                     |
| Established readiness wire stall             | RED deadline missed; GREEN1/1,1585ms test/2.68s run, exit0; actual query observed and socket closed.                                                                                                                                        |
| Security/map/log/crypto boundaries           | RED4fail1pass; GREEN5/5,3.01s exit0.                                                                                                                                                                                                        |
| Private account malformed output             | RED200 versus500; GREEN1/1,6.93s exit0.                                                                                                                                                                                                     |
| Private21+pages plus10500query scale         | 9/9 across2files,56.76s exit0. Earlier5fail5pass was missing helper and new fixture/collation oracle failure with cascading fixture pollution; fixed test setup, no pagination production change.                                           |
| Real backup workflow plus crypto             | 2/2 across2files,24.60s exit0; real workflow16944ms. Earlier ACL/module-path and synthetic privacy-cell failures retained as failed attempts; earlier combined backup/history reporter1pass1fail was a history attribute-case oracle error. |
| Typecheck                                    | `pnpm typecheck` exit0; final build still pending.                                                                                                                                                                                          |

## Performance interpretation

Dataset:10500 clearly fictional current thoughts,2100authors,87Philippine geographic areas, privacy tiers5/6/7 (urban/rural/island), three emotion groups. Real coarse-location transform; no precise coordinates persisted. SQL indexes and normal publication/quota triggers remain enabled. Each query has30timed samples, deterministic aggregation, count conservation, <=1000features; selective metro plan uses `thoughts_public_point_gist`.

Host: Intel Pentium Silver N5030@1.10GHz,4logical CPUs,8384393216bytes RAM, Windows10.0.19045, PostgreSQL17.11/PostGIS3.6.4. These direct-query durations from the consolidated run exclude HTTP/Next/network work; [full plans and machine record](phase-8-query-plans.json) are retained:

| Query       | p50ms |  p95ms | Features | Thoughts |
| ----------- | ----: | -----: | -------: | -------: |
| World       | 54.24 |  79.90 |        3 |    10500 |
| Philippines | 55.17 | 103.44 |       68 |    10500 |
| Metro       |  7.19 |   7.95 |        4 |      484 |
| Hope filter | 29.35 |  37.05 |       25 |     3500 |

Actual warmed standalone HTTP and cold readiness/first request are measured separately after the final build. The750ms API goal is not claimed from SQL timings and is not a production SLA.

## Open gates

Controller fresh review, remaining actual Browser/device acceptance and final history-label artifact check remain pending. Earlier phases are not restarted; Phase7's final-source build/manual gate carries here. Browser access worked for partial guest checks, then returned disabled after a session pause; no manual pass is inferred from automation.

## Consolidated results and exact coverage

- `pnpm test --reporter=verbose`: **154/154 across27files,283.38s,exit0**; auth timing environment unset. This complete receipt predates two added focused regressions (partial archive write and inspection labeling). Expected content-free map log emissions were present; subsequent test capture assertions pass3/3,21.92s,exit0.
- `pnpm build`: **exit0**, compilation75s/TypeScript44s, single worker, standalone sanitization completed. Dynamic root rendering supplies nonce CSP. This artifact predates the final generic inspection-label change; its rebuild is recorded separately.
- Standalone E2E uses `GUNITA_STANDALONE_TEST=disposable-only pnpm test:e2e:standalone <files>` through the guarded launcher and a fresh3000database. New quality/scalability files: **5/5,5.8min,exit0**. Remaining11files: **36passed/1failed/4notrun,5.9min,exit1**, a stale raw `delete_thought` selector against correctly localized `Delete thought`. Captured DOM retained the required unavailable subject. Only the failed moderation case, four unrun thought-lifecycle cases and additional contrast diagnostic were run next: **6/6,2.5min,exit0**. All46original E2E cases therefore have distributed pre-label-artifact coverage, plus one diagnostic; this is not a claim of one unfiltered passing E2E run.
- Backup partial-write regression: **RED1failed/1skipped,8.26s,exit1** (actual leftover file); exclusive filename reservation plus owned-file cleanup; **GREEN whole backup file2/2,23.43s,exit0**, including actual dump/restore. No plaintext file is created.
- Generic inspection label for account/report subjects in both languages: **RED1failed/1passed,3.40s,exit1; GREEN2/2,3.21s,exit0**. No auth/database contract changed.
- Full-tree ESLint and typecheck passed before the final scoped additions; final changed-source checks are recorded in the completion addendum.

The first suite plus focused regressions are retained rather than repeating expensive passing checks for tidy output. Detailed commands/failure receipts remain in the task report and private logs.

## Actual HTTP performance and accessibility

[HTTP benchmark](phase-8-http-benchmark.json):10560current thoughts (10500scale plus60map fixtures),30warmed loopback HTTP samples after one warmup per query, real standalone routes including output validation/logging/DB limiter. World p50/p95 **412.45/739.93ms**, Philippines **226.18/493.62ms**, metro **107.82/188.12ms**, emotion **157.21/342.42ms**. All met750ms in this run; the world case has little headroom. Cold readiness **4714.35ms** and first empty-map request **308.12ms** are separate startup measurements. These are host-specific measurements, not an SLA.

[Axe results](phase-8-accessibility.json):44scans covering EN/Fil, light/dark, guest/warning/map/thought/help, member/author/private lists, unverified/suspended, moderator and deleted-account screens: **zero reported violations**. Five viewport widths320/375/768/1024/1440 passed automated horizontal-overflow checks. Eight incomplete contrast occurrences are not automatic passes. [Exact diagnostic nodes](phase-8-accessibility-diagnostics.json) are `#warning-description > p:nth-child(1)` (background overlap) and `.maplibregl-ctrl-attrib-inner` (contains image), once in each language/theme. Controller manual review remains separate.

## Dependency and artifact audit

`pnpm audit --json` **exit1**, [retained report](phase-8-dependency-audit.json): **0critical/0high/1moderate**. The moderate finding is esbuild0.18.20 via Better Auth → drizzle-kit → esm-loader/core-utils (also auth CLI and direct drizzle-kit paths). [The maintainer advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) concerns esbuild's development `serve` feature and permissive CORS. This repository launches Next, contains no esbuildserve call, and the current standalone package walk found no esbuild package. This bounds observed exposure; it does not erase the advisory or claim zero vulnerabilities. Reassess on dependency/tooling updates; do not expose that development server.

Generated standalone/static scan:2075files, **0private env files/0runtime or operator credential matches**; root settings preserved. A separate2059text/log scan found **0private fixture values/0exact-coordinate canaries/0env files**. Runtime role verified nonsuperuser/noCREATEDB/noCREATEROLE/no public schemaCREATE. Secret values are compared in memory and never printed or committed.

Existing origin rate guard is `src/server/geo/limits.ts`: durable atomic shared **600/min pins+members,120/minpreview**, invoked before expensive producer work by all three routes. The120/121boundary is in the complete map integration run. Client-specific trusted-proxy/CDN differentiation remains a Phase9 deployment gate; spoofed address headers never grant separate buckets.

## Threat review

| Surface                    | Source review and regression boundary                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS                        | Thought bodies are React text; no user HTML/Markdown renderer, `dangerouslySetInnerHTML`, DOM HTML assignment or analytics SDK in `src`. CSP nonce replaces caller-supplied nonce/CSP before rendering. Actual hydrated standalone compatibility remains an E2E gate.                                 |
| CSRF                       | Mutations enforce exact configured Origin, JSON content type and bounded bodies; Better Auth SameSite cookies and current transactional guards remain. Foreign Origin is exercised in auth/thought/interaction/moderation tests.                                                                      |
| IDOR/current authorization | Account-first locks through commit, sorted multi-account moderation locks, fresh role/verification/suspension checks and owner-only totals. Public DTOs contain neither account identifiers nor reaction totals. Integration tests race resets, deletion, moderation and publication.                 |
| Enumeration                | Duplicate/unknown registration, resend and reset receipts stay generic; SMTP preflight covers all relevant address states. DB-backed counters ignore spoofed forwarded addresses. Test-only timings never change production protocol.                                                                 |
| Cache and metadata         | Private reads and errors use no-store; public thought responses are no-store. Share SSR/RSC/OG/Twitter metadata are constant and never fetch authored bodies; warning gate prevents content before acknowledgement. Existing E2E covers sharing/removal/reload and Browser evidence remains separate. |
| Exact coordinates          | Real PH land validation and immutable coarse representative occur server-side. Output allowlists expose safe points/labels only. No GPS access, submitted-point storage or request-body logging; deterministic tiny-island/boundary fixtures remain required.                                         |
| Expiry and deletion        | Shared publication predicate excludes expired/hidden/deleted records immediately. Hard deletion cascades related data and clears audit subject linkage. Integration coverage spans map, detail, private lists, bookmarks, admin detail and restore; backup snapshots cannot know later deletions.     |
| Quota races                | Durable DB counters/publication ledger and transactional serialization remain unchanged. Deleting content does not replenish the rolling publication allowance.                                                                                                                                       |
| Proxy and TLS              | Client forwarding headers do not establish identity/trust. HSTS uses configured HTTPS origin; production trust topology is a Phase9 deployment gate.                                                                                                                                                  |
| Turnstile                  | Actual Siteverify is still called in explicit local test mode. Production rejects test credentials/local wrappers; malformed, unavailable, wrong-host/action/age and replay fail closed. No browser CAPTCHA solving or production bypass added.                                                       |
| Backup                     | Full GCM authentication precedes import; private separate key, bounded buffers, quarantine by effective CONNECT denial, expiry/session cleanup and explicit reconciliation. See runbook for limits and daily/offsite launch gates.                                                                    |
| Logs/errors                | Fixed route groups, random request IDs, status and duration only. Generic HTTP errors suppress DB/provider text. Readiness catches DB failure and closes stalled client; operator pg tool stderr is suppressed.                                                                                       |

A source review is not a penetration-test certification. Dependency/advisory, generated-artifact and final runtime checks are recorded with their actual results below when complete.

Final source lint: identical full-tree ESLint rules/arguments with direct file descriptors completed **exit0**, no warnings/errors. PowerShell redirected attempt stalled and was stopped only after verifying its owned PID; it is not counted as a pass. Staged47files private-path/secret scan and `git diff --cached --check` passed. Current full-source build and scoped history result follow after the label change; prior results above remain attributed to their actual source state.
