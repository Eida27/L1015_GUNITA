# Accepted architecture decisions

Status: accepted by the approved [design specification](../specs/IMPLEMENTATION_DESIGN_SPEC.md). This inventory records the rationale; implementation proceeds in plan order. Acceptance of an architecture does not mean its later phase is implemented.

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

## Foundation details

- Local development publishes PostgreSQL only to `127.0.0.1:55435` for the host-run application and tools. Docker's `database` network remains internal. A separate `host-access` bridge contains only the DB and enables host port publishing: an internal-only attachment produced an empty published-port map on Docker Desktop and made the host app's readiness check fail. This development bridge permits DB egress; it is an explicit local-only exception to production isolation, never a production Compose template.
- Mailpit is bound only to loopback (`1028` SMTP, `8028` web). Its stored mail is ephemeral in Phase 0. Caddy is an optional local HTTP profile on loopback `8088`; HTTPS production configuration is later work.
- Native Node 24.19.0 LTS and pnpm 11.25.0 are pinned. TypeScript 6.0.3 is chosen because current ESLint TypeScript parser supports `<6.1.0`; installing the registry's TypeScript 7 default would violate that peer contract.
- The registry marks ESLint 9 as end-of-support. It is retained as a compatible tooling baseline because Next's bundled React/import/accessibility plugins reject ESLint 10 in their peer ranges. Upgrade this pin when those peer contracts support 10; this is an explicit tooling limitation, not a claim that the toolchain has no deprecations.
- `/api/health` is process liveness, not database readiness. `/api/ready` checks PostgreSQL separately and returns a generic 503 on failure. Both are uncached and disclose no configuration.
- Production startup validates configuration before loading the generated standalone server. An explicit `LOCAL_PREVIEW=true` permits production-binary smoke tests only on a loopback origin and loopback bind; it is not a production-launch mode.
- No GitHub remote exists. GitHub Actions is deferred until GitHub use is selected; all present checks are reproducible locally without CI secrets.
- Plain CSS tokens keep the foundation small and accessible. Reusable theme/localization controls belong to Phase 3, so the foundation only follows the OS color scheme.

## Version inventory

Queried from the npm registry on 2026-10-19. Installed dependencies are exact in `package.json` and transitive dependencies are integrity-bound in `pnpm-lock.yaml`. Reserved later-phase pins below are verified candidates; install and review APIs before those phases.

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
| Better Auth / @better-auth/drizzle-adapter | 1.7.11           | Reserved for auth/schema                                                |
| Drizzle ORM / Kit                          | 0.45.4 / 0.31.11 | Reserved for schema                                                     |
| MapLibre GL JS                             | 6.15.0           | Reserved for map                                                        |
| h3-js                                      | 4.5.0            | Reserved for location privacy                                           |

Docker manifests were inspected using `docker buildx imagetools inspect`; Compose pins immutable SHA-256 index digests. The selected PostGIS image actually contains PostgreSQL 17.5 and PostGIS 3.5; Mailpit is 1.31.6. PostgreSQL 17.5 is an old patch baseline: review and replace the image with a supported patched release during security hardening before any production use. These local-only image pins establish reproducibility, not patch-currency certification. Digests, not mutable tags, define the image contents.

References checked: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Vitest configuration](https://vitest.dev/config/), [Playwright configuration](https://playwright.dev/docs/test-configuration), [Better Auth installation](https://better-auth.com/docs/installation), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
