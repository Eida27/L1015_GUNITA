import { readFile } from 'node:fs/promises';
import { loadServiceSecret } from './container-secrets.mjs';

const command = process.argv[2];
const service = ['web', 'maintenance', 'backup', 'metrics'].includes(command)
  ? command
  : 'operator';
try {
  if (
    ![
      'web',
      'maintenance',
      'backup',
      'metrics',
      'initialize',
      'migrate',
      'seed',
      'admin',
      'restore',
      'keygen',
    ].includes(command)
  )
    throw new Error('Unknown container command');
  loadServiceSecret(
    service,
    await readFile(`/run/secrets/${service}_env`, 'utf8'),
  );
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = '0';
  if (command === 'web') await import('./start.mjs');
  else if (['maintenance', 'backup', 'metrics'].includes(command)) {
    process.env.OPERATIONS_JOB = command;
    await import('./operations.mjs');
  } else if (command === 'initialize')
    await import('./initialize-production.mjs');
  else if (command === 'admin') {
    process.argv.splice(1, 2, 'scripts/admin-bootstrap.mjs');
    await import('./admin-bootstrap.mjs');
  } else if (['restore', 'keygen'].includes(command)) {
    process.argv[2] = command;
    await import('./backup.mjs');
  } else {
    process.argv[2] = command;
    await import('./db.mjs');
  }
} catch {
  console.error(JSON.stringify({ event: 'container_command_failed' }));
  process.exitCode = 1;
}
