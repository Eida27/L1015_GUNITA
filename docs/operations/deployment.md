# Portable VPS template and local rehearsal

This is a deployment package, not a live deployment. No domain, VPS, real provider credentials or offsite service has been selected. The root development Compose/database and retained Browser fixtures are independent of this package. Never reuse their volumes for rehearsal.

## Images and topology

Build with Node24.19.0, pnpm11.25.0 and the committed lockfile. `Dockerfile` has separate `web` and `operator` targets. The web image contains sanitized Next standalone output and the configuration-validating launcher. It runs as UID/GID10001, with a read-only root filesystem, dropped capabilities and no operator credential. Do not invoke generated `server.js` directly. There are no secret build arguments. `.dockerignore` allowlists build inputs, excluding environment files, local receipts, source control, keys and archives from every stage.

`compose.prod.yml` contains a private internal database network, an internal proxy network and a separate outbound network for approved external providers. PostgreSQL has no host port and only joins the internal database network. Web has no host port. Caddy is the only ingress; its default host binding is loopback until the operator explicitly authorizes ingress. Maintenance, backup and metrics have no public listeners. No Docker socket is mounted.

Starting resource guidance: evaluate a 2vCPU/4GiB VPS with SSD storage and adequate transfer allowance. The configured process ceilings total roughly3GiB plus the host/Docker; allow extra filesystem cache, disk space, and backup headroom. Build on a separate builder or reserve extra memory: build heap1536MiB, one Next worker. These are starting budgets, not a tested production capacity or SLA. Measure realistic load, memory peaks, disk/WAL growth and network latency before public access. Backup remains limited to128MiB plaintext and120second tool deadlines; do not remove those bounds to mask capacity failure.

## Prepare production secrets after provider selection

Use a dedicated deployment directory and an external private secrets directory, for example `/srv/gunita/secrets`, never inside the checkout or image context. Copy `infra/production.env.example` to an external operator-only configuration file and fill nonsecret origins/provider URLs. Do not use the existing developer `.env` as the production Compose input. Always pass `--env-file` explicitly. `docker compose config` contains paths and public settings, not secret contents; never print secret files or interpolate secrets into Compose environment blocks.

Create these individual secret files, owned/readable by container UID10001 on the Linux host (directory0700, files0600). Compose file-backed secrets are bind mounts; do not rely on `uid`/`mode` fields to repair host permissions. PostgreSQL's password file must be readable by its image's postgres user: grant only that image UID access through a dedicated file/ACL and verify access; it must not be mounted into web.

| File                | Keys/content                                                                                                       | Granted service             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `postgres_password` | Random bootstrap database password, raw single line                                                                | db                          |
| `web.env`           | `DATABASE_URL` for `gunita_app`; random `BETTER_AUTH_SECRET`; `TURNSTILE_SECRET_KEY`; `SMTP_USER`; `SMTP_PASSWORD` | web                         |
| `maintenance.env`   | `MIGRATION_DATABASE_URL` for `gunita_migrator`                                                                     | maintenance                 |
| `metrics.env`       | `MIGRATION_DATABASE_URL`                                                                                           | private metrics             |
| `backup.env`        | `BACKUP_DATABASE_URL` for operator/full database dump                                                              | backup                      |
| `operator.env`      | `BOOTSTRAP_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DATABASE_URL` (runtime), `RESTORE_OPERATOR_DATABASE_URL`      | explicitly invoked operator |

URLs use internal host `db`, port5432, database`gunita`. Generate different high-entropy passwords of at least32characters for bootstrap, migrator and runtime; URL-encode credentials. Use a random auth secret of at least32characters. Service secret files reject unknown keys before changing process environment. Never give the operator file to web. Metrics uses an operator-only process without adding grants to web.

The full database backup needs the bootstrap/operator connection, including access to the PostGIS image's additional extension schemas such as `tiger`. The migrator's application-schema permissions are insufficient for this full dump. Grant the dedicated backup secret only to the backup service; do not widen web privileges, omit extension schemas, or put this credential into web settings.

Prepare the actual separate-host backup mount at `BACKUP_ARCHIVE_PATH` before Compose: directory0700 writable by UID10001, private-file modes and reliable exclusive-create/rename semantics. Verify the remote mount is present, independently hosted and monitored. A local directory at this path is NOT an offsite backup. Prevent silent fallback to a local directory when a mount drops (host mount dependency/monitor and fail-closed bind path). Object-storage options need a separately selected and validated mount/transfer integration; this template does not silently purchase or configure one.

All commands below use the same explicit project/config. A shell convenience function may wrap:

```sh
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml config --quiet
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml build operator
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml build web
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml up -d --wait db
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml run --rm volume-init
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml run --rm operator initialize
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml run --rm operator keygen
```

`initialize` is an explicit operator action: provision distinct roles, run checksum/drift-guarded migrations and import87versioned geographic areas. It creates no demo accounts or thoughts and does not rotate existing role passwords. `volume-init` only changes the roots of the dedicated state/key volumes; it never recursively changes an existing data tree or the offsite mount. The key is a private random32byte file in a separate key volume, outside `/archives` and `/app`. `keygen` refuses overwrite: run it once, preserve a protected recovery copy separately, and never use `down -v` on a deployment containing data or keys.

After configuring origin TLS/providers and completing the launch checklist, start web/Caddy/maintenance/backup/metrics with `up -d --wait`. Preserve image digests and config checksums as the release record. Caddy's persistent volumes own certificate material; keep them private. Avoid raw Docker/DB logs in support tickets.

## Migrations, rollback, first admin

Before updates, record the current image digest and schema ledger. Stop and drain the scheduled backup with `stop backup` before any one-off backup. Wait for Compose to return successfully and confirm the scheduled container is stopped; investigate any forced termination before proceeding. Never run two backup workers against the shared state/archive volumes. Then create a fresh encrypted backup with `run --rm --no-deps backup backup --once` and verify its successful result/archive. If it fails, abort the update and resume the scheduler with `up -d --wait backup`, checking its health; do not leave daily backups disabled.

After the verified backup, leave the scheduler stopped and stop web/maintenance/metrics while migrating. Run `run --rm operator migrate`; run `operator seed` only for the reviewed geographic import. Failure leaves the guarded migration transaction rolled back; inspect the generic failure privately. After either a successful upgrade or a reviewed rollback/aborted update, resume the compatible web/maintenance/backup/metrics services with `up -d --wait` and verify their health. Never edit recorded migration checksums or bypass drift checks. For a standalone manual backup outside an upgrade, use the same stop/drain → one-off → resume sequence, including resumption on failure.

For an application-only rollback, restore the previously recorded compatible image digest and restart the same services. A schema-incompatible rollback requires maintenance mode and an isolated restore; there is no automatic down-migration or permission to point web at a restored database. Follow [backup quarantine/reconciliation](backups.md): authenticate archive, restore to a new disconnected database, clean expiry/sessions/tokens, reconcile authoritative post-snapshot deletions/moderation, review grants and perform release checks before any deliberate traffic cutover. If reconciliation is unavailable, remain quarantined.

First admin: create a normal account through the production registration/real email verification flow, then use the operator-only CLI with an exact, verified active email and matching confirmation:

```sh
docker compose --env-file /srv/gunita/production.env -p gunita-production -f compose.prod.yml run --rm operator admin --email 'operator@example.invalid' --confirm-email 'operator@example.invalid'
```

The email is an operator command argument, so use a private administrative terminal and protect shell history. It is never included in application logs. Confirm privileged access and that another ordinary member cannot access admin routes. Never seed synthetic thoughts into production. Rehearsal uses fictional data only in its isolated database and removes its fixtures.

## Local staging rehearsal

Requires Docker Desktop/Compose supporting `!override`, Node24.19 and the existing dependencies. One heavy command at a time on the low-memory development host:

```sh
node scripts/rehearse.mjs prepare 8449
node scripts/rehearse.mjs config
node scripts/rehearse.mjs build
node scripts/rehearse.mjs start
node scripts/rehearse.mjs verify
node scripts/rehearse.mjs stop
```

Prepare creates random dummy credentials in a private OS-temp directory and an exclusive `.local/phase-9-rehearsal.json` ownership receipt. It refuses to replace an existing receipt. The unique `gunita-rehearsal-*` project has its own PostgreSQL/key/state/archive/Caddy volumes; no main volumes are named or attached. Staging overrides bind only Caddy to127.0.0.1. Mailpit has no host ports. The archive volume is explicitly `local-simulation`, not offsite. Keep the receipt while resources exist; restart with scoped Compose `up` after the initial key generation instead of repeating `start`/`keygen`. `stop` preserves all owned volumes for review. Any eventual removal must first verify the exact project labels and volume names; never use a broad prune.

The image runs `NODE_ENV=production`, `LOCAL_PREVIEW=true`, `LOCAL_PROXY=true`, `CONTAINER_PREVIEW=true`, exact loopback HTTPS origin and official Turnstile test keys. The extra container flag only chooses the internal bind address; it is rejected without the local preview/proxy constraints. Production defaults and Siteverify behavior remain unchanged. Local preview is NOT proof of production credentials, real email delivery, licensed tiles or production Turnstile hostname/action. Caddy uses an internal CA with `skip_install_trust`; verification trusts only the copied public CA for each HTTPS request, including certificate and hostname validation. No OS/browser root installation, interstitial bypass or insecure TLS option is needed. Do not open this self-signed endpoint in a browser expecting normal system trust.

The verification checks private topology, CA/hostname-verified health/readiness/auth rejection/HSTS/no-store, UID10001, secret isolation, actual initialized data/grants, first-admin controls, scheduled archive health, encrypted backup/tamper rejection/quarantined restore, and maintenance lock/expiry deletion. It stops and drains the scheduled backup before the operator probe's backup, then resumes it even if the probe fails. A successful probe verifies the owned synthetic user is absent; cleanup failure returns nonzero and prevents a new verified receipt. Rehearsal archive snapshots remain private until7day rotation, as the retention policy discloses.

## Operations and alerting

Maintenance starts immediately and runs hourly, keeping the existing session advisory lock across bounded drain batches. Backup starts immediately and runs daily, preserving encrypted7day rolling archives. Failed jobs retry after5minutes, remain unhealthy, and retain the prior success timestamp. The awaited scheduler never overlaps a job and drains in-flight work on SIGTERM; stop grace is150seconds. Keep one backup replica. Maintenance remains safe against multiple replicas through its database lock.

Private metrics emits fixed aggregate JSON every60seconds: process uptime, web/DB readiness, expired live rows, oldest cleanup lag, moderation queue size/age, backup and maintenance success/freshness, and archive free bytes. It does not emit identities, email, content, IP, coordinates, raw queries or secrets, and exposes no HTTP metrics endpoint. Web's existing fixed route-group/status/duration logs support latency/error summaries; SMTP result logs remain generic. No user-tracking analytics is added.

Alert on web/DB unready; job failure; missing backup or age>25hours; maintenance success age>65minutes; cleanup lag>1hour; any expiry rows increasing across a cleanup cycle; moderation queue oldest>24hours (initial staffing target); and disk free<20%. Docker healthchecks surface state but **Docker does not automatically restart unhealthy containers**. `restart: unless-stopped` handles exits; arrange an external uptime/alert service and human incident response before launch. Monitor TLS certificate expiry externally as well. These integrations/notifications are launch tasks, not claimed configured by rehearsal.

Production Compose uses the journald driver. Before launch on a dedicated systemd VPS, review and install the shipped `infra/journald/60-gunita-retention.conf` into `/etc/systemd/journald.conf.d/`, reload journald, and verify the effective `MaxRetentionSec=7day`, rotation and actual retained event timestamps. This affects the default HOST journal, including other services: do not apply blindly on a shared machine. Inspect `systemd-analyze cat-config systemd/journald.conf`, `journalctl --disk-usage`, and oldest Gunita events after rotation; prove time-based disposal at the chosen host before public use. Journald alone does not enforce7days without this configuration and verification. No host configuration was installed during local rehearsal. On a non-systemd host, provide an explicit collector/log-driver override with the same verified7day limit; public launch remains blocked until it exists. Staging explicitly overrides to the bounded local driver (15MiB/service); those synthetic rehearsal container logs are short-lived and must be removed with the exact owned containers after review, within7days. Do not use a broad Docker prune. Caddy access logs are disabled and its default error logger is discarded to prevent URI/header/IP leaks. Use readiness/aggregate metrics and private infrastructure diagnostics for incidents.

## Cloudflare and provider choices

See [Cloudflare/network launch checklist](launch-checklist.md). The template is provider neutral. Options checked against official documentation on2026-10-27 (prices, availability, quotas and terms must be rechecked when purchasing):

| Capability         | Options and selection criteria                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Licensed tiles     | [MapTiler Cloud](https://www.maptiler.com/cloud/) or authorized self-hosted tiles; choose MapLibre-compatible style, attribution, allowed hostnames and explicit request/bandwidth limits. No unlimited public OSM tile assumption.                                                                                                  |
| Transactional SMTP | [Amazon SES SMTP](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html) or [Postmark](https://postmarkapp.com/developer/user-guide/send-email-with-api/send-a-single-email); evaluate region, verified sender/domain, delivery/reputation, TLS and retention. Current app uses SMTP, not a newly implemented provider API. |
| Domain             | [Cloudflare Registrar](https://www.cloudflare.com/domains/) or another registrar supporting the desired TLD; compare renewal, DNS control, transfer and account recovery.                                                                                                                                                            |
| VPS                | [Hetzner Cloud](https://www.hetzner.com/cloud/) or [DigitalOcean Droplets](https://www.digitalocean.com/products/droplets); compare Philippines latency, supported region, total RAM/storage/egress/backups and operational support, not headline price.                                                                             |
| Offsite backup     | A separate managed host/mount or [Backblaze B2](https://www.backblaze.com/cloud-storage) via a separately reviewed transfer/mount integration; verify private modes, encryption, remote persistence,7day deletion/lifecycle behavior and a real restore.                                                                             |

No free tier, price or provider capacity is promised. Nothing has been purchased or deployed.
