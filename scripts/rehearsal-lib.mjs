import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export async function prepareRehearsal(port = 8449) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid rehearsal port');
  const directory = await mkdtemp(join(tmpdir(), 'gunita-rehearsal-'));
  const project = `gunita-rehearsal-${randomBytes(4).toString('hex')}`;
  const password = () => randomBytes(24).toString('hex');
  const dbPassword = password(),
    migrationPassword = password(),
    runtimePassword = password();
  const db = `postgresql://gunita:${dbPassword}@db:5432/gunita`;
  const migration = `postgresql://gunita_migrator:${migrationPassword}@db:5432/gunita`;
  const runtime = `postgresql://gunita_app:${runtimePassword}@db:5432/gunita`;
  const secrets = join(directory, 'secrets');
  await mkdir(secrets, { mode: 0o700 });
  // Lock the entire newly owned Windows directory before writing dummy secrets.
  if (process.platform === 'win32')
    execFileSync(
      'icacls.exe',
      [
        directory,
        '/inheritance:r',
        '/grant:r',
        `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)(F)`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  for (const [file, data] of Object.entries({
    postgres_password: dbPassword,
    'web.env': `DATABASE_URL=${runtime}\nBETTER_AUTH_SECRET=${password()}\nTURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\n`,
    'maintenance.env': `MIGRATION_DATABASE_URL=${migration}\n`,
    'metrics.env': `MIGRATION_DATABASE_URL=${migration}\n`,
    'backup.env': `BACKUP_DATABASE_URL=${db}\n`,
    'operator.env': `BOOTSTRAP_DATABASE_URL=${db}\nMIGRATION_DATABASE_URL=${migration}\nDATABASE_URL=${runtime}\nRESTORE_OPERATOR_DATABASE_URL=${db}\n`,
  }))
    await writeFile(join(secrets, file), data, { mode: 0o600, flag: 'wx' });
  await writeFile(
    join(directory, 'compose.env'),
    [
      `GUNITA_SECRETS_DIR=${secrets.replaceAll('\\', '/')}`,
      `BACKUP_ARCHIVE_PATH=${directory.replaceAll('\\', '/')}`,
      'GUNITA_WEB_IMAGE=gunita-web:phase9',
      'GUNITA_OPERATOR_IMAGE=gunita-operator:phase9',
      'APP_HOST=localhost',
      `APP_ORIGIN=https://localhost:${port}`,
      `HTTPS_PORT=${port}`,
      'TURNSTILE_SITE_KEY=1x00000000000000000000AA',
      'SMTP_HOST=mailpit',
      'SMTP_PORT=1025',
      'SMTP_FROM=Gunita <rehearsal@example.invalid>',
      'MAP_STYLE_URL=https://localhost/local-fixture',
    ].join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  return { directory, project, port };
}
export async function validateRehearsal(receipt) {
  const directory = await realpath(receipt.directory);
  if (
    dirname(directory).toLowerCase() !==
      (await realpath(tmpdir())).toLowerCase() ||
    !basename(directory).startsWith('gunita-rehearsal-') ||
    !/^gunita-rehearsal-[a-f0-9]{8}$/.test(receipt.project) ||
    !Number.isInteger(receipt.port) ||
    receipt.port < 1024 ||
    receipt.port > 65535
  )
    throw new Error('Unowned rehearsal');
  return { ...receipt, directory };
}
export async function readRehearsal() {
  return validateRehearsal(
    JSON.parse(
      await readFile(resolve('.local/phase-9-rehearsal.json'), 'utf8'),
    ),
  );
}
