# Gunita — Implementation Design Specification

**Status:** MVP implementation baseline / approved product discovery (questions 1–84)  
**Date:** 2026-10-19  
**Audience:** Codex, implementers, reviewers, and project owner  
**Companion:** [IMPLEMENTATION_PLAN.md](../plans/IMPLEMENTATION_PLAN.md)

> Gunita — *A place for feelings left unsaid.* A calm, Philippines-first interactive map where adults can anonymously leave short feelings, memories, confessions, and unsent messages for 30 days. Reading is public after an age/content acknowledgment; publishing, reacting, and bookmarking require a verified account.

## 0. Document authority, scope, and decisions

This specification is the source of truth for MVP behavior. Use the companion plan for implementation ordering and acceptance gates. When something is not specified, choose the smallest privacy-preserving, accessible implementation consistent with these documents; record any substantive deviation in an ADR and do not silently introduce public identity, precise location storage, or a social feed.

### 0.1 Explicitly approved requirements

| Dimension | Decision |
|---|---|
| Brand | **Gunita**; warm, peaceful, minimalist; light/dark theme with system default |
| Geography | Public world map; publishing allowed only for locations inside the Philippines for MVP |
| Language | English and Filipino; language switcher; localize app UI, not users' authored text |
| Audience | 18+ MVP; adult confirmation checkbox in first-visit warning; this is self-attestation, not robust age verification |
| Read access | Guests may view map, thoughts, emotion indicators, and shareable thought URLs after warning acknowledgment |
| Write access | Email/password accounts; verified email mandatory before posting, reacting, or bookmarking |
| Public identity | Automatically generated **permanent account pseudonym** on every authored thought; no public author profiles or author-search endpoints |
| Account | Private dashboard showing own active posts and their reaction counts, bookmarks, settings, deletion |
| Map | MapLibre GL JS; licensed OSM-compatible map tiles; emotion-colored markers; clusters; manual drop-pin only; no GPS/geolocation requests |
| Coordinates | Server-side coarse transformation *before persistence*; never save original exact picked coordinate; approximate city/province label |
| Thought | 1–280 user-perceived characters, Unicode text and emoji only; one of nine categories; editable/deletable by author |
| Lifetime | 30 days from first publication; edits do not extend it; hard-delete expired live records and dependent data |
| Interactions | Love / Sad / Care / Happy, one per account per thought, changeable or removable; bookmarks private |
| Counts | Only author and authorized moderators can see reaction totals; guests/non-authors see types but never counts |
| Discovery | Emotion-category filter; no keyword search or standalone feed in MVP |
| Replies | None; no comments, direct messages, follows, media, or public profiles |
| Sensitive material | One sitewide first-visit warning; non-graphic distress and difficult emotions permitted within community rules |
| Moderation | Publish immediately except obvious high-risk/spam violations; guests can report; manual admin queue; no auto-removal merely from report volume |
| Rate cap | Max 5 newly created thoughts in any rolling 24 hours per verified account; additional rate limits for risky endpoints |
| Stack | Self-hosted **Next.js full-stack**, PostgreSQL/PostGIS, Docker Compose; **no Supabase** |
| Launch | Build/test locally first; production VPS/provider/domain to be decided later; Cloudflare desirable in production |
| Extras | Admin console, automated offsite database backups, secure password reset, Cloudflare Turnstile free plan where applicable |
| Goal | Functionally complete, reliable MVP, even before public users exist |

### 0.2 Privacy truths to communicate honestly

- Public anonymity means no public email, real name, or account ID. **Permanent pseudonyms permit correlation across posts**, so never advertise "untraceable" or "completely anonymous." This is an explicitly accepted product tradeoff.
- A manually chosen location is not proof that the author was physically there. Never show "posted from" or use it as proof of residence.
- A first-visit 18+ checkbox does not verify a person's age. Terms and moderation need to reflect that limitation.
- Approximate published coordinates still reveal a broad user-chosen place and may combine with post content to identify a person. Explain this before posting.
- Expiration is hard deletion from the live database. Encrypted rolling backups may temporarily retain prior encrypted copies until backup retention ends; disclose that limitation and prevent resurrecting expired content during restoration.

### 0.3 Explicitly OUT of MVP

GPS/current location, location search/geocoding, map posting outside the Philippines, user-uploaded images/audio/video, comments, DMs, following, public user profiles, keyword search, standalone feed, realtime websockets, push notifications, donation checkout, analytics tracking profiles, automated AI content classification, multilingual translation of confessions, and any form of public reaction count or popularity ranking.

---

## 1. Product behavior and user journeys

### 1.1 Guest discovery

1. A new visitor loads `/` and sees a **blocking** first-visit content/age warning before reading user-generated content.
2. Visitor checks "I confirm that I am at least 18 years old" and selects **Enter Gunita**. Store acknowledgment with a version in local storage; an optional non-identifying, versioned preference cookie may support server rendering. If storage is cleared or warning version changes, show again. **Do not misrepresent this as real age verification.**
3. An interactive **world map** opens (not auto-centered on current location). Provide a prominent "Explore thoughts in the Philippines" affordance so the first visit is not a visually empty world view.
4. Pins cluster; clicking a cluster zooms toward it and eventually reveals individual pins. Clicking a pin opens a compact accessible popup/bottom sheet: full thought, emotion label, pseudonym, approximate location label, relative and absolute publication time, expiration context (e.g. "Fades in 12 days"), reaction controls, bookmark, report, and share.
5. Guests see reaction types/buttons but **no totals**. Choosing any write action opens a gentle sign-up/login prompt; reading stays unrestricted.
6. Public share URL `/thought/[publicId]` shows the same content after the first-visit gate. Expired, deleted, or removed thoughts yield a non-revealing unavailable state (appropriate 404/410 decision, do not distinguish moderation status). Public previews/OG text must not print user-written sensitive content; avoid indexing individual thought pages.

### 1.2 Registration and authentication

1. Email/password form, clear terms/privacy/guidelines links, validation and generic errors that minimize user enumeration.
2. Generate a random permanent pseudonym server-side at account creation (e.g. `QuietLantern-7F2K`); unique, non-meaningful, non-editable in MVP, with collision retry. Better Auth's internal mandatory name field must be supplied **server-side**, not chosen by the user; do not trust a submitted `name`, `role`, or `pseudonym`.
3. Send verification email using a pluggable transactional-email adapter. No posting/reaction/bookmark until verified. Email reset and resend flows supported.
4. Password reset revokes all existing sessions. Email change, if enabled, requires ownership verification and session revalidation.
5. Account deletion requires recent reauthentication, destroys active thoughts and related data, revokes sessions, and follows the data-retention policy below.

### 1.3 Create thought

1. Verified user selects **Leave a thought**, chooses exactly one of nine emotions, writes up to 280 grapheme clusters, manually drops a marker inside the Philippines, and sees a preview **of an approximate region**, not a promise of precise placement.
2. Client checks length and selects an approximate label for preview if available. Client coordinate never goes into URLs, analytics, browser logs, or persisted client storage.
3. On submit, server validates session and verified status, rate cap, category, content/length, origin & request size, and PH point-in-polygon. It derives an approximate spatial cell/point & broad place label **in memory**, persists only coarse data, and discards the raw picked coordinates.
4. Server performs lightweight content and spam checks. Reject obvious disallowed material with a clear non-judgmental error; do not block ordinary non-graphic grief, heartbreak, or distress merely for mentioning them.
5. Successful creation returns a public ID/URL; the post is immediately readable by its author and generally appears on other visitors' maps after a small cache refresh (target <=60 seconds, not a realtime guarantee).
6. Users may edit text/emotion, not location, in MVP; to relocate, delete and recreate (which consumes the new-post quota). The existing `created_at`, `expires_at`, public ID, and pseudonym remain unchanged. Authors may delete anytime.

### 1.4 Reactions and bookmarks

- Four reaction types: `love`, `sad`, `care`, `happy`. **Exactly one active reaction per account per thought**; selecting a different type updates the row; selecting the same type again removes it. Prevent reacting to own thoughts (own dashboard already provides totals).
- Guests cannot react or bookmark; non-verified accounts cannot interact. Neither the public API nor anonymous map payloads expose counts, reacting account IDs, or a "who reacted" list.
- Logged-in users can see *their own* current reaction choice. The author/admin can request private totals on a distinct uncached protected endpoint.
- Bookmarks are private and unique per account/thought; users cannot bookmark their own thoughts (dashboard already includes them). Expiration/deletion cascades remove bookmarks; bookmarked list only contains currently visible active thoughts.
- No public reaction-based ranking, sort, popular badges, or counts inferred indirectly via API fields.

### 1.5 Dashboard

- `/dashboard/thoughts`: user's **active** thoughts; edit, delete, expiration, reaction totals; optionally status `hidden` with notice if admin removed it. No private archive of expired content.
- `/dashboard/bookmarks`: active, public, non-removed bookmarks only.
- `/settings`: pseudonym (read-only), verified email status, password/security options, delete account.
- No access to other users' dashboards and no public link from pseudonym to a profile.

### 1.6 Admin

- `/admin` is only for accounts with server-side `admin` role; no role changes via public APIs or sign-up requests.
- List reported thoughts with reason/category, queue status (`open`, `reviewing`, `resolved`), reported-at timestamp, reporter category (guest/member), target post if not expired, and minimally necessary author account metadata.
- Dismiss, hide/unhide (with justification), delete content, suspend/unsuspend account, and review history; store append-only admin audit events **without post body or email copies**.
- Reporting a post does not automatically hide it. Authenticated users and guests can report; guest reports require anti-spam controls and Turnstile in production.
- Admin bootstrap through a secure CLI command run from the server, by exact verified account email with explicit operator confirmation; no browser-based role promotion in MVP.

---

## 2. UX, design system, and localization

### 2.1 UI direction

Warm off-white/cream canvas, charcoal text, muted earthy accents, generous whitespace, soft shadows, restrained typography, subtle borders, and gentle transitions; dark mode uses warm deep-charcoal instead of bright-blue neon. Use accessible tokens, not hardcoded color values scattered through components. Emotion palettes are distinct **but never color-only**: display a written label and/or symbol too.

| Emotion key | English | Filipino (UI label) | Suggested palette role |
|---|---|---|---|
| `love` | Love | Pag-ibig | Soft rose |
| `heartbreak` | Heartbreak | Pagkabigo sa pag-ibig | Dusty violet |
| `regret` | Regret | Panghihinayang | Amber-brown |
| `loneliness` | Loneliness | Kalungkutan | Slate-blue |
| `gratitude` | Gratitude | Pasasalamat | Sage-green |
| `hope` | Hope | Pag-asa | Teal |
| `happiness` | Happiness | Kaligayahan | Warm yellow |
| `confession` | Confession | Pag-amin | Muted plum |
| `other` | Other | Iba pa | Neutral gray |

Reaction labels: Love / Pagmamahal, Sad / Lungkot, Care / Pagdamay, Happy / Saya. Translation strings are implementation defaults and should be reviewed by a native speaker before launch. Post text is never translated automatically.

### 2.2 Mobile-first requirements

- At 320, 375, 768, 1024, and 1440 CSS pixel widths, no horizontal overflow or unusable dialogs.
- Map dominates viewport; tap target at least 44x44 CSS px; selected thought opens a dismissible **bottom sheet on phones**, accessible popup/dialog on wide screens.
- Composer has a stable counter in grapheme clusters, preview, emotion selector, manually movable marker, clear submit errors, and keyboard-safe layout.
- Map supports keyboard zoom/navigation where feasible; accessible list of currently visible thoughts as an accessibility alternative **inside the map experience**, not a separate feed; pagination/limit to prevent infinite output.
- Honor reduced-motion, semantic landmarks, focus traps in dialogs, visible keyboard focus, sufficient contrast, and meaningful screen reader labels. Aim WCAG 2.2 AA.
- Theme defaults to `prefers-color-scheme`, persists explicit choice. Locale defaults to browser language (`fil`/`en`) with an explicit toggle; persist preference. Use `Asia/Manila` for user-friendly publication/expiry display and UTC timestamps in database.

### 2.3 Pages/routes

| Page | Accessibility |
|---|---|
| `/` | Public with first-visit age/content gate; worldwide map |
| `/thought/[publicId]` | Public gated shared thought, no content-rich OG preview, `noindex` |
| `/sign-up`, `/log-in`, `/verify-email`, `/forgot-password`, `/reset-password` | Public authentication flows |
| `/guidelines`, `/privacy`, `/terms`, `/help` | Public informational pages; safety resources |
| `/dashboard/thoughts`, `/dashboard/bookmarks`, `/settings` | Verified signed-in user |
| `/admin`, `/admin/reports`, `/admin/accounts`, `/admin/audit` | Authorized administrator |
| `/not-found`, `/error` | Safe fallback; no sensitive debug detail |

---

## 3. System architecture and repository layout

### 3.1 Chosen technology

- **Next.js App Router + React + TypeScript**, Node.js runtime, server components where appropriate, route handlers for APIs. Pin a compatible current stable version at implementation time; commit a lockfile.
- **Drizzle ORM + PostgreSQL + PostGIS**: typed schema/migrations; custom SQL for PostGIS operations and geospatial queries. No Supabase or managed authentication dependency.
- **Better Auth** with PostgreSQL/Drizzle adapter for email/password, email verification, resets, sessions, and CSRF-safe authentication flows. Configure the library's supported security defaults deliberately; prefer built-in `scrypt` memory-hard passwords or reviewed Argon2id configuration; never implement password cryptography by hand.
- **MapLibre GL JS** for map and clustering. Provider-configurable licensed OSM-compatible vector/raster style URL; for local development only, a legitimate MapLibre demo style may be used if its stated terms permit that use. Never assume `tile.openstreetmap.org` provides a production SLA.
- **H3** for coarse privacy-cell transformation, supplemented by a versioned, audited Philippines administrative-boundary dataset and density-tier mapping. PostGIS stores **only** the coarsened public point.
- **Zod** for API validation; React Hook Form or comparable accessible form primitives; `next-intl` or equivalent typed locale catalogs; UI tokens via Tailwind CSS and accessible headless primitives where helpful.
- **Docker Compose** for local and future VPS: `web`, `db` (PostGIS), `caddy` (TLS/reverse proxy in production), `mailpit` in development, and `maintenance` process/short-running job. No Redis required at MVP scale.
- **Transactional email interface**: Mailpit locally, provider-neutral SMTP/API adapter for production; never commit keys. Verification delivery is an operational gate before public launch.
- **Cloudflare**: optional CDN/reverse proxy/DNS for future VPS, **Cloudflare Turnstile Free** for registration and anonymous reports, login abuse as appropriate. Validate all Turnstile tokens server-side including hostname/action; allow official test keys in development only.

### 3.2 Logical request flow

```text
Browser
  ├── map tiles → authorized external tile provider
  └── HTTPS → (future Cloudflare proxy) → Caddy → Next.js Node
                                      ├── public map / thought GET
                                      ├── Better Auth handlers
                                      ├── protected thought / reaction / bookmark routes
                                      ├── guest reporting with Turnstile
                                      └── admin routes
                                                   ↓
                                          PostgreSQL + PostGIS
                                                   ↑
                            scheduled cleanup / backup job (private network)

Email: Next.js auth → provider adapter → transactional email provider
Backups: PostgreSQL pg_dump → encryption → storage outside the VPS
```

### 3.3 Suggested repository structure

```text
src/
  app/[locale]/(public)/             # map, share, guidelines, legal, help
  app/[locale]/(auth)/               # login, signup, verification, reset
  app/[locale]/(member)/             # dashboard, settings
  app/[locale]/admin/                # role gated
  app/api/                           # REST route handlers
  components/map/ components/thoughts/ components/ui/
  server/auth/                       # Better Auth configuration, access guards
  server/db/                         # Drizzle schema, migrations, PostGIS queries
  server/services/                   # thoughts, privacy, reactions, moderation, expiry
  server/security/                   # Turnstile, rate limiting, abuse rules, audit
  lib/validation/ lib/i18n/ lib/constants/
  styles/
infra/                               # Dockerfiles, Caddy, scripts, backup/restore
scripts/                             # admin bootstrap, data import, maintenance
locales/en.json locales/fil.json
assets/geo/                          # PH admin boundaries + provenance/license
tests/unit/ tests/integration/ tests/e2e/ tests/security/
```

Keep server-only modules private, never import database/admin credentials into client bundles. Auth checks belong **inside each route or service**, not only in Next.js proxy/middleware.

---

## 4. Data model and integrity

All times are `timestamptz` UTC. Prefer UUIDv7/UUIDv4 internal IDs and independent cryptographically random public IDs/slugs (>=128 bits entropy, URL-safe). Do not expose owner IDs to public clients. Database foreign keys and transactions enforce invariants.

### 4.1 Core schema

**Better Auth-managed tables:** `user`, `session`, `account`, `verification` (exact names/fields depend on pinned version and its generated Drizzle schema). Preserve library-managed schema. Email is unique case-insensitively; avoid duplicating it in public objects. Password hashes and tokens are never in logs.

**`profiles`**: `user_id` PK/FK `user`; `pseudonym` unique, not null; `role` enum(`member`,`admin`) default `member`; `status` enum(`active`,`suspended`) default `active`; `created_at`, `updated_at`; optional `suspended_at`; no real name, avatar, or biography. Profile is private except `pseudonym` included **as a string** on each public thought. Register hook creates profile atomically/retry; no unauthenticated profile lookup API.

**`user_consents`**: `user_id` FK user CASCADE, `guidelines_version`, `accepted_at`; UNIQUE(`user_id`, `guidelines_version`). Server must check acceptance of the current guidelines version before allowing a new post. For first-visit age/content acknowledgment, use the previously specified versioned client preference rather than collecting a birthdate.

**`thoughts`**:
- `id` internal UUID PK, `public_id` UNIQUE random slug, `author_id` FK user CASCADE;
- `body` text NOT NULL; grapheme length validated at application boundary (DB byte/character sanity limit as defense in depth);
- `emotion` checked enum of nine keys;
- `public_point` geometry(Point,4326) NOT NULL, GiST index; `privacy_cell` text NOT NULL, `privacy_tier` smallint NOT NULL, `privacy_algorithm_version` integer NOT NULL;
- `location_label` safe broad string (province/Metro Manila; no street/building), optional `location_region_code`;
- `status` enum(`published`,`hidden`) default `published`;
- `created_at`, `updated_at`, `expires_at` NOT NULL, `expires_at = created_at + interval '30 days'` on INSERT and invariant never updated on EDIT;
- index `(status, expires_at, created_at DESC)` and `(author_id, expires_at DESC)`.

**`reactions`**: `user_id` FK user CASCADE, `thought_id` FK thoughts CASCADE, `type` enum(`love`,`sad`,`care`,`happy`), `created_at`, `updated_at`; PK(`user_id`,`thought_id`) ensures exactly one. Prevent author self-reactions in transactional service. Counts computed only through author/admin endpoint.

**`bookmarks`**: `user_id` FK user CASCADE, `thought_id` FK thoughts CASCADE, `created_at`; PK(`user_id`,`thought_id`); prohibit self-bookmark in service.

**`reports`**: `id` UUID PK; `thought_id` FK thoughts **ON DELETE CASCADE**; `reporter_user_id` nullable FK user **ON DELETE SET NULL**; `reason` enum(`harassment`,`private_info`,`threats`,`self_harm_encouragement`,`spam`,`other`), `details` optional short sanitized text (max 500 chars; remind reporters not to include private info), `status` (`open`,`reviewing`,`resolved`); `created_at`, `resolved_at`, `resolved_by` nullable. Guest abuse bucket identity should be non-reversible short-lived HMAC value, and **must not** become a public identifier.

**`admin_audit`**: `id` UUID; admin user FK nullable on delete; action enum, subject kind, subject internal UUID nullable, reason_code, timestamp, safe summary of changed status. **Never copy post body, email, raw IP, exact point, secret, token** into audits. Enforce a 90-day operational retention window unless incident/legal retention requires a separate documented policy; purge identifiers on account deletion where applicable.

**`rate_limit_counters`** (only if needed beyond auth library): keyed by HMAC-rotated abuse bucket (not raw IP), route group, window start, count, expiry. Index expiry for cleanup. Critical 5-post cap must query authoritative `thoughts` created in prior rolling 24h **transactionally**; deletion must not permit immediate quota bypass, so a separate privacy-minimized `post_quota_events` table of author ID + created_at, TTL 24h, should record every publish regardless of later deletion. This counter must be transactionally safe under concurrent requests (account-scoped advisory transaction lock or equivalent).

**`geo_admin_areas`**: static admin polygons/labels and privacy density tiers, versioned with source attribution and import checksum, used only for server validation and coarse labels. Public never receives source picked coordinates.

### 4.2 Privacy transformations: required algorithmic contract

1. Request receives raw `{lat, lng}` **ephemerally** and validates finite ranges and correct coordinate ordering (`lat`/`lng` distinct fields).
2. Check original selected point within **land-based Philippines polygon** via PostGIS `ST_Covers` (including boundary). Version the geographic dataset; decide treatment of tiny islands and disputed territories explicitly in seed data; never use rectangular bbox alone.
3. Determine a configured privacy density tier from versioned administrative zone data: metro/urban H3 resolution 7, intermediate 6, sparse/island 5 as the **initial rules**, to be reviewed against local geography before release. H3 sizes are approximate; coarsening is not a formal anonymity guarantee.
4. Calculate H3 cell and publish a **deterministic representative point of the cell intersected with valid PH land geometry** (e.g. appropriate polygon interior point). Do not jitter into the ocean; all authors in the same cell/tier should not expose different precise variations. If the valid land intersection is exceptionally small, escalate to coarser tier/province-level representative to avoid pinpointing a tiny settlement. Store only the resulting public point, privacy cell/tier/version, and province-level label.
5. **Never insert the raw lat/lng** into a DB row, job queue, tracing span, error report, analytics event, access log, or client local storage. Mask request bodies and coordinate-bearing query strings in all logging/observability. Use a POST JSON body for creation (never query string).
6. Return only coarse point in API and edit flow. Do not provide the original selected point to client after submission. Changing an existing post's location requires deletion/new posting.
7. Privacy tests should include Metro Manila, Cebu, Iloilo, sparsely populated provinces, island shorelines, boundary points, invalid points, out-of-country points, and a cell-intersection test proving raw input cannot be reconstructed from storage.

**Important:** A permanent pseudonym, coarse pins, and voluntary text do not guarantee non-identification. Include clear user guidance not to post addresses, full names, personal phone numbers, or identifying details.

### 4.3 Expiration and deletion guarantees

- Visible condition everywhere: `status='published' AND expires_at > now()`; use it on all public map, public detail, bookmarked, counts, and aggregation queries. At the boundary instant a thought is unavailable **even if cleanup has not run**.
- Run an idempotent maintenance job at least hourly to hard-delete expired `thoughts` in batches and cascade reactions/bookmarks/reports. This removes content from live DB; maintain indexing and transaction boundaries.
- Never extend expiry on edits. An admin-hidden thought still expires on schedule and cannot be restored after expiration.
- Share URLs after deletion/expiry/report-removal return generic unavailable status; purge/expire public CDN/application caches on delete and moderation hide, or use short TTL plus explicit bypass for detail to avoid stale visible content.
- Daily encrypted offsite backups, minimum viable retention **7 days** (configurable), verified periodic restore drill. Expired content can survive temporarily in encrypted old backups and must not be served after restoring: keep restored environment isolated, apply deletion/expiration cleanup before public traffic. Account deletion and immediate erasure from immutable backups cannot be promised; disclose bounded backup retention and legal exceptions.
- Account deletion revokes sessions, removes or cascades active thoughts, reactions, bookmarks, reports association, and deletes account/profile. Security records retained only to the minimum policy-defined extent, never public. Provide deletion confirmation and generic support channel.

---

## 5. API contracts and authorization

REST endpoints in Next.js route handlers, JSON by default, explicit Zod input/output DTOs, body size limits, and RFC7807-like generic error structure `{code,message,requestId?}` without stack traces. Public response DTOs are **allowlisted**, never ORM models. All protected methods verify server-side session and email verification; no privileged actions through client-side checks alone.

### 5.1 Routes

| Method | Route | Access | Behavior |
|---|---|---|---|
| GET | `/api/map/pins?bbox=w,s,e,n&zoom=z&emotion=k?` | Public | Current viewport markers/aggregates, active published only; no owner IDs/reaction totals |
| GET | `/api/thoughts/:publicId` | Public | Safe detail DTO + pseudonym; generic unavailable when not public/current |
| POST | `/api/thoughts` | Verified member | `{body,emotion,location:{lat,lng}}` → create + coarse public DTO; quota check |
| PATCH | `/api/thoughts/:publicId` | Author | `{body?,emotion?}` only; original creation/expiration/location immutable |
| DELETE | `/api/thoughts/:publicId` | Author | Immediate hard delete, idempotent success as appropriate |
| PUT | `/api/thoughts/:publicId/reaction` | Verified non-author | `{type}` upsert unique reaction |
| DELETE | `/api/thoughts/:publicId/reaction` | Verified non-author | Remove own reaction |
| PUT | `/api/thoughts/:publicId/bookmark` | Verified non-author | Bookmark idempotently |
| DELETE | `/api/thoughts/:publicId/bookmark` | Verified non-author | Remove bookmark |
| GET | `/api/me/thoughts?cursor=...` | Verified member | Own active or admin-hidden posts with author-only aggregate counts |
| GET | `/api/me/bookmarks?cursor=...` | Verified member | Own active bookmarked thought DTOs |
| GET | `/api/me/thoughts/:publicId/reactions` | Author | **Counts of four types only**, no member identities; `Cache-Control: private, no-store` |
| DELETE | `/api/me/account` | Auth + reauth | Delete account & associated content; revoke sessions |
| POST | `/api/reports` | Guest or member | `{thoughtPublicId,reason,details?,turnstileToken}`; submit to queue; generic receipt |
| GET/PATCH | `/api/admin/reports` and `/api/admin/reports/:id` | Admin | Queue, moderation outcomes; strictly uncached |
| POST | `/api/admin/thoughts/:publicId/moderate` | Admin | Hide/unhide/delete with reason; audit |
| POST | `/api/admin/accounts/:id/suspension` | Admin | Suspend/unsuspend; audit |
| GET | `/api/admin/audit` | Admin | Minimal audit records |
| GET/POST | `/api/auth/*` | Managed | Better Auth registration, login, verification, reset, logout, sessions |

No public `/users/:id`, `/profiles/:id`, `/thoughts?author=...`, `/reactions/users`, or unfiltered query path. Avoid returning `author_id` in map/report/public DTOs.

### 5.2 Examples

**Public thought response** (no reaction counts/author ID):

```json
{
  "publicId": "t_VL5Lxxxxxxxxxxxxxxx",
  "body": "I never got to say thank you.",
  "emotion": "gratitude",
  "pseudonym": "QuietLantern-7F2K",
  "location": { "label": "Iloilo Province", "lat": 10.7, "lng": 122.5 },
  "createdAt": "2026-10-19T12:00:00.000Z",
  "expiresAt": "2026-11-18T12:00:00.000Z",
  "reactionTypes": ["love", "sad", "care", "happy"]
}
```

*Coordinates and IDs above are illustrative only. Do not seed these as real user posts.*

**Owner reaction totals** (`GET /api/me/thoughts/:publicId/reactions`):

```json
{ "totals": { "love": 2, "sad": 1, "care": 5, "happy": 0 } }
```

The author's own totals must never be embedded in publicly cacheable responses. For a member viewing someone else's post, a separate private interaction-state response may say `{ "myReaction": "care", "bookmarked": true }` but has no counts; use `private, no-store`.

### 5.3 Map contract and scaling

- Inputs: normalized, clamped `bbox`, validated numeric zoom 0–18, optional single emotion enum. Handle antimeridian correctly. Debounce pan/zoom; abort stale requests; no IP/geo auto-center.
- Geospatial query: GiST index on coarse `public_point`, viewport `ST_Intersects` or bbox using indexed geometry; filter `expires_at > now()`, `status='published'`, and emotion **before aggregation**.
- MVP target: return at most **1,000 display features** per map response, with deterministic zoom-dependent **server aggregation** at global/low zoom or dense viewports so no points silently disappear. Each aggregate carries a *thought count*, not reaction count, and a coarse representative point. Do not include text/body in bulk map payloads; fetch detail on click.
- At closer zoom, individual display points cluster through MapLibre GeoJSON source `cluster: true` (initial `clusterRadius: 50`, tuning permitted). Aggregate features already represent groups; client style must distinguish server aggregates and compute cluster displayed total as the **sum of member post counts**, not the number of aggregate records.
- Cluster click zooms in; point click displays detail. If a mixed-emotion cluster is shown, use a neutral cluster marker. Single post markers use emotion color and accessible legend.
- Cache **only truly public** map responses for a small TTL (e.g. 30 seconds); route-specific no-store for per-account state and authors' counts; invalidate/bypass stale detail immediately after author delete/admin hide. Expect global propagation up to 60 seconds for new posts.
- Add sampling/performance tests for 10,000+ seed thoughts and map viewport requests. Do not implement unbounded whole-database GeoJSON export.

### 5.4 Errors/status

- 400 malformed input; 401 not logged in; 403 not verified/forbidden/suspended; 404 unknown/expired/hidden to unauthorized viewer; 409 conflict for stale edit; 422 content/pin/category invalid; 429 rate/5-post cap; 500 unexpected internal error; 503 external email/Turnstile outage only where request cannot safely proceed.
- Error codes include `EMAIL_UNVERIFIED`, `POST_LIMIT_REACHED`, `OUTSIDE_PHILIPPINES`, `THOUGHT_UNAVAILABLE`, `CONTENT_REJECTED`, `RATE_LIMITED`, `VERIFICATION_REQUIRED` without leaking user data.
- Mutations require `Origin` checking, same-site secure cookies, CSRF protection per auth library, session validation, bounded JSON and security headers.

---

## 6. Safety, trust, and moderation

### 6.1 Community policy minimum

Allowed: non-graphic difficult feelings, grief, loneliness, regret, relationship pain, generalized trauma, non-instructional descriptions of emotional crisis, expressions of hope. Prohibited: targeted harassment; credible threats; encouragement/instructions for suicide or self-harm; sexual exploitation of minors; non-consensual intimate material; protected private information/doxxing; scams/spam; content encouraging violence. For non-graphic distress, show supportive copy/Philippines-relevant crisis-resource links via an editorially maintained `/help` page; verify current contacts before launch and do not invent phone numbers.

The first-visit warning explains adult audience and potentially distressing content. No per-post blurred content warnings in MVP (explicit product choice). The rules **cannot** be waived by the warning.

### 6.2 Lightweight prevention, not overblocking

- Fast, deterministic checks: 280-grapheme limit, trimmed whitespace and zero-width abuse normalization, basic contact-info patterns, high-confidence dangerous threats/doxxing patterns, repeated identical posts, and hourly spam limit. Do not automatically reject vague words such as "sad", "suicide", or "trauma" by themselves; avoid blanket mental-health keyword bans.
- Moderation policy maintained separately from code with reviewed test cases. Where uncertain, allow ordinary distress; provide reporting and moderator review. Rules can be tuned, with logs containing reason code but **not body**.
- Turnstile server-verification for guest reports and registration in prod; apply extra controls to login resets and suspicious activity. Free tier is available; validate siteverify token, hostname, expected action, expiry/single-use. Development uses official Turnstile test keys or a mocked verifier only in `NODE_ENV=development`/test.
- Reporting: limit per IP-abuse-bucket, account and thought; cap free-text; generic success to minimize probing. Reports never publish author or reporter identity.
- Admin accesses reported account identity only as needed, with audit trail and session revalidation. Protect admin against enumeration, CSRF, brute force, and misuse.

### 6.3 Rate limits (defaults, configurable)

| Action | Suggested threshold | Enforcement |
|---|---|---|
| New thoughts | 5 per account per rolling 24h | Authoritative DB event ledger + transaction lock |
| Edits | 20 per account per hour | DB rate counter |
| Reactions/bookmarks | 60 combined per account per hour | DB rate counter |
| Anonymous reports | 3 per abuse bucket per hour and 1 per target per day | Turnstile + DB counter |
| Auth login/reset/resend | Stricter limits per email hash and IP bucket | Better Auth limiter + protection |
| Public map API | Sensible per-IP and globally protective request limits | CDN/proxy + origin limiter, do not block ordinary navigation |

Values are initial operational defaults, not guarantees. Never rely solely on in-memory limits in containers. Rotate HMAC keys and expire buckets promptly; raw IPs never persist in app logs. Trusted proxy configuration must prevent spoofed `X-Forwarded-For`/`CF-Connecting-IP` from arbitrary direct requests.

---

## 7. Security and privacy requirements

1. **Account isolation:** every author operation checks authenticated `user.id === thought.author_id`; non-author gets 404/403 without leaking ownership. Suspended accounts may read public content but cannot perform member writes.
2. **No public identity leakage:** public JSON, sitemap, HTML, page props, image OG metadata, error stacks, and logs exclude user IDs, email, session identifiers, reaction participants, exact submitted point, and source request body.
3. **DB access:** PostgreSQL listens only on Docker internal network; no public port; separate migration credentials and least-privilege runtime role; parameterized SQL; locked-down database backups.
4. **Sessions/auth:** Better Auth secure `HttpOnly`, `Secure` in production, `SameSite=Lax` (or stricter where feasible), strict production origins, limited session lifetime, email verification before writes, session invalidation after password reset/deletion. Review Better Auth defaults for current pinned version.
5. **Browser protection:** CSP compatible with MapLibre/tile provider/Turnstile, HSTS after HTTPS configured, proper `Referrer-Policy`, X-Content-Type-Options, clickjacking protection, escaped text, no `dangerouslySetInnerHTML` with user content. No raw user HTML or Markdown rendering.
6. **No public CDN cache of secrets:** authenticated responses `private, no-store`; no service-worker offline copies of confidential dashboards; thought detail caches must not survive delete/moderation.
7. **Data minimization:** no analytics SDK required; do not track GPS, exact pin coordinates, browsing history, or identity cross-links. Store only necessary account email, hashed password, sessions, coarse pin, and public thought text.
8. **Legal pages:** Privacy Policy (including retention, backups, reporting, international processors, data subject rights), Terms and Community Guidelines should be reviewed for Philippines launch and applicable Data Privacy Act requirements. Code does not certify legal compliance.
9. **Secrets:** `.env.example` with safe placeholders; keys in untracked env/secret store; redact errors. Never publish SMTP, Turnstile secret, Better Auth secret, DB password, backup encryption key.
10. **Threat model:** password stuffing, account enumeration, credential reset abuse, spam, repeated false reports, cross-account access, moderation abuse, correlation via pseudonym, exact-location inference, CDN cache poisoning, SSRF through tile/style config, XSS, SQL injection, CSRF, geographic boundary manipulation, backup restore leaks.

### 7.1 Retention policy baseline (review before launch)

| Data | Retention |
|---|---|
| Published thought + post-specific reactions/bookmarks/reports | Hard-deleted no later than 1 hour after 30-day expiry in live DB; invisibility enforced immediately by query |
| User-deleted thought | Delete immediately from live DB (transactional), dependent rows cascade |
| Account on verified deletion request | Remove from live DB promptly; revoke sessions immediately |
| Verification/reset tokens | Short library-managed TTL; expire and remove |
| Quota creation-event ledger | 24 hours plus cleanup allowance |
| Rate-limit abuse buckets | Short TTL, ordinarily <=24h |
| Sanitized application/security logs | Up to 7 days by default, with redaction; no body/exact coordinates |
| Minimal admin audit | Up to 90 days; clear subject linkage on deletion and avoid content copies |
| Encrypted offsite backups | Daily backup, rolling 7 days by default; tested restorations |

Where law requires a different retention period, record documented exceptions explicitly, and explain them truthfully in the privacy policy.

---

## 8. Deployment and operations

### 8.1 Local development

- `docker compose up -d db mailpit` then `pnpm dev` (or full stack in Compose); one-command option `docker compose --profile dev up --build` for consistent onboarding. Ship a no-key development map style (e.g. MapLibre demo resources only under permitted development/demo terms) or an explicitly documented local test tile fixture, while requiring a production-licensed provider before launch.
- PostGIS migration & static PH boundary seed run from scripts; demo fixtures **clearly fictional** and only in dev/test, never silently published in prod.
- Turnstile official test credentials; local SMTP captured by Mailpit; local Caddy optional. All features testable with no paid service or domain.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:migrate`, `pnpm db:seed:geo`, `pnpm maintenance:expire`, `pnpm backup:verify` documented.

### 8.2 Production-ready package, not a live launch

- Multi-stage Docker build with Next.js `output: 'standalone'`; non-root runtime container; health/readiness endpoints (minimal public response).
- Compose production includes persistent PostgreSQL volume, private Docker network, Caddy HTTPS reverse proxy, process resource limits, restart policies, migrations guarded, maintenance scheduled without overlapping runs, and backup task with external encrypted object storage or separate host.
- Cloudflare DNS/CDN optional when provider/domain selected; Full (strict) TLS and valid origin certificate, no double-cache of personalized routes, correctly configured trusted proxy IP ranges. Cloudflare does **not** replace VPS or database.
- Tile provider must have legitimate production access, required map/OSM attribution, explicit usage caps; map style URL controlled by env. Public OSM Foundation tile servers are not an assumed unlimited production tile CDN.
- Production checklist blocks launch until **domain, VPS, real SMTP delivery, licensed tile provider, offsite backup destination, Turnstile production keys, DNS/TLS, content policies, privacy policy, crisis-help page, monitoring, tested restore** are configured.

### 8.3 Observability

Structured JSON logs with correlation IDs, endpoint latency, status, queue size, anonymized counters. No user content, email, IP, precise location, auth tokens, or sensitive bodies. Track metrics such as map response p95, error rate, email-send success, cleanup lag, moderation queue age, disk free, backup freshness, and expiry violations. Health checks should detect DB failure but never leak credentials.

---

## 9. Quality attributes and acceptance targets

### 9.1 Functional invariants

- Guest accesses map & public thought (after age UI gate) but cannot perform any write except permitted guest reporting.
- No unverified or suspended member can post, react, or bookmark.
- At most five post **creation events** per rolling 24h per verified account, including deleted posts, enforced under concurrent requests.
- No submitted exact coordinate is persisted or logged, and no post outside PH land boundary is accepted.
- All public post locations are coarse, labels non-precise, and post owner ID never sent publicly.
- No non-author response reveals reaction totals or participant identities, including error/debug paths.
- Editing never changes location, pseudonym, creation date, expiry, or public ID.
- A post ceases to be publicly available at 30 days regardless of cleanup, and dependent reactions/bookmarks/reports disappear when physically deleted.
- An admin cannot accidentally circumvent hard expiry; moderation removes public visibility immediately.
- Deleting an account destroys its publicly linked content and prevents the old sessions from operating.

### 9.2 Measurable goals (local seeded environment, not SLA)

- 100% passing unit, integration, permission, geospatial privacy, e2e, accessibility smoke, and security regression tests defined in plan.
- Target typical map API p95 <750ms with 10k seeded current thoughts on a reasonable test machine; no arbitrary full-table GeoJSON returned. Record hardware and query plan rather than claim a production SLA.
- Public content from new posts generally discoverable within 60 seconds.
- Hard delete expiration job within one hour of deadline, with query exclusion at exact expiry.
- Mobile usability at 320–430px and 2 common desktop breakpoints; no horizontal overflow.
- Every required UI string supplied in English and Filipino catalogs; user content remains verbatim.
- Successful automated encrypted backup and **manual/CI-tested restore to isolated database** documented before VPS launch.

---

## 10. Architecture decision records (accepted defaults)

- **ADR-001:** Monolithic Next.js App Router + Node runtime; no NestJS microservice.
- **ADR-002:** PostgreSQL/PostGIS self-hosted via Compose; Drizzle migrations; no Supabase.
- **ADR-003:** Better Auth for email/password and sessions, configured for verified account writes.
- **ADR-004:** Permanent per-account public pseudonym, despite correlation risk; no public profile or author discovery endpoint.
- **ADR-005:** MapLibre with provider-switchable OSM-compatible tiles; clustered pins; density-aware server aggregates.
- **ADR-006:** Server-side H3 coarse location transformation, no exact-coordinate persistence, PH polygon for legal placement.
- **ADR-007:** 30-day immutable expiration, immediate query invisibility, hourly hard-delete, short encrypted backup retention.
- **ADR-008:** Immediate publication with light proactive rejection; guest reports; manually audited moderation.
- **ADR-009:** Owner-only reaction totals; no public counts, even through caches/metadata.
- **ADR-010:** Local-first launch preparation, Docker Compose portability, eventual VPS behind optional Cloudflare.

## 11. External documentation / verification links

Technical references checked during discovery; use their current pinned-version guidance when implementing:

1. Next.js standalone Docker output: https://docs.docker.com/guides/nextjs
2. Better Auth installation/Next.js: https://better-auth.com/docs/installation and https://better-auth.com/docs/integrations/next
3. Better Auth email/password, verification/reset: https://better-auth.com/docs/authentication/email-password
4. Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
5. MapLibre GeoJSON clustering: https://maplibre.org/maplibre-style-spec/sources/ and https://maplibre.org/maplibre-gl-js/docs/examples/create-and-style-clusters/
6. PostGIS polygon containment (`ST_Covers`): https://postgis.net/docs/ST_Covers.html
7. H3 cell sizes: https://h3geo.org/docs/core-library/restable/
8. OpenStreetMap public tile policy: https://operations.osmfoundation.org/policies/tiles/
9. Cloudflare Turnstile Free plan: https://developers.cloudflare.com/turnstile/plans/
10. Cloudflare Turnstile server-side verification: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

**Implementation safeguard:** Before writing code, Codex must inspect the repository if one exists, pin actual compatible stable dependency versions, review migration/adapter support, and record exact versions in the lockfile. Current documentation is not permission to invent APIs or use unstable releases without reason.
