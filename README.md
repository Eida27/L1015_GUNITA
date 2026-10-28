# Gunita

_A place for feelings left unsaid._

Gunita is an adults-only, Philippines-first map for short feelings, memories and unsent messages. Guests read after a versioned 18+ content acknowledgment; verified members publish, react and save thoughts. Locations are approximate, pseudonyms are permanent, and thoughts disappear after 30 days. English/Filipino UI and light/dark/system themes are included. The age checkbox is self-attestation; permanent pseudonyms allow correlation between posts.

The local feature set is implemented; [32 acceptance cases](docs/verification/acceptance-matrix.md) index its executed evidence. Phase 10 task review and whole-branch review are pending. **Gunita has not publicly launched.** Real providers, legal/privacy review, offsite operations and outside-network checks remain [launch prerequisites](docs/operations/launch-checklist.md). See [release notes](docs/RELEASE_NOTES.md) for validation limits.

## Boot locally

Use **Node 24.19.0** (pinned Docker baseline), **pnpm 11.25.0**, and Docker Desktop with Linux containers/Compose. The supported package range is Node `>=24.19.0 <25`; this handoff's bundled host runtime is **24.22.1**. Put the chosen Node 24 binary first in PATH. From a fresh checkout:

```powershell
pnpm install --frozen-lockfile
pnpm local
```

Open [Gunita](http://127.0.0.1:3000) and [Mailpit](http://127.0.0.1:8028). `pnpm local` generates random private settings only if absent, starts PostGIS/Mailpit, provisions separate operator/runtime roles, applies guarded migrations, imports 87 static areas, then starts the app. It preserves existing credentials/data. No cloud account, purchased domain, paid tile key, real email provider, demo account or demo thought is required. Local maps use the attributed [Natural Earth fixture](public/maps/README.md); registration/reporting call actual Cloudflare Siteverify with official test keys and therefore need network access.

Equivalent troubleshooting steps:

```powershell
pnpm setup
pnpm services:up
pnpm db:prepare
pnpm dev
```

Do not copy `.env.example` over generated settings. Web reads `.env`; operator/test commands also load private `.env.db`. Keep both ignored. Do not rotate a saved URL password without rotating its DB role. Keep app `PORT` and `APP_ORIGIN` consistent; use `127.0.0.1` consistently because `localhost` is a separate browser origin. Check listeners/Compose projects before a second checkout. Port changes after preparation must update both private files' matching URLs.

| Service             | Default local address                      | Persistence             |
| ------------------- | ------------------------------------------ | ----------------------- |
| App                 | `http://127.0.0.1:3000`                    | Host source and `.next` |
| PostgreSQL/PostGIS  | `127.0.0.1:55435`                          | `gunita_pgdata`         |
| Mailpit SMTP / UI   | `127.0.0.1:1028` / `http://127.0.0.1:8028` | Ephemeral captured mail |
| Optional HTTP Caddy | `http://127.0.0.1:8088`                    | Convenience profile     |

Development DB has an internal database network plus a separate DB-only host-access bridge for Docker Desktop loopback publishing. Production omits that bridge and has no DB/web host ports. `docker compose --profile proxy up -d caddy` enables the local HTTP proxy; intentionally configure its origin with `LOCAL_PROXY=true`. See [deployment](docs/operations/deployment.md) for the separate production template/TLS rehearsal.

## Evaluate with fictional accounts

1. Enter after adult self-attestation. Explore the Philippines, zoom clusters, and use the accessible list. A fresh database is intentionally empty.
2. Register a fictional `@test.invalid` address with a 12–128 character password. Wait for the official test widget. Open verification mail in Mailpit, follow the fragment link and verify; then sign in. The app assigns the permanent pseudonym.
3. Choose **Leave a thought**, accept current Guidelines when prompted, enter 1–280 graphemes, select emotion and manually pick Philippine land. Preview shows a broad place. No GPS is requested. Publish/share; edit text/emotion without extending lifetime.
4. Create/verify a second fictional account to change/remove reactions and save/remove the first account's thought. Only author/admin can request totals. Own thoughts/bookmarks are private; there is no public profile, author search or expired archive.
5. Guests report through the test widget; reports never automatically hide content. For a local moderator, follow [operator bootstrap/moderation](docs/operations/moderation.md). Use reversible hide/unhide for evaluation.

Password reset via Mailpit revokes existing sessions. Account deletion requires the current password and removes live authored/interacting data. Avoid deleting data you want retained. No pre-created credentials are published. Automated fixtures use guarded disposable databases.

## Run and maintain

Run hourly cleanup in a separate operator terminal:

```powershell
pnpm maintenance:run
```

It drains immediately and hourly; Ctrl+C stops gracefully. `pnpm maintenance:expire` performs one draining run. Web never schedules cleanup or receives maintenance credentials. `/api/health` checks liveness; `/api/ready` checks bounded DB readiness; both expose minimal uncached status.

For standalone smoke, stop the same owned dev listener first:

```powershell
pnpm build
$env:LOCAL_PREVIEW='true'
pnpm start
```

Clear the flag afterward (`Remove-Item Env:LOCAL_PREVIEW`). Always use `pnpm start`: validation precedes generated-server import. Preview stays loopback-only. Production requires verified HTTPS/provider configuration; builds need no paid credentials.

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm backup:verify
```

Read the [tests guide](docs/verification/tests.md) before E2 E: fixtures reserve ports 3000/3002 and must not overlap existing listeners/heavy jobs. On the recorded N5030/8 GB host use one worker, a 1536 MiB heap, `FORCE_COLOR=0`, and remove inherited `NO_COLOR`. [Evidence](docs/verification/phase-10.md) distinguishes full/scoped/distributed E2 E/manual Browser runs.

`pnpm services:down` stops this development project while preserving its DB volume. Do not add `--volumes` when retaining data. There is no broad prune/reset step. No GitHub remote/CI or production credentials are assumed.

## Operator handoff

- [Architecture](docs/architecture.md), [ADRs](docs/adr/README.md), [nine rulings](docs/verification/rulings.md).
- [Migrations/seed/rollback](docs/operations/database.md), [geographic provenance/license](assets/geo/README.md).
- [Backup/quarantined restore](docs/operations/backups.md), [retention](docs/operations/retention.md), [moderation](docs/operations/moderation.md).
- [Production package](docs/operations/deployment.md), [launch gates](docs/operations/launch-checklist.md), [reviews](docs/verification/reviews/README.md), [actual UI captures](docs/verification/ui/README.md).
- [Approved design](docs/specs/IMPLEMENTATION_DESIGN_SPEC.md) and [plan](docs/plans/IMPLEMENTATION_PLAN.md).

Automatic approval review rejected deletion of inactive `C:/Users/anula/AppData/Local/Temp/gunita-phase0-proof-6eeef800` twice as “blocked by policy.” Its owned services/networks/volume were removed; the directory remains untouched. See [Phase 0](docs/verification/phase-0.md).
