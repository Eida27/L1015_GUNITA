import { spawnSync } from 'node:child_process';
import { setupLocal } from './setup-lib.mjs';
import { loadLocalEnv } from './load-env.mjs';
import { validateEnv } from './env.mjs';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

await setupLocal(process.cwd());
loadLocalEnv();
validateEnv(process.env, 'development');
const result = spawnSync(
  'docker',
  ['compose', 'up', '-d', '--wait', 'db', 'mailpit'],
  { stdio: 'inherit' },
);
if (result.status !== 0) {
  console.error(
    'Local services did not become ready. Check Docker Desktop and the documented ports.',
  );
  process.exitCode = 1;
} else {
  const database = spawnSync(process.execPath, ['scripts/db.mjs', 'prepare'], {
    stdio: 'inherit',
  });
  if (database.status !== 0) process.exitCode = 1;
  else {
    process.env.DATABASE_URL = parseEnv(
      readFileSync('.env', 'utf8'),
    ).DATABASE_URL;
    await import('./dev.mjs');
  }
}
