import { spawnSync } from 'node:child_process';
import { setupLocal } from './setup-lib.mjs';
import { loadLocalEnv } from './load-env.mjs';
import { validateEnv } from './env.mjs';

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
  await import('./dev.mjs');
}
