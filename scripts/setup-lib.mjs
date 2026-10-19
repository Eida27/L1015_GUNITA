import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

export async function setupLocal(directory) {
  let file;
  try {
    file = await open(join(directory, '.env'), 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  const password = randomBytes(24).toString('hex');
  try {
    await file.writeFile(
      [
        '# Generated local-only settings. Do not commit or share.',
        'APP_ORIGIN=http://127.0.0.1:3000',
        'PORT=3000',
        'DB_PORT=55435',
        `POSTGRES_PASSWORD=${password}`,
        `DATABASE_URL=postgresql://gunita:${password}@127.0.0.1:55435/gunita`,
        `BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`,
        'SMTP_HOST=127.0.0.1',
        'SMTP_PORT=1028',
        'MAILPIT_UI_PORT=8028',
        '',
      ].join('\n'),
    );
  } finally {
    await file.close();
  }
  return true;
}
