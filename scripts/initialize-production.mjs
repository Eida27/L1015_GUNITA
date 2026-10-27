import pg from 'pg';
import { provisionRoles, grantRuntime } from '../src/server/db/roles.mjs';
import { migrate } from '../src/server/db/migrate.mjs';
import { seedGeo } from '../src/server/db/seed-geo.mjs';

// Explicit operator command; no local setup, fixture users, or thought seeding.
const migration = new URL(process.env.MIGRATION_DATABASE_URL);
const runtime = new URL(process.env.DATABASE_URL);
const bootstrap = new pg.Client({
  connectionString: process.env.BOOTSTRAP_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await bootstrap.connect();
  await bootstrap.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await provisionRoles(bootstrap, {
    migrationRole: decodeURIComponent(migration.username),
    runtimeRole: decodeURIComponent(runtime.username),
    migrationPassword: decodeURIComponent(migration.password),
    runtimePassword: decodeURIComponent(runtime.password),
  });
} finally {
  await bootstrap.end();
}
const client = new pg.Client({
  connectionString: migration.toString(),
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  const applied = await migrate(client);
  await grantRuntime(client, decodeURIComponent(runtime.username));
  const areas = await seedGeo(client);
  console.log(
    JSON.stringify({ event: 'database_initialized', applied, areas }),
  );
} finally {
  await client.end();
}
