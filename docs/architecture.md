# Architecture and invariant ownership

Gunita is one Next.js 16.4.2 App Router application (React 19.3.1, TypeScript 6.0.3) on Node 24, with PostgreSQL 17.11/PostGIS 3.6.4, Drizzle 0.45.4, Better Auth/adapter 1.7.11, MapLibre 6.15.0 and H3 4.5.0. Exact pins/integrities live in `package.json`/`pnpm-lock.yaml`; image digests live in Compose/Dockerfile. Plain CSS tokens and typed English/Filipino catalogs implement UI. The ten baseline decisions and ADRs 011–016 are indexed in [ADRs](adr/README.md).

```text
Browser → Caddy (future production TLS/optional Cloudflare) → Next.js Node
          public map/detail | auth | private member | admin routes
                                                   ↓
                                         PostgreSQL/PostGIS
                                                   ↑
                      separate operator/maintenance/backup/metrics jobs
Auth → SMTP adapter → Mailpit locally / verified provider before launch
DB → bounded pg_dump → authenticated encryption → separate archive/key locations
```

| Boundary             | Current authority and consequence                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-visit UGC      | `PublicContentGate` invokes an abortable stable client loader after current acknowledgment; generic SSR/RSC/metadata contain no authored content. Revocation aborts requests. APIs remain public; this is self-attestation.                                                      |
| Identity             | Better Auth owns scrypt/password/token/session mechanics. Signup DB trigger creates permanent pseudonym/member profile; hostile identity fields are stripped. No public profile/author discovery.                                                                                |
| Protected operations | Each service freshly checks session/verification/status/owner/admin in the write transaction. Account locks precede profile/session/token/thought; multiple account locks use sorted IDs.                                                                                        |
| Quota                | SQL trigger serializes account creation events at READ COMMITTED; five/rolling 24 h including deleted thoughts. Service never duplicates quota events. Other isolation levels fail closed.                                                                                       |
| Location             | Server PostGIS containment/deterministic H3 representative precede insert. Only coarse point/effective cell/tier/version/broad label persist. Tier 7/6/5/tiny-land fallback are versioned, without formal anonymity guarantee.                                                   |
| Discovery            | Indexed viewport filters visibility before aggregation, conserves counts and returns <=961 features. Terminal groups page 20 safe IDs/labels; client clusters sum thought weights. No whole-DB text export.                                                                      |
| Interactions         | Shared Zod allowlists. Public detail has body/emotion/pseudonym/coarse location/immutable dates/four types. Viewer state is separate; totals author/admin only and uncached.                                                                                                     |
| Expiry               | Fixed 720 hour UTC lifetime; relevant queries require published/unexpired. SQL prevents identity/location/lifetime edits. Hourly operator drain cascades deletes; no expired archive.                                                                                            |
| Moderation           | Reports never auto-hide. Mutations/minimal identity inspections audit atomically. Original reporter category survives identity unlinking; no audit body/email copy.                                                                                                              |
| Abuse/cache/logs     | Durable HMAC counters, exact Origin/bounded bodies, actual Siteverify/cross-route replay ledger. Direct buckets ignore spoofed forwarding. Private/detail HTML/API are no-store; nonce CSP/HSTS use validated configuration. Logs: fixed groups/status/duration/random IDs only. |
| Operations           | Web has runtime credentials only; separate operator jobs initialize/migrate/maintain/measure/back up. Restore authenticates before import, denies runtime CONNECT, cleans expiry/sessions/tokens and awaits reconciliation.                                                      |

Development uses host Node plus loopback DB/Mailpit and attributed map fixture. Production has internal DB/proxy networks, outbound provider access, non-root sanitized images and Caddy-only ingress. Dummy-secret rehearsal uses loopback Caddy/request-scoped CA trust; it does not prove real providers/public TLS/Cloudflare/offsite persistence. See [deployment](operations/deployment.md), [launch gates](operations/launch-checklist.md) and [rulings](verification/rulings.md).

Static seed has 87 polygons and zero users/thoughts. Fixtures create random owned DBs/roles and clean only their resources. Main/retained/unknown DBs are not reset by tests. [Acceptance](verification/acceptance-matrix.md) and [reviews](verification/reviews/README.md) record observed invariants/limits.

Author edits use a coherent private body/emotion/version snapshot and an atomic `If-Match` precondition; stale drafts receive 409 and an explicit localized reload path. The audited moderator queue defaults to open/reviewing in oldest-first order with view-bound microsecond keyset cursors and explicit history views. See [ADR 016](adr/016-edit-concurrency-and-report-discovery.md) and [final-fix evidence](verification/final-fix.md).
