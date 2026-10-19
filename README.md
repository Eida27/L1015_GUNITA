# Gunita

_A place for feelings left unsaid._

Gunita is being built as a calm, Philippines-first space for adults to leave short thoughts on an approximate map. This repository currently contains the **Phase 0 local foundation**. Accounts, the age/content acknowledgment, map, publishing, and moderation are subsequent phases; no user thoughts are seeded or displayed by this foundation.

The approved [design specification](docs/specs/IMPLEMENTATION_DESIGN_SPEC.md) and [implementation plan](docs/plans/IMPLEMENTATION_PLAN.md) define the product. Architecture and exact versions are recorded in [ADRs](docs/adr/README.md).

## Local setup

Install **Node 24.19.0 LTS**, **pnpm 11.25.0**, and Docker Desktop with Linux containers/Compose. Set the Node 24 binary first in `PATH` if multiple Node versions exist. The package engine rejects other major versions. Activate the pinned pnpm using your existing package-manager installation (`npm install --global pnpm@11.25.0` if needed).

From a fresh clone, with Docker Desktop running:

```powershell
pnpm install --frozen-lockfile
pnpm local
```

`pnpm local` generates a fresh untracked `.env` if absent, starts healthy PostGIS and Mailpit containers, then starts Next.js. It never overwrites an existing `.env`, reinitializes an existing database, or deletes a volume. Open [Gunita](http://127.0.0.1:3000) and [Mailpit](http://127.0.0.1:8028). Stop the app with Ctrl+C; services continue until `pnpm services:down`.

Equivalent separate commands are useful when troubleshooting:

```powershell
pnpm setup
pnpm services:up
pnpm dev
```

`.env.example` is a reference with placeholders, not runnable shared credentials. Setup generates random local database/auth secrets. Keep `.env` private. To change a port, edit `PORT` plus `APP_ORIGIN` together, `DB_PORT` plus the matching `DATABASE_URL` port together, and/or `SMTP_PORT` and `MAILPIT_UI_PORT`. Do not change an existing database password without rotating the actual role password too. Use `127.0.0.1` consistently; switching between `localhost` and `127.0.0.1` creates different browser origins.

| Service              | Default address         | Persistence                        |
| -------------------- | ----------------------- | ---------------------------------- |
| App                  | `http://127.0.0.1:3000` | Source and `.next` on host         |
| PostgreSQL/PostGIS   | `127.0.0.1:55435`       | Compose `gunita_pgdata` volume     |
| Mailpit SMTP         | `127.0.0.1:1028`        | Development only, captured locally |
| Mailpit web          | `http://127.0.0.1:8028` | Ephemeral messages                 |
| Optional local Caddy | `http://127.0.0.1:8088` | No production TLS configured       |

The `gunita_database` network is internal. The DB also joins a separate DB-only `gunita_host-access` bridge so Docker can publish the loopback port to the host app; development DB egress is therefore permitted. Mailpit and Caddy do not join either DB network. Production must omit this host-access bridge and the published database port. Container and volume names are scoped by Compose project `gunita`; use another project name when intentionally running a second checkout. Check existing resources and port listeners before starting another instance.

Optional local HTTP proxy: `docker compose --profile proxy up -d caddy`. The proxy targets the host app; when testing through it, intentionally use its origin in `APP_ORIGIN`, set `LOCAL_PROXY=true`, and keep `PORT=3000`. This profile is a local convenience, not a deployment configuration.

## Checks

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Vitest exercises real HTTP/body validation, safe errors, environment enforcement and setup side effects. Playwright requires the local services to be running, starts a local dev server unless one already exists at the configured origin, then checks real database readiness through the host app, the labeled foundation page, health navigation, keyboard focus and mobile overflow. Its default origin is `http://127.0.0.1:3000`; adjust the config intentionally if changing app ports. Browser acceptance in the Codex Browser remains separate evidence.

`GET /api/health` reports only process liveness. `GET /api/ready` reports database readiness (503 if no DB connection); neither exposes connection strings or diagnostics. Phase 0 does not apply application migrations. `db:migrate`, `db:seed:geo`, `maintenance:expire`, and `backup:verify` are later-phase deliverables and are intentionally not placeholder success scripts.

## Production-binary smoke test

```powershell
pnpm build
$env:LOCAL_PREVIEW='true'
pnpm start
```

The preview runs the standalone build on loopback using local generated settings; clear `LOCAL_PREVIEW` afterward. `pnpm start` validates configuration **before** importing `.next/standalone/server.js`. Without local preview it requires an HTTPS origin, a database URL, non-placeholder auth secret, production Turnstile keys, SMTP sender/host and HTTPS map style. Errors list field names only. Building does not require paid provider credentials.

No production deployment or readiness is claimed. Later phases must provide verified SMTP delivery, authorized map tiles, boundary provenance, auth/permissions, expiry, moderation, reviewed legal/help content, encrypted offsite backups with restore proof, TLS and monitoring before launch. A multi-stage web Docker image and production Compose are planned in the deployment phase.

## Teardown

```powershell
pnpm services:down
```

This removes only this Compose project's containers/networks and **retains** `gunita_pgdata`. The explicit destructive reset `docker compose down --volumes` deletes the local database; use only when you intend that deletion. No cleanup script prunes unrelated Docker resources. No remote is configured and GitHub CI is deferred; local checks require no secrets beyond generated local settings.
