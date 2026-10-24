import pg from 'pg';
import { loadDatabaseEnv } from './database-env.mjs';
import { bootstrapAdmin } from './admin-bootstrap-lib.mjs';
const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== '--email' ||
  args[2] !== '--confirm-email' ||
  args[1] !== args[3]
) {
  console.error(
    'Usage: pnpm admin:bootstrap --email <exact verified email> --confirm-email <same exact email>',
  );
  process.exitCode = 1;
} else {
  loadDatabaseEnv();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('Operator database configuration required');
    process.exitCode = 1;
  } else {
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      await bootstrapAdmin(client, args[1], args[3]);
      console.log('Admin bootstrap completed.');
    } catch {
      console.error(
        'Admin bootstrap failed. Check operator credentials, exact verified active account and confirmation.',
      );
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  }
}
