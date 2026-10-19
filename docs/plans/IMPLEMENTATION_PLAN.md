# Gunita — Codex Implementation Plan

**Status:** Ready for local-first execution  
**Date:** 2026-10-19  
**Source of truth:** [IMPLEMENTATION_DESIGN_SPEC.md](../specs/IMPLEMENTATION_DESIGN_SPEC.md)
**Execution style:** Small, reviewable, tested vertical slices; no assumptions requiring a domain, VPS, or paid services.

## 1. Operating instructions for Codex

1. **Read the full design specification before editing code.** Treat the accepted discovery decisions and security invariants as binding; the implementation plan controls sequencing, not product changes.
2. Inspect existing repository files, tool versions, and scripts. If repository is empty, initialize it. Pin compatible **stable** versions of Next.js, Better Auth, MapLibre, Drizzle, PostgreSQL/PostGIS image, Docker, and test libraries; commit lockfile. Do not hard-code guessed API signatures.
3. Execute phases in order. At the end of each phase run relevant lint, typecheck, migration, tests, and a manual smoke test. Commit only logically coherent changes. Prefer a working vertical slice over broad unfinished scaffolding.
4. Use only environment placeholders and official Turnstile test keys in development. Never require a production domain, real SMTP, or a VPS to complete local phases.
5. Enforce permissions and data minimization **on the server**. A hidden button or client-only route guard is not security. Public DTOs must never include user IDs, email, reaction counts, precise submitted coordinates, or private bookmarks.
6. When ambiguity arises, choose the smallest accessible/privacy-preserving behavior that honors the spec; document design decisions in `docs/adr/`. **Never** silently change anonymous identity, 30-day expiry, or author-only totals.
7. End each phase with a brief report: changed files, commands/tests run, measured outcomes, pending issues, and whether the phase's exit gate passed. If a gate fails, fix it before moving to the next phase.
8. Keep the MVP scope tight: no DMs, comments, public user pages, keyword search, GPS, media upload, analytics profiling, realtime sockets, or billing.

## 2. Definition of done (global)

A requirement is done only when its UI, server-side behavior, DB integrity, authorization, error handling, mobile/accessibility handling, and automated tests are present. A temporary mock is acceptable only if explicitly labeled development-only and not represented as production functionality.

**Mandatory CI checks:** `lint`, `typecheck`, unit/integration tests, seeded PostgreSQL/PostGIS tests, end-to-end tests, production build, and a security regression suite. Local feature tests should run with documented one-command setup and tear-down.

## 3. Phase-by-phase delivery

### Phase 0 — Repository audit and technical baselines

**Objective:** Establish reproducible versions and a working environment before feature work.

Tasks:
- Inspect repo and identify existing code; do not overwrite useful project files.
- Choose `pnpm` with committed lockfile, Node LTS compatible with pinned Next.js. Set TypeScript strict mode, ESLint, Prettier, path aliases, conventional scripts, `.env.example`, `.gitignore`, README.
- Add `docs/adr/` with rationale for Next.js monolith, PostgreSQL/PostGIS, Better Auth, MapLibre, coordinate coarsening, and local-first deploy.
- Scaffold App Router structure, API health route, shared error response type, Zod utilities, and test harness (Vitest or equivalent + Playwright).
- Bootstrap Compose services: PostGIS on private network, Mailpit for dev email, optional Caddy reverse proxy profile; document local ports and volume names.
- Add GitHub Actions checks if using GitHub; no secrets required for PR checks.

**Exit gate:** Fresh clone followed by documented commands runs app, database, mail catcher, and tests. `pnpm build`, lint, and typecheck succeed. No secrets committed.

### Phase 1 — Database, boundaries, and domain schema

**Objective:** Implement durable, indexed data while respecting location minimization and 30-day expiry.

Tasks:
- Integrate Drizzle + PostgreSQL/PostGIS. Write explicit, versioned schema migrations and rollback/backup notes; do not use destructive auto-sync in prod.
- Install/pin Better Auth schema migration with user/account/session/verification tables; custom `profiles` table with unique permanent pseudonyms, roles/status.
- Implement `user_consents` (versioned guideline acceptance), `thoughts`, `reactions`, `bookmarks`, `reports`, `admin_audit`, quota creation-event ledger, and rate-limit TTL rows from spec. Add FK cascades, unique constraints, GiST, expiration and author indexes.
- Import documented, license-compliant Philippines land/admin boundaries into PostGIS with source attribution, checksum and version; validate SRID, geometry validity, islands and coastline.
- Seed coarse privacy-zone tiers and emotion/reaction enums. No fictional thoughts in production seeds.
- Implement soft gate queries (`status=published AND expires_at > now()`) and hard cleanup transaction, including expired dependent rows.

**Tests:** Migration up/down where possible; foreign key/unique enforcement; expired data never returned; cascade deletion; polygon tests incl. islands/coastlines and out-of-PH coordinates; DB explain plans.

**Exit gate:** Empty database initializes repeatably; all schema integrity tests pass; no original-pin `lat/lng` column exists.

### Phase 2 — Authentication and account lifecycle

**Objective:** Secure, private, email-verified accounts with permanent pseudonyms.

Tasks:
- Configure Better Auth email/password with Drizzle adapter, memory-hard password hashing, verification required for member actions, safe session cookies, password reset with session revocation.
- Create provider-neutral email sender and Mailpit templates for verification, resend and password reset. Protect against email enumeration and credential stuffing.
- Generate unique random account pseudonym server-side; guarantee immutability and atomic profile creation. Ensure client cannot choose account role/name/pseudonym via signup payload.
- Build `/sign-up`, `/log-in`, verification, forgot/reset, logout; graceful expired-token and delivery-failure states; no OAuth.
- Implement reusable server guards `requireAuthenticated`, `requireVerifiedMember`, `requireAdmin`, `requireOwner`, and suspended-account check.
- Account settings page with email and pseudonym; implement verified delete-account flow and session revocation. Protect password reset and email-change flows with account revalidation.

**Tests:** Guest/verified/unverified/suspended/other-user matrices; malicious `role=admin` signup ignored; unique pseudonym collision retry; expired verification/reset links; other sessions revoked after reset/deletion; password never logged.

**Exit gate:** User can sign up, inspect local verification email, verify, sign in/out, reset password and delete account; no unverified protected mutation works via direct API calls.

### Phase 3 — Design system, warning, accessibility, and localization

**Objective:** A polished calm shell usable on mobile and in two languages.

Tasks:
- Build warm peaceful visual tokens, accessible type/spacing/color, light and dark themes honoring system by default; visible theme toggle.
- Add `en` and `fil` catalogs and locale selection with persisted preference; no auto-translation of thought text.
- Implement blocking first-visit 18+ / disturbing-content warning with required checkbox and versioned acknowledgment. Respect cleared storage and new warning version. Gate public map and shared-thought content consistently.
- Add legal/guidelines/help pages with reviewed **draft placeholders** clearly marked for legal/crisis-resource verification before public launch.
- Implement skeleton/error/empty-state patterns and shared mobile dialog/bottom-sheet primitives.

**Tests:** No map user-generated content before acknowledgment; checkbox mandatory; accessibility keyboard/focus checks; theme/locale persistence; 320px no overflow; reduced motion; both locales complete.

**Exit gate:** Functional shell works on mobile and desktop without external credentials; accessible first-visit flow and locale switcher.

### Phase 4 — Map rendering and precise-location protection

**Objective:** World-view map with PH-only manual posting and no stored exact coordinates.

Tasks:
- Integrate MapLibre with configurable style/tile URL and correct provider/OSM attribution. Provide a no-key, permitted development/demo style or explicit local fixture so local MVP evaluation works; production must use a separately authorized tile provider (not an assumed unlimited public OSM tile service).
- Initial world zoom/center, button to focus on Philippines, intuitive pan/zoom, mobile gestures, loading/retry/offline fallback.
- Implement drop-pin picker (no geolocation permission prompt). Client preview clearly states marker will be approximated.
- Build **server-only** helper `coarsenPhilippinesPoint(lat,lng)` validating point-in-polygon, density tier (urban res7, intermediate res6, sparse/island res5), H3 cell, safe inland representative point and province-level label. No raw coordinates persisted or logged; never fetch browser GPS.
- Persist coarse `public_point`, `privacy_cell`, `privacy_tier`, version and label only. Build geospatial query service with viewport filtering and page limits.
- Implement map `/api/map/pins`, server aggregation in dense/worldwide views and MapLibre client clusters at zoom. Clicking clusters zooms; clicking pins retrieves detail (later phase). Ensure aggregate displayed count represents thoughts, **not reaction totals**.

**Tests:** Urban/rural/island boundary fixtures; coordinate ordering; Philippines inclusion; no exact point in DB/response/log; coastline representative remains plausible; 10k-seed query does not export 10k raw points unbounded; cluster zoom.

**Exit gate:** Worldwide map renders and PH marker clustering works; outside-PH placement rejected; exact user-selected coordinates are transient only.

### Phase 5 — Publish/read/edit/delete and lifecycle

**Objective:** First complete vertical slice: verified author leaves a thought; guest reads it.

Tasks:
- Build composer with nine categories, text+emoji only, **280 grapheme clusters** (`Intl.Segmenter` with safe fallback), clear preview and privacy notice; no uploads or HTML/Markdown rendering.
- Add secure create/read/edit/delete routes; location locked after posting; immutable creation/expiration/public ID. Public response DTO includes pseudonym, category, coarse point/label, timestamps; no owner ID or reaction totals.
- Enforce 5 new thoughts per rolling 24h, including subsequently deleted thoughts; account-scoped transaction isolation/locking; 429 error feedback.
- Add lightweight obvious-violation and spam prevention without blanket blocking grief/self-harm discussion.
- Detail bottom sheet for map, public share `/thought/[publicId]`, generic unavailable state, generic non-sensitive social preview and `noindex`.
- Integrate hourly maintenance service with deploy-safe no-overlap lock; deleted/hidden/expired content always excluded from queries before job runs.
- Make newly published posts discoverable within cache refresh target ≤60s; ensure delete/hide is not served by stale detail cache.

**Tests:** Emoji/grapheme boundaries; HTML injection rendering; 5/6 posts and concurrent POST races; edit does not reset 30-day TTL; author ID secrecy; non-owner mutation denied; 30-day edge timestamp; deleted share URL unavailable; created raw coordinates absent.

**Exit gate:** Guest can read; verified account can create/manage a PH thought end-to-end; 30-day visibility and hard cleanup proven; direct API bypass attempts blocked.

### Phase 6 — Reactions, bookmarks, user dashboard

**Objective:** Private interactions without leaking social engagement counts.

Tasks:
- Implement four reaction choices (`love`,`sad`,`care`,`happy`) and a transactional one-per-user-per-thought upsert/remove flow; author self-reaction blocked.
- Public UI shows reaction types **only**, never totals. Logged-in non-author can see own selected reaction privately; author and admin get totals only through explicitly protected uncached endpoint.
- Build bookmarks with unique constraint, no self-bookmark; auto-removal via cascade after thought expiry/delete.
- Add dashboard: own active thoughts with reaction totals and expiration, bookmarked active thoughts, edit/delete actions, account settings.
- Add emotion-category filter only (no text search/feed). Apply filters consistently to map query and any accessible visible-marker listing.

**Tests:** Authorization matrix for guest, other account, author and admin. Confirm by inspecting network responses, server HTML, cache headers and public map JSON that **no non-author totals leak**. Reaction changes don't duplicate; bookmark cascade; no cross-account dashboard access.

**Exit gate:** Two test accounts and guest see distinct, correct private/public data with no cross-user leakage.

### Phase 7 — Reports, moderation, and anti-abuse

**Objective:** Safe public posting with transparent admin review and minimal data retention.

Tasks:
- Implement clear Community Guidelines acceptance before first publish (versioned acceptance saved in `user_consents` and **verified server-side** at posting time; do not prompt on subsequent posts unless revised).
- Guest/member report form, limited reasons/details, generic submission receipt, dedupe, throttling, Turnstile with **actual server-side Siteverify** in prod and official test keys in development.
- Implement basic contact-info/doxxing/threat/spam rejection with explainable rules and benign-distress fixtures. Prefer narrow false-positive thresholds.
- Admin role bootstrap CLI and guarded admin routes; reports queue; dismiss/review; post hide/unhide/delete; account suspend/unsuspend; content-free audit records.
- Configure auth endpoint rate limits, anonymous report HMAC abuse buckets, anti-automation checks and safe logging. Verify proxy-trust rules for future Cloudflare deployment.
- Provide `/help` UX and safe response messaging, with launch-blocking review of live Philippine support resources.

**Tests:** Unauthorized admin routes/API all fail, including tampered cookies/client state; reports can't be used as auto-takedown weapon; guest report rate limits/Turnstile replays fail; benign emotionally distressed text allowed; explicit doxxing rejected; audit entries omit content, email, IP.

**Exit gate:** Admin can securely review/act on abuse and actions are audited; public forms resist obvious bot/spam abuse.

### Phase 8 — Quality, scalability, security hardening, and deletion

**Objective:** Validate the entire product under realistic adversarial and failure conditions.

Tasks:
- E2E full user journeys for guest, unverified, verified member, author, moderator, suspended and deleted account. Test in EN/Fil and light/dark.
- Add 10k+ synthetic **test-only** thought dataset across urban/rural/island areas; run indexed map query benchmarks and deterministic aggregation. Document machine specs and query plans.
- Threat-review XSS, CSRF, IDOR, email enumeration, sensitive API caching, page/OG metadata, precise coordinate leakage, 30-day deletion, rate quota races, proxy headers, Turnstile fallback behavior.
- Add CSP, HSTS production-only, secure cookies, rate limits, privacy-preserving structured logs, readiness checks, error handling, no third-party analytics.
- Add database backup script (`pg_dump` to authenticated encrypted archive in **offsite** destination) and restore script to isolated environment; actual offsite credentials are a **deployment-blocked step**, while local simulation must work.
- Run accessibility audits and manual device-size smoke checks, fix major findings.
- Confirm author-deleted and expired content cannot return via map/detail/bookmarks/admin detail/cache; test restoration procedure runs cleanup before traffic.

**Tests:** No critical/high open vulnerabilities in scope; full test suite passes; `pnpm build` succeeds; encrypted backup and restore simulation verified; no secret in generated artifacts.

**Exit gate:** All security/privacy invariants hold; performance results recorded; documented backups/restores work in isolated local environment.

### Phase 9 — Portable VPS deployment package (prepare, don't purchase)

**Objective:** Produce a production-ready deployment **template** without deploying to a nonexistent domain/VPS.

Tasks:
- Multi-stage production Dockerfile using Next.js standalone mode, non-root user, Compose production template, Caddy configuration, internal DB isolation, health checks, resource guidance, volume mount ownership, safe secrets management, migration/rollback commands.
- Add Cloudflare architecture notes: DNS to VPS, proxied hostname, Full (strict) TLS, optional Tunnel, strict cache rules for authenticated routes, origin lockdown, Turnstile production hostname/action, trustworthy client-IP header handling.
- Document options for production licensed map tiles, SMTP provider, domain registration, cheap VPS sizing, and offsite backup service without committing to changing free-tier offers.
- Write launch checklist and a rehearsal script, including first admin creation and no demo thoughts in prod.
- Implement basic uptime/backup/expiry/moderation metrics with no sensitive log payloads.

**Exit gate:** `docker compose -f compose.prod.yml config` validates, production image builds and runs with **dummy local secrets** in a staging simulation, runbook explains how to deploy after selecting provider/domain. No claim of actual deployment.

### Phase 10 — Final handoff and MVP acceptance

**Objective:** Deliver a verified Codex-implementable repository and operator documentation.

Tasks:
- Produce `README.md` quick start, `.env.example`, architecture notes, migrations/seed docs, `docs/adr/`, backup/restore runbook, moderation guide, retention table, tests list and unresolved launch dependencies.
- Execute acceptance matrix below; record real command output and tested environments. Fix all blockers before calling MVP complete.
- Write release notes that distinguish **local feature-complete** from **publicly launched**.

**Exit gate:** Owner can boot and evaluate locally; core flows work with zero users beyond seeded test accounts; no cloud account, purchased domain, or VPS assumed.

---

## 4. Cross-cutting acceptance matrix

| Test ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Guest views map/shared thought after checking 18+ | Works; no login required |
| AUTH-02 | Guest POST thought/reaction/bookmark | 401, no DB effect |
| AUTH-03 | Unverified member writes | Denied server-side |
| AUTH-04 | Signup includes forged `admin` role or custom pseudonym | Ignored/rejected; member role and server-generated pseudonym |
| AUTH-05 | Reset password | Reset successful; existing sessions revoked |
| ID-01 | Two posts from same account | Same permanent pseudonym, no public account ID or profile link |
| ID-02 | Attempt to query posts by author/user ID | No endpoint or query mode; forbidden |
| MAP-01 | Place PH urban/rural/island point | Accepted; coarse point stored, not exact selected coordinate |
| MAP-02 | Pin outside PH | Rejected, no DB write |
| MAP-03 | Cluster click and responsive phone layout | Zooms and opens appropriate thought sheet |
| MAP-04 | Viewport 10k seed records | Bounded aggregated response, no silent truncation, acceptable latency |
| POST-01 | 280 grapheme characters + emoji | Accepted |
| POST-02 | 281 grapheme characters | Rejected |
| POST-03 | Post #6 within rolling 24h, even after deletion of earlier post | 429 |
| POST-04 | Concurrent request race around 5th post | Exactly one fifth succeeds; quota not bypassed |
| POST-05 | Edit at day 29 | Expiration remains original day 30 |
| POST-06 | Expired at exact time, cleanup not yet run | No map, detail, bookmark, counts access |
| POST-07 | Hard delete cleanup | Thought and dependents removed from live DB |
| REACT-01 | Guest/member/author requests counts | Only author/admin receives counts, never public DTO |
| REACT-02 | User changes love to care | One reaction row, latest type; counts updated privately |
| BOOK-01 | Expired bookmarked post | Bookmark removed/unavailable, no private archive |
| REPORT-01 | Guest submits legitimate report | Recorded with rate protection; doesn't auto-remove |
| REPORT-02 | Turnstile token missing/replayed in prod-like mode | Rejected |
| ADMIN-01 | Non-admin opens any admin API directly | 403/404, no data leak |
| ADMIN-02 | Admin hides a reported post | Removed from public access immediately, audit created |
| ADMIN-03 | Admin inspects a report | Minimal account data, no public identity reveal |
| DELETE-01 | User deletes account | Sessions revoked, authored posts and interactions deleted |
| DELETE-02 | Restore encrypted backup locally | Restore succeeds in isolation; expiry cleanup occurs before simulated re-open |
| I18N-01 | Toggle locale/theme; revisit | Preferences honored; authored text unchanged |
| SAFETY-01 | Non-graphic distress | Permitted (unless other violation) |
| SAFETY-02 | Doxxing/spam pattern | Narrow rejection with actionable error |
| CACHE-01 | Another user/guest requests author's reaction endpoint | No count leak in payload or cache |

## 5. Work allocation and dependency graph

```text
0 Foundation
    ↓
1 Database/geo ──→ 2 Auth ──→ 3 UX shell
    │                  │             │
    └──→ 4 Map/privacy ┴──────→ 5 Thoughts/expiry
                                     ↓
                                6 Interactions
                                     ↓
                                7 Moderation
                                     ↓
                                8 Security/QA
                                     ↓
                                9 Deploy template
                                     ↓
                                10 Handoff
```

Small parallel work is acceptable within a phase (for example localized UI components vs database migrations), but **do not** parallelize changes that weaken shared security/contracts. Integration tests gate merging.

## 6. Local environment inventory (placeholders only)

```dotenv
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://gunita:change-me@localhost:5432/gunita
BETTER_AUTH_SECRET=generate-locally-strong-random-secret
BETTER_AUTH_URL=http://localhost:3000
EMAIL_PROVIDER=mailpit
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=Gunita <no-reply@example.invalid>
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json # demo/development only; check usage terms
TURNSTILE_SITE_KEY=OFFICIAL_TEST_SITE_KEY
TURNSTILE_SECRET_KEY=OFFICIAL_TEST_SECRET_KEY
MAP_PRIVACY_DATA_VERSION=1
BACKUP_TARGET=REPLACE_WITH_LOCAL_SIMULATION_PATH
BACKUP_ENCRYPTION_KEY=generate-locally-and-store-safely
```

**Do not copy these into production unchanged.** Production keys, email provider/domain, map tiles, backup destination, HTTPS origin, and Cloudflare settings remain launch gates.

## 7. Production launch blockers (not obstacles to local MVP completion)

- [ ] Purchase/choose domain and VPS/provider; create appropriate service accounts.
- [ ] Set up authorized production tile source and review free tier attribution/quotas.
- [ ] Configure Cloudflare DNS/proxy and TLS (or equivalent trusted hosting protection).
- [ ] Configure verified transactional email domain and test delivery/resets in production.
- [ ] Configure real Cloudflare Turnstile credentials and verify hostname/action on server.
- [ ] Configure encrypted **offsite** DB backups, retention, monitoring and a demonstrated restore.
- [ ] Confirm Philippines boundary/license and density-zone behavior, including islands.
- [ ] Legal/privacy/terms/community policy review for Philippines; review crisis support resources.
- [ ] Audit logging redaction, cache bypass rules, rate limits, production admin bootstrap, and incident contact.
- [ ] Run load tests and confirm VPS resource budget before inviting the public.

## 8. Suggested Codex execution prompt

Copy/paste this when starting from an empty or existing Gunita repository:

> Read `IMPLEMENTATION_DESIGN_SPEC.md` and `IMPLEMENTATION_PLAN.md` entirely, audit this repository, and implement **Phase 0 only**. Do not start a subsequent phase until its exit gate has been met. Use local-only services and never require paid credentials, a public domain, or a VPS. Pin compatible stable dependencies; add reproducible setup scripts and tests. Follow all privacy/security invariants. Run lint, typecheck, test, and build; report exactly what passed, files modified, and blockers. Wait for my instruction to continue to Phase 1.

For subsequent work: **"Implement Phase N from `IMPLEMENTATION_PLAN.md` in the existing repository; run its tests and do not modify unrelated scope. Report acceptance results and unresolved blockers."**

## 9. Implementation notes / deliberate defaults

- Approved first-visit warning is **sitewide once per acknowledgment version**, not per-post blur.
- Approved age gate is **checkbox self-attestation**, not ID verification or birthdate collection.
- Approved public pseudonym remains stable; no rename/regenerate UI; no public profile or author-search.
- All post creation locations are **manual and PH-only**; public reads/world map unrestricted.
- Reaction icons are shown to everyone but totals are strictly for authors/admins; no counts in public client HTML/JSON.
- Category filter only; additional forms of discovery await a future release.
- Admin reviews reports; report volume alone never automatically removes content.
- Cloudflare Turnstile has a free plan, but fails closed for protected public forms if production verification cannot succeed. Provide a transparent retry UI and an alternative help contact for incident reporting when the challenge provider fails.
- Backups require separate storage; keeping dumps on the same VPS alone is **not** an offsite backup.
- Final MVP success means **fully tested local operation**, not public production deployment.
