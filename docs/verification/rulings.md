# Controller rulings and decision costs

These are the ten exact anchored controller rulings from the execution ledger, in original order. Text below each heading is preserved verbatim; short explanations and ADR/runbook pointers make the decisions usable after scratch cleanup. These are implementation decisions, not new scope or launch approval.

## 1. Early PostGIS refresh

Avoided building geographic privacy on a retired image; retained a recoverable backup and paid the extension/collation compatibility cost. See [decision context](../adr/012-postgis-baseline-refresh.md).

Phase1 Ruling: refresh the PostgreSQL17/PostGIS image baseline during Phase1, ahead of Phase8 currency hardening, before Phase4 privacy code depends on GEOS/PostGIS behavior. Upstream source https://github.com/postgis/docker-postgis verified2026-10-20 states *-3.5 tags retired and supported17-3.6 usesDebiantrixie/PostGIS3.6.4; collation/extension upgrades may be needed. Preserve PGmajor17 and existingvolume, verifydata inventory, take recoverable backup, pin realdigest, perform scoped updates and rerun allDB/geo tests. Why: avoid building privacy behavior on retiredimage. Costifwrong: extra compatibility/migrationwork; backup retained. Implementer owns change; no destructive volume reset authorized.

## 2. Sanitize standalone now

Private operator credentials made artifact sanitization immediate work. Build/start regression proof bounds the packaging compatibility cost. See [decision context](../adr/011-database-integrity.md).

Phase1 Ruling: fix standalone private-configuration packaging now rather than defer toPhase8. Controller metadata check found .next/standalone/.env exists (no contentprinted). Addtest-first buildsanitization/currentNextexclusions for privateenv/role files, preserve rootignoredconfig andrequiredstaticassets, ensure pre-import runtimeloading stillworks, scanactualartifacts withoutprintingsecrets. Why: global no-secrets-generated-artifacts invariant andnewruntime/migrator credentials. Costifwrong: extra postbuild/runtimeconfig compatibilitywork; regressiontests andactualbuild/start mustprovebehavior. No deploymentorpublicexposure occurred.

## 3. Consent with the first composer

Safe publication required current Guidelines before Phase7. The extra UI/integration work was reused by moderation. See [decision context](../adr/015-moderation-and-verification.md).

Ruling: implement the minimum current-version Community Guidelines acceptance UI and server consent check in Phase5 with the first working composer, before Phase7 anti-abuse refinement. The spec requires consent before every new publish, while the plan lists its UI in Phase7; Phase5 must already prove a complete safe publishing slice. Phase7 will review/reuse the same versioned contract. Cost if wrong: extra Phase5 UI/integration work and later adjustment, with no published content permitted to bypass consent.

## 4. Publication isolation

The reproduced fixed-snapshot bypass required explicit READ COMMITTED support. Future broader isolation requires a reviewed serialization strategy. See [decision context](../adr/011-database-integrity.md).

Ruling: require READ COMMITTED for publication transactions and fail closed on other isolation modes in a new migration. This is the smallest explicit contract preventing the reproduced fixed-snapshot quota bypass, while preserving applied checksums and ordinary runtime behavior. Cost if wrong: future publishing services must use READ COMMITTED or deliberately implement/test a broader serialization strategy; unsupported modes reject safely.

## 5. Tiny-land privacy threshold

A versioned 1km² threshold avoids selecting tiny fragments; possible over-coarsening/inference remains a geography/privacy launch review. See [decision context](../adr/014-coarse-map-locations.md).

Ruling: adopt an initial versioned tiny-land threshold of 1 square kilometre, escalating through the approved density resolutions before a deterministic broad-province fallback — the spec deliberately leaves exceptionally-small geometry thresholds unspecified, and this conservative local rule avoids choosing an isolated fragment's interior point as the final location. Persist only effective fallback metadata, never the original tiny origin cell. Cost if wrong: locations may be over-coarsened or some small settlements may remain inferable; geography/privacy review and threshold adjustment remain public-launch gates, with no formal anonymity claim.

## 6. Published-only private totals/list

The mandatory expiry/count predicate takes priority over optional hidden author rows. Authors cannot rediscover hidden posts through this dashboard. See [decision context](../adr/README.md).

Ruling: use published and unexpired thoughts for both the own-thought dashboard list and every reaction-count endpoint, omitting the optional hidden-post dashboard rows in Phase6 — spec4.3 explicitly applies the visibility predicate to counts, and this smallest permitted scope avoids contradictory totals or misleading zero-count hidden entries without widening existing owner mutation behavior — cost if wrong: authors cannot rediscover a hidden thought or see its hide notice through this dashboard; any later optional hidden-author view needs deliberately separate count/management semantics. Protected Phase7 admin report inspection may still show nonexpired hidden targets, without widening count predicates or expiry.

## 7. Official local Turnstile path

Actual Siteverify still runs; the envelope gives local replay/action/age proof. It cannot establish human validity or production provider integration. See [decision context](../adr/015-moderation-and-verification.md).

Ruling: permit an explicit official Turnstile test path only for a loopback APP_ORIGIN under validated local execution (development/test, or production with LOCAL_PREVIEW), while always calling actual Siteverify; accept its observed example.com hostname and absent action only there. Since the official widget's static dummy token otherwise collides with a durable single-use guard, locally adapt each callback into a small versioned action/time/cryptographic-nonce envelope, send the complete envelope to actual Siteverify, validate its action and at most300-second age, and enforce HMAC replay uniqueness across registration and reports. Production uses unchanged provider tokens, strict expected hostname/action/expiry, and rejects known test keys/local-envelope prefixes. Document the official spent-secret rejection fixture and exact local format without a general provider framework — actual official test responses differ from illustrative docs, and local production-artifact verification still needs actual upstream calls and meaningful replay/expiry behavior — cost if wrong: this synthetic local path proves plumbing and guards but cannot prove human/bot validity or real production-provider integration; it adds a small explicit test-mode contract, and production keys/domain/provider proof remain launch-blocking.

## 8. Original reporter category

Deletion must not falsely relabel members as guests. The guarded migration costs explicit reconciliation for ambiguous legacy NULL rows without retaining identity. See [decision context](../adr/015-moderation-and-verification.md).

Ruling: persist each report's original guest/member category separately from its nullable reporter identity, preserving that fact when account deletion clears the identity; use a small guarded migration and explicit creation value without adding identity or content retention. Backfill still-linked legacy reports as member, but fail clearly on any historical unclassified NULL reporter rows rather than guessing guest or deleting evidence; preflight actual owned database inventory and back up before applying the guarded main migration, leaving the unknown database untouched — the required reporter category should not become false merely because its identity was correctly unlinked — cost if wrong: an extra schema/inventory/compatibility change and operator reconciliation for ambiguous legacy rows; category alone remains after identity deletion within the existing report lifetime.

## 9. Internal container preview bind

Separate Caddy needs an internal listener. The validated flag costs launcher tests and careful ingress configuration; local rehearsal is never public-provider proof. See [decision context](../operations/deployment.md).

Ruling: keep the existing loopback LOCAL_PREVIEW/LOCAL_PROXY and official Turnstile test contract for Phase9's required dummy-secret production-image rehearsal, and add only an explicit validated container-preview bind option so the app can listen on its internal container interface behind Caddy. Require LOCAL_PREVIEW plus the existing exact loopback APP_ORIGIN; reject the option without that mode, preserve production validation and Turnstile verification unchanged, publish neither web nor DB ports, and bind only the rehearsal Caddy port to host loopback with actual Compose/network assertions — a loopback-only listener inside a container cannot be reached by the separate Caddy container, while a new staging hostname/auth mode would widen more contracts than needed — cost if wrong: extra launcher/config tests and an operator configuration hazard if a future user publishes the internal web port; the explicit mode and local-only rehearsal wiring must not be mistaken for production validation or public-provider proof.

## 10. Actionable chronological report queue

See [ADR 016](../adr/016-edit-concurrency-and-report-discovery.md) for the private cursor and edit precondition contracts.

Ruling: make the moderator queue default to open and reviewing reports in oldest-first creation-time order with report ID as a stable tie-breaker, and expose explicit status/history views with filter-bound keyset cursors. The spec requires an actionable manual queue but leaves its direction/default unspecified; prioritizing oldest pending work prevents resolved history from obscuring it while preserving history inspection. Cost if wrong: this changes the private queue cursor contract and prioritizes aged reports over newer ones; clients must reset pagination when switching views, and operators may prefer a different prioritization after real staffing review. It adds no notifications, automatic hiding, or new identity retention.
