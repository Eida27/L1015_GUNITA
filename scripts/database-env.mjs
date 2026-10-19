import { readFile, open, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';

// Operator tools only. Web launchers load .env and never load .env.db.
export function loadDatabaseEnv(directory = process.cwd()) {
  const path = resolve(directory, '.env.db');
  if (existsSync(path)) process.loadEnvFile(path);
}
export async function prepareLocalDatabaseEnv(directory = process.cwd()) {
  const path = join(directory, '.env');
  const source = await readFile(path, 'utf8');
  const values = parseEnv(source);
  const privilegedPath = join(directory, '.env.db');
  let privileged;
  let created = false;
  try {
    privileged = parseEnv(await readFile(privilegedPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const bootstrap = new URL(values.DATABASE_URL);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(bootstrap.hostname) ||
      bootstrap.username !== 'gunita'
    )
      throw new Error(
        'Local role preparation requires the documented local bootstrap account',
      );
    const migration = new URL(bootstrap);
    migration.username = 'gunita_migrator';
    migration.password = randomBytes(24).toString('hex');
    const runtime = new URL(bootstrap);
    runtime.username = 'gunita_app';
    runtime.password = randomBytes(24).toString('hex');
    privileged = {
      BOOTSTRAP_DATABASE_URL: bootstrap.toString(),
      MIGRATION_DATABASE_URL: migration.toString(),
      RUNTIME_DATABASE_URL: runtime.toString(),
    };
    const file = await open(privilegedPath, 'wx', 0o600);
    try {
      await file.writeFile(
        '# Privileged operator settings. Never give this file to the web service.\n' +
          Object.entries(privileged)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') +
          '\n',
      );
    } finally {
      await file.close();
    }
    created = true;
  }
  if (
    !privileged.RUNTIME_DATABASE_URL ||
    !privileged.BOOTSTRAP_DATABASE_URL ||
    !privileged.MIGRATION_DATABASE_URL
  )
    throw new Error('Incomplete operator database settings');
  if (values.DATABASE_URL !== privileged.RUNTIME_DATABASE_URL) {
    const next = source.replace(
      /^DATABASE_URL=.*$/m,
      `DATABASE_URL=${privileged.RUNTIME_DATABASE_URL}`,
    );
    if (next === source) throw new Error('Runtime database setting missing');
    const temporary = join(
      directory,
      `.env.${randomBytes(8).toString('hex')}.tmp`,
    );
    await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  }
  return created;
}
