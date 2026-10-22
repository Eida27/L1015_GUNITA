import pg from 'pg';
import { loadLocalEnv } from './load-env.mjs';
import { loadDatabaseEnv } from './database-env.mjs';
import { runMaintenance } from '../src/server/db/maintenance.mjs';

// Operator-only process. Never start this inside the web server or provide its
// migration credential to the web container. Each replica uses the DB job lock.
loadLocalEnv();
loadDatabaseEnv();
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error('Maintenance configuration unavailable');
let running = false;
let stopping = false;
async function tick() {
  if (running || stopping) return;
  running = true;
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    application_name: 'gunita-maintenance',
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await runMaintenance(client);
    console.log(JSON.stringify({ event: 'maintenance', ...result }));
  } catch {
    console.error(JSON.stringify({ event: 'maintenance_failed' }));
    if (process.argv.includes('--once')) process.exitCode = 1;
  } finally {
    await client.end();
    running = false;
  }
}
const timer = process.argv.includes('--once')
  ? null
  : setInterval(() => void tick(), 3600000);
for (const event of ['SIGINT', 'SIGTERM'])
  process.on(event, () => {
    stopping = true;
    if (timer) clearInterval(timer);
  });
await tick();
