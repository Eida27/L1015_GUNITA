# Accepted architecture decisions

Status: accepted by the approved [design specification](../specs/IMPLEMENTATION_DESIGN_SPEC.md). All Tasks 0–10 are complete and controller-approved. The single broad review found two Important issues; one fix wave and one scoped re-review closed both at source `e4eb30a`, with no new findings. The phase boundaries below describe original ownership. See [current architecture](../architecture.md), [ten exact rulings with reasons/costs](../verification/rulings.md), and [evidence](../verification/phase-10.md). Accepted architecture and local proof do not authorize public launch.

| ADR | Decision and rationale                                                                                                                                                                  | Implementation boundary                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 001 | A Next.js App Router monolith keeps UI, server permissions, and deployment together. Node runtime supports PostGIS and future background jobs without a separate API service.           | Foundation in Phase 0.                                                  |
| 002 | Self-hosted PostgreSQL/PostGIS provides transactional constraints and indexed land geometry. Drizzle owns explicit migrations; custom SQL handles spatial work. No Supabase dependency. | Schema, least privilege runtime role, migration ownership in Phase 1.   |
| 003 | Better Auth owns passwords, sessions, verification and reset tokens. Use its supported Drizzle adapter, rather than implement authentication cryptography.                              | Auth in Phase 2; generate schema against exact installed version first. |
| 004 | A permanent account pseudonym provides continuity without public email/account IDs. Cross-post correlation remains possible; no public profiles or author lookup.                       | Profile/auth phases.                                                    |
| 005 | Provider-switchable MapLibre keeps tiles portable. Server aggregation bounds dense queries; client clustering handles display. Production tile permission remains an operational gate.  | Map phase.                                                              |
| 006 | Server H3 cells plus versioned Philippines land geometry minimize location precision before persistence. Original picked coordinates never enter durable storage or logs.               | Geometry and map phases; no rectangle substitute.                       |
| 007 | Immutable 30-day expiry enforces immediate read invisibility independently of hourly deletion. Encrypted seven-day backups require isolated cleanup on restore.                         | Lifecycle and operations phases.                                        |
| 008 | Immediate publication with narrowly targeted prevention avoids blanket suppression of distress. Guest reports feed human moderation; report volume cannot automatically remove content. | Moderation phase.                                                       |
| 009 | Reaction totals belong only to the author/authorized moderator. Separate private uncached APIs prevent public DTO/cache leakage.                                                        | Interaction phase.                                                      |
| 010 | Compose enables paid-service-free local development and later portable VPS packaging. Production provisioning, TLS, providers and public launch require their own gates.                | Local services now; production packaging later.                         |

Additional accepted decisions: [ADR011: database integrity/least privilege](011-database-integrity.md), [ADR012: early spatial refresh](012-postgis-baseline-refresh.md), [ADR013: account lifecycle/locks](013-account-lifecycle.md), [ADR014: coarse map locations](014-coarse-map-locations.md), [ADR015: moderation/verification/category](015-moderation-and-verification.md). Ruling9's narrowly validated internal-container preview is documented in [deployment](../operations/deployment.md); it preserves the existing local auth/Turnstile contract.

## Foundation details

- Local development publishes PostgreSQL only to `127.0.0.1:55435` for the host-run application and tools. Docker's `database` network remains internal. A separate `host-access` bridge contains only the DB and enables host port publishing: an internal-only attachment produced an empty published-port map on Docker Desktop and made the host app's readiness check fail. This development bridge permits DB egress; it is an explicit local-only exception to production isolation, never a production Compose template.
- Mailpit binds loopback (`1028` SMTP, `8028` web), with ephemeral local mail. Optional development Caddy uses HTTP8088. Phase9 supplies a separate production HTTPS template and verified loopback TLS rehearsal; actual public TLS remains a launch gate.
- Native Node 24.19.0 LTS and pnpm 11.25.0 are pinned. TypeScript 6.0.3 is chosen because current ESLint TypeScript parser supports `<6.1.0`; installing the registry's TypeScript 7 default would violate that peer contract.
- The registry marks ESLint 9 as end-of-support. It is retained as a compatible tooling baseline because Next's bundled React/import/accessibility plugins reject ESLint 10 in their peer ranges. Upgrade this pin when those peer contracts support 10; this is an explicit tooling limitation, not a claim that the toolchain has no deprecations.
- `/api/health` is process liveness, not database readiness. `/api/ready` checks PostgreSQL separately and returns a generic 503 on failure. Both are uncached and disclose no configuration.
- Production startup validates before generated-server import. `LOCAL_PREVIEW=true` permits a loopback origin/bind. Only explicit validated `CONTAINER_PREVIEW=true` with preview+proxy permits an internal container listener for the isolated loopback-Caddy rehearsal; no web/DB host ports. Neither is public-launch validation.
- No GitHub remote exists. GitHub Actions is deferred until GitHub use is selected; all present checks are reproducible locally without CI secrets.
- Plain CSS tokens and reusable EN/Fil/light/dark/system controls now implement the shell. The earlier foundation's OS-only behavior is historical.

## Version inventory

Original registry inventory:2026-10-19. Installed pins are exact in `package.json` and lockfile. MapLibre/H3 below were subsequently installed and verified in Phase4; the table retains original pin provenance.

| Package                                    | Version          | State                                                                   |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------- |
| Next.js / eslint-config-next               | 16.4.2           | Installed                                                               |
| React / React DOM                          | 19.3.1           | Installed                                                               |
| Zod                                        | 4.6.7            | Installed                                                               |
| node-postgres                              | 8.23.1           | Installed for readiness                                                 |
| TypeScript                                 | 6.0.3            | Installed                                                               |
| ESLint                                     | 9.39.5           | Installed; Next's transitive React/import/a11y plugins require ESLint 9 |
| Prettier                                   | 3.9.10           | Installed                                                               |
| Vitest / Vite                              | 5.0.5 / 8.3.4    | Installed                                                               |
| Playwright                                 | 1.64.1           | Installed                                                               |
| @types/node                                | 24.19.2          | Installed; aligns with Node 24                                          |
| @types/react / react-dom                   | 19.3.0           | Installed                                                               |
| Better Auth / @better-auth/drizzle-adapter | 1.7.11           | Installed Phase 1; auth CLI also pinned 1.7.11                          |
| Drizzle ORM / Kit                          | 0.45.4 / 0.31.11 | Installed Phase 1                                                       |
| MapLibre GL JS                             | 6.15.0           | Installed Phase4                                                        |
| h3-js                                      | 4.5.0            | Installed Phase4                                                        |

Docker manifests were inspected using `docker buildx imagetools inspect`; Compose pins immutable SHA-256 index digests. Phase 1 replaced the retired Phase 0 PostgreSQL 17.5/PostGIS 3.5.2 image with verified PostgreSQL 17.11/PostGIS 3.6.4; see [ADR 012](012-postgis-baseline-refresh.md) for backup, restore, extension/collation upgrade and current digest evidence. Mailpit remains 1.31.6. These local pins establish reproducibility, not production vulnerability certification.

References checked: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Vitest configuration](https://vitest.dev/config/), [Playwright configuration](https://playwright.dev/docs/test-configuration), [Better Auth installation](https://better-auth.com/docs/installation), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).

- [ADR 016: edit concurrency and report discovery](016-edit-concurrency-and-report-discovery.md) — loaded-snapshot preconditions and Ruling 10 actionable queue; scoped final review approved at source `e4eb30a`.
