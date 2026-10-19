import pg from 'pg';
import { setupLocal } from './setup-lib.mjs';
import { loadLocalEnv } from './load-env.mjs';
import { loadDatabaseEnv, prepareLocalDatabaseEnv } from './database-env.mjs';
import { provisionRoles, grantRuntime } from '../src/server/db/roles.mjs';
import { migrate } from '../src/server/db/migrate.mjs';
import { seedGeo } from '../src/server/db/seed-geo.mjs';
import { cleanupExpired } from '../src/server/db/cleanup.mjs';

const command = process.argv[2];
async function connection(url, fn) {
  if (!url) throw new Error('Required database connection setting missing');
  const client = new pg.Client({
    connectionString: url,
    application_name: 'gunita-operator',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
try {
  if (!['prepare', 'migrate', 'seed', 'expire'].includes(command))
    throw new Error('Unknown database command');
  if (command === 'prepare') {
    await setupLocal(process.cwd());
    await prepareLocalDatabaseEnv();
  }
  loadLocalEnv();
  loadDatabaseEnv();
  if (command === 'prepare' && process.env.RUNTIME_DATABASE_URL)
    process.env.DATABASE_URL = process.env.RUNTIME_DATABASE_URL;
  if (command === 'prepare') {
    const migration = new URL(process.env.MIGRATION_DATABASE_URL),
      runtime = new URL(process.env.DATABASE_URL);
    await connection(process.env.BOOTSTRAP_DATABASE_URL, async (client) => {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
      await provisionRoles(client, {
        migrationRole: decodeURIComponent(migration.username),
        runtimeRole: decodeURIComponent(runtime.username),
        migrationPassword: decodeURIComponent(migration.password),
        runtimePassword: decodeURIComponent(runtime.password),
      });
    });
  }
  await connection(process.env.MIGRATION_DATABASE_URL, async (client) => {
    if (command === 'prepare' || command === 'migrate') {
      const count = await migrate(client);
      await grantRuntime(
        client,
        decodeURIComponent(new URL(process.env.DATABASE_URL).username),
      );
      console.log(`Database migrations applied: ${count}.`);
    }
    if (command === 'prepare' || command === 'seed')
      console.log(`Geographic areas imported: ${await seedGeo(client)}.`);
    if (command === 'expire')
      console.log(JSON.stringify(await cleanupExpired(client)));
  });
} catch {
  // pg errors may carry SQL/detail/body values. Never print those objects.
  console.error(
    'Database operation failed. Check private connection settings, migration/seed drift and operator instructions.',
  );
  process.exitCode = 1;
}
