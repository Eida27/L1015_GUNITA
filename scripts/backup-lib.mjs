import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import {
  readFile,
  writeFile,
  lstat,
  realpath,
  readdir,
  unlink,
  mkdir,
  open,
} from 'node:fs/promises';
import { join } from 'node:path';
import { withinBackupPath } from './backup-paths.mjs';
import pg from 'pg';
import { migrate } from '../src/server/db/migrate.mjs';
import { runMaintenance } from '../src/server/db/maintenance.mjs';

const magic = Buffer.from('GUNITA01');
const maxBytes = 128 * 1024 * 1024;
const archiveName = /^gunita-\d{13}-[a-f0-9]{16}\.gunitabackup$/;
function checkKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error('Invalid backup key');
}
export function encryptArchive(plain, key) {
  checkKey(key);
  if (plain.length > maxBytes)
    throw new Error('Backup exceeds configured bound');
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptArchive(archive, key) {
  checkKey(key);
  if (
    archive.length < 36 ||
    archive.length > maxBytes + 36 ||
    !archive.subarray(0, 8).equals(magic)
  )
    throw new Error('Invalid backup archive');
  let pending;
  try {
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key,
      archive.subarray(8, 20),
      { authTagLength: 16 },
    );
    cipher.setAAD(magic);
    cipher.setAuthTag(archive.subarray(20, 36));
    // No plaintext is released to pg_restore until authentication succeeds.
    pending = cipher.update(archive.subarray(36));
    return Buffer.concat([pending, cipher.final()]);
  } catch {
    throw new Error('Backup authentication failed');
  } finally {
    pending?.fill(0);
  }
}
async function privateFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Expected private regular file');
  if (process.platform === 'win32') {
    // Use the Windows .NET ACL API directly: an inherited PowerShell7 module
    // path can prevent Windows PowerShell5 from importing Get-Acl's module.
    const command =
      '$ErrorActionPreference="Stop"; $allowed=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,"S-1-5-18","S-1-5-32-544"); $acl=[System.IO.File]::GetAccessControl($env:GUNITA_PRIVATE_PATH); foreach($entry in $acl.Access){ $sid=$entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($entry.AccessControlType -eq "Allow" -and $allowed -notcontains $sid){exit 2}}; exit 0';
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(command, 'utf16le').toString('base64'),
        ],
        {
          env: { ...process.env, GUNITA_PRIVATE_PATH: path },
          stdio: 'ignore',
          windowsHide: true,
        },
      );
    } catch {
      throw new Error('Private file ACL required');
    }
  } else if (info.mode & 0o077)
    throw new Error('Private file permissions required');
}
async function lockNewFile(path) {
  if (process.platform === 'win32')
    execFileSync(
      'icacls.exe',
      [
        path,
        '/inheritance:r',
        '/grant:r',
        `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(F)`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  await privateFile(path);
}
export async function createBackupKey(path) {
  // Establish exclusive ownership and ACL before writing any secret bytes.
  await writeFile(path, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
  const key = randomBytes(32);
  try {
    await lockNewFile(path);
    await writeFile(path, key);
  } catch (error) {
    await unlink(path);
    throw error;
  } finally {
    key.fill(0);
  }
}
async function loadKey(path) {
  await privateFile(path);
  const key = await readFile(path);
  checkKey(key);
  return key;
}
function pgTool(tool, databaseUrl, options, input) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid database configuration');
  const container = options.container;
  if (container && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container))
    throw new Error('Invalid database container');
  const args = [
    '--host',
    container ? '127.0.0.1' : url.hostname,
    '--port',
    container ? '5432' : url.port || '5432',
    '--username',
    decodeURIComponent(url.username),
    '--dbname',
    decodeURIComponent(url.pathname.slice(1)),
    '--no-owner',
    '--no-acl',
  ];
  if (tool === 'pg_dump') args.push('--format=custom');
  else args.push('--exit-on-error', '--single-transaction');
  return new Promise((resolve, reject) => {
    const child = spawn(
      container ? 'docker' : tool,
      container
        ? ['exec', '-i', '-e', 'PGPASSWORD', container, tool, ...args]
        : args,
      {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const chunks = [];
    let size = 0,
      oversized = false;
    const timer = setTimeout(() => {
      oversized = true;
      child.kill();
    }, 120000);
    child.stdout.on('data', (data) => {
      size += data.length;
      if (size > maxBytes) {
        oversized = true;
        child.kill();
      } else chunks.push(data);
    });
    // PostgreSQL diagnostic text can contain data/configuration. Never print it.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Database archive command failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code || oversized)
        reject(new Error('Database archive command failed'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}
export async function backupDatabase({
  databaseUrl,
  destination,
  keyFile,
  destinationKind,
  container,
  retentionDays = 7,
}) {
  if (!['local-simulation', 'offsite-mounted'].includes(destinationKind))
    throw new Error('Explicit backup destination kind required');
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 7 ||
    retentionDays > 365
  )
    throw new Error('Invalid backup retention');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const directory = await realpath(destination),
    keyPath = await realpath(keyFile);
  if (withinBackupPath(directory, keyPath))
    throw new Error('Backup key must be separate from archives');
  const key = await loadKey(keyPath);
  let plain;
  try {
    plain = await pgTool('pg_dump', databaseUrl, { container });
    const encrypted = encryptArchive(plain, key);
    const filename = `gunita-${Date.now()}-${randomBytes(8).toString('hex')}.gunitabackup`;
    const path = join(directory, filename);
    // Reserve exclusively before the failure-cleanup scope. A collision must
    // never authorize deleting somebody else's existing archive.
    const reserved = await open(path, 'wx', 0o600);
    await reserved.close();
    try {
      await writeFile(path, encrypted, { flag: 'r+' });
      await lockNewFile(path);
    } catch (error) {
      await unlink(path);
      throw error;
    }
    // Rotate only this tool's regular archives, after a new successful backup.
    for (const entry of await readdir(directory)) {
      if (!archiveName.test(entry)) continue;
      const candidate = join(directory, entry),
        info = await lstat(candidate);
      if (
        info.isFile() &&
        !info.isSymbolicLink() &&
        Number(entry.split('-')[1]) < Date.now() - retentionDays * 86400000
      )
        await unlink(candidate);
    }
    return { path, bytes: encrypted.length, retentionDays, destinationKind };
  } finally {
    key.fill(0);
    plain?.fill(0);
  }
}

export async function restoreDatabase({
  archive,
  keyFile,
  operatorUrl,
  container,
  runtimeRole,
}) {
  if (!runtimeRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole))
    throw new Error('Known runtime role required');
  await privateFile(archive);
  if ((await lstat(archive)).size > maxBytes + 36)
    throw new Error('Archive exceeds configured bound');
  const key = await loadKey(keyFile);
  let plain;
  const operator = new pg.Client({ connectionString: operatorUrl });
  const name = `gunita_restore_${randomBytes(8).toString('hex')}`;
  let created = false,
    client;
  try {
    plain = decryptArchive(await readFile(archive), key);
    await operator.connect();
    // Create closed: no connection is possible between CREATE and ACL setup.
    await operator.query(`CREATE DATABASE "${name}" ALLOW_CONNECTIONS false`);
    created = true;
    await operator.query(
      `REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC, "${runtimeRole}"`,
    );
    // Account for inherited grants and superuser roles, which REVOKE alone
    // cannot quarantine. This check happens before import or cleanup begins.
    const access = await operator.query(
      "SELECT has_database_privilege($1,$2,'CONNECT') AS allowed",
      [runtimeRole, name],
    );
    if (access.rows[0].allowed)
      throw new Error('Runtime role is not quarantined');
    await operator.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
    const url = new URL(operatorUrl);
    url.pathname = `/${name}`;
    await pgTool('pg_restore', url.toString(), { container }, plain);
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await migrate(client);
    const cleanup = await runMaintenance(client);
    if (cleanup.skipped)
      throw new Error('Restore cleanup could not acquire lock');
    const remaining = await client.query(
      'SELECT count(*)::int AS n FROM thoughts WHERE expires_at<=statement_timestamp()',
    );
    if (remaining.rows[0].n !== 0)
      throw new Error('Restore expiry cleanup incomplete');
    // Restored credentials must not resurrect old authenticated sessions.
    await client.query('DELETE FROM session');
    await client.query('DELETE FROM verification');
    return { name, quarantined: true, cleanup, reconciliationRequired: true };
  } catch {
    if (client) {
      await client.end();
      client = undefined;
    }
    if (created) await operator.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    throw new Error('Isolated restore failed; no traffic enabled');
  } finally {
    await client?.end();
    await operator.end();
    key.fill(0);
    plain?.fill(0);
  }
}
