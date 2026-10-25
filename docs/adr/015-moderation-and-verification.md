# ADR 015: local-first moderation and actual Turnstile verification

Status: Phase 7 local implementation, 24 October 2026. Public launch remains blocked on real provider/domain, proxy/origin, legal/privacy/native-language and resource review.

## Moderation and minimal retention

Reports use the existing report/audit/counter tables and runtime grants. They never change thought visibility. Guests and verified active members can report through the same bounded strict DTO; all reports require Turnstile. A generic receipt is returned for duplicate or unavailable targets. Details are limited to 500 characters and rendered as escaped text. Reporter identifiers are never returned. Queue inspection reveals only the nonexpired reported thought, its permanent pseudonym and minimally necessary account ID/status/role, with an append-only inspection audit. No email is exposed by moderation DTOs.

All admin APIs revalidate the signed session and current verified/active/admin state inside the same transaction. The admin page layout also guards on the server; report content is loaded only by the acknowledged client boundary, never SSR/RSC props. Hide/unhide/delete have fixed reason codes, bounded input, canonical Origin and immediate uncached detail behavior. Expired thoughts cannot be restored. Existing counts remain published-only, including for admins. Suspension revokes current sessions; unsuspension does not restore them. Self-suspension is rejected to avoid accidental lockout.

For a two-account suspension operation, read-only signed-session discovery obtains the actor key, then all actor/target **user rows** are locked in UUID order before any actor guard acquires its normal account/profile/session locks. A controlled real PostgreSQL test pauses the first account lock, observes the second request through `pg_blocking_pids`, then completes both directions without deadlock. Ordinary single-account guards remain unchanged.

Bootstrap is operator-only: `pnpm admin:bootstrap --email <exact verified email> --confirm-email <same exact email>`. It loads separate migration credentials, explicitly checks role-column UPDATE privilege, locks the user before profile, requires verified/active status, promotes atomically and records a content-free audit. Public routes cannot promote roles. Tests invoke the real CLI only against a guarded disposable database.

The existing maintenance process removes expired thoughts and dependent reports, counters at expiry, and audit events older than 90 days. Foreign keys clear audit linkage on deletion. Audit rows never contain authored body, details, email, token, IP or location copies. Migration0007 adds immutable original reporter category (guest/member); no web grant expansion.

The account console independently lists suspended accounts and authors with current reported thoughts, in bounded 20-item UUID-cursor pages. It selects only existing account ID, pseudonym, role and status; deletion or expiry of the last report cannot remove the operator's unsuspend path. Active accounts without current reports leave the listing. It is not a general identity directory. History exposes the existing nullable administrator UUID and subject reference (account/report UUID or joined thought public ID), never copied labels or content. Existing foreign-key erasure removes those references after deletion.

Each returned account records an existing `review_report` / `INSPECT` event with `subject_kind=account`, its nullable subject FK and the inspecting administrator, in the same transaction as the private response. Audit failure or DTO validation failure rolls back all inspection events and withholds the account response. Because audit subject FKs acquire user locks, read-only signed-actor and bounded page discovery precede sorted actor/candidate user-row locks, then fresh admin authorization and an eligibility requery restricted to those candidates. Only returned identities are audited. When discovery found a following page, continuation uses the last fresh returned and audited account, never a stale discovery ID; no unlocked identities refill that page. If every locked candidate disappears, the response is empty with no cursor. The existing Refresh control starts a fresh listing that can discover the remaining accounts. Schema, permissions, deletion unlinking and 90-day retention remain unchanged.

Report submission uses Better Auth's cookie parser and its configured session-cookie name to choose the member path. Unrelated cookies remain guest requests; a present session cookie, including an empty value, requires the existing fresh member guard. Invalid, revoked, unverified and suspended credentials do not fall back to guest reporting.

## Explicit official-test envelope

Controller ruling 7 permits official test keys only for loopback APP_ORIGIN in development/test or production artifact execution with LOCAL_PREVIEW=true. The validated local launcher binds loopback. The public always-pass site/secret pair is the local default; the documented spent-token secret is accepted only in that local configuration for rejection testing. Nonlocal production rejects official test keys and requires HTTPS configuration.

The actual October 23 upstream probe and current integration calls show the official dummy verifier returning hostname `example.com` and no action, and accepting arbitrary non-token text. This differs from illustrative documentation. Therefore a tiny local callback adaptation makes the permissive test behavior explicit:

`gunita-local-v1.<report|registration>.<13-digit epoch milliseconds>.<crypto.randomUUID UUIDv4>.XXXX.DUMMY.TOKEN.XXXX`

The browser creates this only from the exact official widget dummy callback. The server validates structure, expected action and age from 0 through 300 seconds, then sends the **complete envelope** to the actual Cloudflare Siteverify endpoint. Only this explicit local mode accepts the observed `example.com`/absent-action response. There is no mocked verifier in production artifacts and no remoteip field is sent. A 10-second timeout, malformed response, transport error or unsuccessful result fails closed.

Production tokens remain unchanged. The server verifies success, exact configured hostname, exact action and valid challenge timestamp no older than 300 seconds. Local prefixes/dummy tokens are rejected. After upstream verification, a durable HMAC claim consumes the token for 300 seconds. The replay namespace is shared across registration and reports; action does not partition uniqueness. Concurrent replay cannot create two claims. The existing short-lived counter table holds only the HMAC, route and times.

The local dummy/envelope proves network plumbing, validation, failure handling and replay boundaries. It does **not** prove human/bot validity or real production Turnstile/provider integration. Real production keys/domain and provider behavior remain launch gates.

## Direct-origin abuse and future proxy trust

Next's Request does not expose an authenticated socket peer. Direct mode deliberately ignores all Forwarded, X-Forwarded-For and CF-Connecting-IP headers. It uses one shared HMAC abuse bucket: 3 report attempts per fixed hour, plus 3 per member/hour and one accepted report per identity/target in a rolling 24 hours. This is restrictive for multiple legitimate local visitors; it is not a claimed per-IP deployment solution. Unknown TRUST_PROXY settings fail startup. Existing auth counters remain durable: 120 shared attempts per action/minute, normalized-email/session/token HMAC budgets of 10 login or 5 other attempts per 15 minutes. The 5-new-thoughts/rolling24h ledger also bounds hourly creation; duplicate-content and 20 edits/hour checks remain in force.

The runtime secret keys HMAC records, with no raw IP storage or logging. Rotating the runtime secret rotates these opaque buckets and authentication signing; plan that operator action deliberately, retain no old key in public artifacts and let short TTL cleanup drain old records. Do not interpret spoofed header tests as a verified production proxy.

Before enabling Cloudflare/Caddy attribution, establish an authenticated/restricted proxy path, block direct-origin access, configure the exact trusted peer chain and overwritten client header, and prove spoofed direct/header-chain requests cannot choose a bucket. This needs chosen production networking and remains a launch blocker, not a permissive header flag.

Primary references: [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [official test credentials](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), [Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Caddy trusted proxies](https://caddyserver.com/docs/caddyfile/options#trusted-proxies). The controller's exact wire receipts and ruling remain in the local implementation ledger.

## Help resource provenance

The required hotline connector was queried again on 24 October 2026 for the Philippines. It returned NCMH Crisis Hotline, explicitly free/confidential phone support 24/7. Included contact Markdown is preserved verbatim:

- [1800-1888-1553](tel:+63180018881553?oai_link_source=model_response_hotline)
- [https://www.facebook.com/ncmhcrisishotline?mibextid=LQQJ4d](https://www.facebook.com/ncmhcrisishotline?mibextid=LQQJ4d&oai_link_source=model_response_hotline)

The Help page uses these exact labels/targets, a dated review notice, and no inferred extra numbers, SMS, hours or services. Visitor copy no longer names implementation phases/specification. External resource, native-language, policy and legal/privacy review remains required before public launch; this lookup is not clinical/legal certification.

## Original reporter category (controller ruling8)

Reports explicitly persist guest/member at submission. Identity foreign keys still unlink on account deletion; original category is immutable and adds no identity/content copy. Migration0007 backfills only linked legacy members and fails clearly if any legacy NULL reporter is ambiguous. No default guesses guest. Typed schema and all direct SQL test fixtures provide category explicitly. Focused real DB tests preserve member category after account deletion, retain true guest, reject recategorization, reject ambiguous legacy data and backfill linked members. Main and retained manual fixture each had zero reports before upgrade. Authenticated AES-256-GCM backups were created under the existing private key/ACL before guarded migrations; both applied1 then repeat0, preserving0/63 thought rows and their bodies/times. Unknown e715 was untouched.
