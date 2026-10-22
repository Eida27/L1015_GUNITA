import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { loadLocalEnv } from '../../scripts/load-env.mjs';
import { loadDatabaseEnv } from '../../scripts/database-env.mjs';
import { migrate } from '../../src/server/db/migrate.mjs';
import { seedGeo } from '../../src/server/db/seed-geo.mjs';
import { provisionRoles, grantRuntime } from '../../src/server/db/roles.mjs';

// Only tests import this module. Never creates fixtures in the configured database.
export async function createMapDatabase({ maxConnections = 1 } = {}) {
  loadLocalEnv();
  loadDatabaseEnv();
  const suffix = randomBytes(8).toString('hex');
  const name = `gunita_test_${suffix}`;
  const migrationRole = `gunita_test_m_${suffix.slice(0, 12)}`;
  const runtimeRole = `gunita_test_r_${suffix.slice(0, 12)}`;
  const password = randomBytes(24).toString('hex');
  const admin = new pg.Client({
    connectionString: process.env.BOOTSTRAP_DATABASE_URL,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  url.pathname = `/${name}`;
  const operator = new pg.Client({ connectionString: url.toString() });
  await operator.connect();
  await operator.query('CREATE EXTENSION postgis');
  await provisionRoles(operator, {
    migrationRole,
    runtimeRole,
    migrationPassword: password,
    runtimePassword: password,
  });
  url.username = migrationRole;
  url.password = password;
  const migrator = new pg.Client({ connectionString: url.toString() });
  await migrator.connect();
  await migrate(migrator);
  await migrator.end();
  await seedGeo(operator);
  await grantRuntime(operator, runtimeRole);
  url.username = runtimeRole;
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: maxConnections,
  });
  return {
    operator,
    pool,
    runtimeUrl: url.toString(),
    name,
    async close() {
      await pool.end();
      await operator.end();
      if (!/^gunita_test_[a-f0-9]{16}$/.test(name))
        throw new Error('Unsafe fixture cleanup');
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      for (const role of [runtimeRole, migrationRole]) {
        if (!/^gunita_test_[mr]_[a-f0-9]{12}$/.test(role))
          throw new Error('Unsafe fixture cleanup');
        await admin.query(`DROP ROLE "${role}"`);
      }
      await admin.end();
    },
  };
}
