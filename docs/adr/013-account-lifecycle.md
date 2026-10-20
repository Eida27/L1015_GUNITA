# ADR 013: private account lifecycle with a single transaction boundary

Status: implemented locally, Phase 2. Better Auth and its separate Drizzle adapter remain pinned to 1.7.11; the generated schema is unchanged.

## Account identity and transactions

Migration 0006 adds an AFTER INSERT trigger on the library user table. It generates a permanent `QuietLantern-` pseudonym with 24 hexadecimal characters from PostgreSQL UUIDv4 (90 random bits after fixed version/variant bits), retries unique collisions at most eight times, inserts the default member/active profile, and replaces the internal name and image. Failure rolls back the user statement. The existing immutable-profile trigger and column privileges still apply. No existing migrations or profile identities are rewritten. Low-level Phase 1 fixtures explicitly remove the generated profile before constructing their own integrity fixtures; authentication tests exercise the real automatic path.

Each lifecycle operation owns BEGIN/COMMIT on one runtime PoolClient. Better Auth receives Drizzle on that exact client with adapter `transaction:false`: the enclosing application transaction owns atomicity, rather than opening another connection or nesting BEGIN. Signup, credential creation, profile creation, token writes, fresh account locks, reset consumption, password update, session revocation and deletion share this boundary. A COMMIT that PostgreSQL reports as ROLLBACK is treated as failure. Concurrent signup is serialized by a transaction advisory lock on normalized email; concurrent reset claims serialize on the actual token row. Integration tests force a password-write failure after token consumption/session revocation and require every write to roll back.

## Public API and authorization

Only an explicit application allowlist calls library APIs. The library handler is never exported. Name/image/account changes, default deletion endpoints, social/OAuth endpoints, session/token JSON and reset callbacks are unavailable. Email change is disabled. Every mutation requires the canonical Origin, bounded JSON and validated fields. Auth cookies retain the library's signed HttpOnly, SameSite=Lax defaults and use Secure for HTTPS. Cookie session caching, IP tracking and user-agent retention are disabled; library log output is disabled.

Guards read the actual session and current user/profile on every call and hold row locks through the caller's mutation. Suspended/deleted users, revoked sessions and currently unverified users cannot pass member/admin/owner guards. Deletion requires a verified active account and the current password immediately before the transactional cascade. Password verification/hashing uses Better Auth's exported implementation (Node scrypt), not custom cryptography. Reset revalidates that the token's account still exists and is active, uses the library's single-use consume path, and revokes every session. Reset never verifies an unverified account.

## Email and enumeration

The provider-neutral adapter exposes `check` and `send`; SMTP is the local implementation, pinned nodemailer 10.1.7 with Mailpit capture. Registration/reset/resend check provider availability before looking up any address: a global outage produces the same 503 for known, duplicate and unknown addresses. A recipient-specific rejection after a successful preflight gets the same conditional 200 receipt as an ineligible address; all lifecycle writes still roll back. The UI explains conditional delivery and offers resend. This is a deliberate privacy tradeoff: a successful receipt is not proof that a new account or email exists.

Installed Better Auth 1.7.11 `runInBackgroundOrAwait` catches send exceptions even without a background task handler. We record callback failure in the request context, roll back before committing, and normalize both swallowed and directly thrown callback failures. Regression tests cover both paths. No recipient, token, password, hash or sender error is logged.

Verification emails use the library's supported JWT signer with a fresh random nonce because upstream's same-email/same-second JWTs are otherwise identical. A SHA-256 digest is bound to the account in the private verification table; verification consumes it transactionally, making links single-use and preventing a deleted account's link from verifying a re-registration. Reset tokens remain library-managed. Both links expire after one hour and use URL fragments, which the client immediately removes with history replacement; they never enter HTTP query strings, storage or redirects. All forms use POST and disabled submit controls until hydration, including when JavaScript is disabled, so native fallback cannot put credentials in a URL.

## Durable abuse boundaries and remaining phases

Database counters run in autocommit before lifecycle transactions so failed logins cannot undo throttling. Normalized emails (or session/token keys) are HMACed; no address or raw IP is retained in counters. Email/session/token budgets are 10 login attempts or 5 other action attempts per fixed 15-minute window; a separate shared direct-client bucket allows 120 per action/minute. Buckets expire with their window and existing maintenance removes expired records. Direct requests ignore all forwarding headers. This intentionally shares the client bucket until Phase 7 configures a restricted trusted proxy/Turnstile policy. It is durable local protection, not a production network-abuse certification.

Phase 3 owns locale/age/theme refinement. Legal summaries are explicitly local drafts, not reviewed launch policies. No map/composer, real SMTP provider, OAuth, deployment or public launch is introduced.

Primary references checked against installed code: [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [email/password](https://better-auth.com/docs/authentication/email-password), [database hooks](https://better-auth.com/docs/concepts/database), [hooks](https://better-auth.com/docs/concepts/hooks). Installed Next.js route, page, headers and Server/Client Component guides were read before implementation.
