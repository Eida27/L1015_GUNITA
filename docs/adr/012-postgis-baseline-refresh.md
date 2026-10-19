# ADR 012: Refresh the spatial baseline before location privacy work

Accepted Phase 1 sequencing adjustment. The [official docker-postgis project](https://github.com/postgis/docker-postgis) announced in October 2026 that Debian images moved to Trixie/PostGIS 3.6 and 3.5 tags stopped receiving updates. Implementing location privacy against the retired spatial baseline would require avoidable requalification later.

Compose now pins `postgis/postgis:17-3.6@sha256:d7053f57b0d62c427ffbf412208b6625317124d62eebf40672e990fea81e9d53`, independently inspected and pulled. Actual installed versions are PostgreSQL **17.11**, PostGIS **3.6.4**, GEOS runtime **3.14.1**, PROJ runtime **9.8.1**. PostgreSQL major 17 and `/var/lib/postgresql/data` volume layout are retained. This pin is a tested local baseline, not a production vulnerability certification.

Before upgrading, ownership labels and the `gunita_pgdata` mount were verified. The existing main DB held only extension data, no application tables/accounts/thoughts. A custom-format logical dump and globals dump from PostgreSQL 17.5/PostGIS 3.5.2 were retained as authenticated AES-256-GCM encrypted, ignored local artifacts, with a separate ignored key; plaintext local copies were removed. Neither secrets nor dump contents were printed or committed.

Only the owned DB container was recreated, preserving its volume. The supplied `update-postgis.sh` upgraded main and `template_postgis` extensions. The observed glibc collation mismatch 2.31 → 2.41 was resolved by `REINDEX SYSTEM`, `REINDEX DATABASE`, then `ALTER DATABASE ... REFRESH COLLATION VERSION` for gunita, postgres, template1 and template_postgis. Refreshing metadata without rebuilding indexes would be unsafe. All connectable database collation versions were verified against the current runtime.

The old encrypted logical dump was authenticated/decrypted only in memory and restored with real `pg_restore` to an isolated, guarded test database. New migrations and all 87 geometry imports succeeded there on PostGIS 3.6.4 with zero accounts. The test database was dropped; main remained intact. Migration, spatial coverage, immutable lifetime, cascade, runtime permissions and cleanup tests were rerun against the new image.

Future image changes require a fresh recoverable backup, release/extension/collation review and isolated restore proof. Never downgrade a mutated data volume to the old image. Restore to a fresh private volume with compatible binaries and validate before switching traffic. Public launch patch/security review remains a separate hardening gate.
