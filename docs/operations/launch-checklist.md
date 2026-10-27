# Production launch gate

All items are operator gates after explicit launch authorization. Passing local staging does not satisfy them.

- [ ] Select/pay for domain, VPS and necessary providers; review Philippines privacy/legal/community/crisis resources and boundary/island coverage.
- [ ] Pin release image digests, review resource/load evidence, provision private mounts and verify all volumes/secrets ownership and disk headroom. Confirm no demo thoughts/accounts.
- [ ] Set exact HTTPS `APP_ORIGIN`; remove every LOCAL_PREVIEW/LOCAL_PROXY/CONTAINER_PREVIEW setting. Production startup rejects test Turnstile keys and invalid origin/credentials.
- [ ] Configure licensed map style/attribution/quotas; verify CSP allowlisting matches actual tile/font/sprite hosts without broadening trust casually.
- [ ] Configure real SMTP credentials, verified sender, SPF/DKIM/DMARC, actual verification/reset delivery, session revocation and provider failure behavior.
- [ ] Configure real Turnstile site/secret, permitted production hostname and `registration`/`report` actions. Exercise actual Siteverify hostname/action/expiry/single-use failure checks; test keys cannot establish this gate.
- [ ] Create/verify a normal operator account and promote only through the operator CLI; verify a non-admin remains denied.
- [ ] Configure a genuine offsite destination, remote retention, backup alerts, protected separate key recovery, and a demonstrated authenticated quarantined restore/reconciliation drill.
- [ ] External uptime, certificate expiry, disk and job/moderation alerts have an incident owner; sanitized logs are purged within7days. Configure provider-specific alert thresholds and consent/retention reviews.
- [ ] Review DNS/TLS/origin isolation and authenticated-cache behavior below with actual outside-network tests.

## Cloudflare architecture

For a proxied deployment, DNS A/AAAA records point the chosen hostname to the VPS and Cloudflare's proxy is enabled. Cloudflare does not replace the VPS/database. Use [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), with an unexpired hostname-matching origin certificate issued by an accepted public CA or Cloudflare Origin CA. Caddy's ordinary production config uses automatic public certificate issuance once a real authorized domain exists. Origin-CA certificates instead require an explicitly configured private certificate/key mount and renewal procedure. Do not use the staging internal CA for production, Flexible TLS, disabled certificate verification, or claim automatic HTTPS succeeds before DNS/challenges are configured.

Plan origin firewall rules before changing `CADDY_BIND` from loopback: only reviewed Cloudflare IP ranges may reach ingress, SSH restricted to operator access, no5432/3000/SMTP/metrics. Account for ACME challenge reachability and certificate renewal when locking the origin. Update Cloudflare ranges via an operator-reviewed process; test direct-to-origin denial from an external network. For stronger authentication consider authenticated origin pulls with a reviewed certificate configuration. Do not trust a header merely because its name starts with `CF-`.

The shipped Caddy config strips `CF-Connecting-IP`, `True-Client-IP`, `Forwarded` and the forwarded client chain before passing requests to web. Caddy has no wildcard trusted-proxy setting, and the application retains `TRUST_PROXY=direct`: its existing anonymous abuse buckets intentionally share the direct-origin bucket and **do not provide verified per-client-IP rate limiting behind a proxy**. Before public launch, configure/test Cloudflare edge abuse controls and origin lockdown and document shared-bucket capacity. If later introducing per-client buckets, separately review Caddy `trusted_proxies`/strict right-to-left parsing for current Cloudflare CIDRs and application verification; reject arbitrary direct/spoofed forwarding headers. Phase9 does not silently change this identity contract. See [Caddy reverse proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

An optional [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) can use an outbound connector instead of public VPS ingress. It still requires authorized account/domain, private token management, hostname routes, certificate-validating origin connection and reliable service supervision. No Tunnel is provisioned by these files. Keep the connector off the database network and do not bypass TLS validation to make origin setup work.

## Cache validation

Start with Cloudflare cache bypass for HTML, all `/api/*`, `/dashboard/*`, `/settings`, `/admin/*`, `/thought/*` and authentication/reset/verification paths. Bypass any request with auth/session cookies or Authorization and any response with Set-Cookie; honor `private`/`no-store`. Do not enable Cache Everything or override personalized cache headers. Only immutable versioned `/_next/static/*` assets are candidates for edge caching initially. Public map caching can be optimized later with the existing strict DTO and bounded freshness contracts after explicit verification.

Use two real accounts plus a guest at the actual edge: request owner counts/private pages, then the same URL as the other user/guest; prove no cross-user data/cache hit. Delete/hide a thought and confirm detail becomes unavailable immediately. Verify locale/theme behavior, response headers and absence of content in previews/metadata. Test spoofed `X-Forwarded-For`/`CF-Connecting-IP` against the origin and confirm no trust escalation. See [Cloudflare dynamic/login caching guidance](https://developers.cloudflare.com/cache/troubleshooting/dynamic-content-and-login-issues/). Local Caddy verification cannot prove actual Cloudflare edge behavior.
