import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createMapDatabase } from '../fixtures/map-database';
const failure = vi.hoisted(() => ({ partial: false }));
vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (
        failure.partial &&
        typeof args[0] === 'string' &&
        args[0].endsWith('.gunitabackup')
      ) {
        failure.partial = false;
        await actual.writeFile(
          args[0],
          Buffer.from('synthetic partial ciphertext'),
        );
        throw new Error('Synthetic archive write failure');
      }
      return actual.writeFile(...args);
    },
  };
});
import * as backups from '../../scripts/backup-lib.mjs';
vi.mock('server-only', () => ({}));
import { coarsenPhilippinesPoint } from '../../src/server/geo/privacy';

let fixture: Awaited<ReturnType<typeof createMapDatabase>>;
let directory: string;
let restoredName: string | undefined;
beforeAll(async () => {
  fixture = await createMapDatabase();
  directory = await mkdtemp(join(tmpdir(), 'gunita-backup-proof-'));
}, 60000);
afterAll(async () => {
  if (restoredName) {
    if (!/^gunita_restore_[a-f0-9]{16}$/.test(restoredName))
      throw new Error('Unowned restore');
    await fixture.operator.query(
      `DROP DATABASE "${restoredName}" WITH (FORCE)`,
    );
  }
  await fixture?.close();
  if (directory) {
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !basename(directory).startsWith('gunita-backup-proof-')
    )
      throw new Error('Unowned backup proof');
    await rm(directory, { recursive: true, force: true });
  }
});

it('removes its partial encrypted archive after a failed filesystem write', async () => {
  const keyFile = join(directory, 'partial.key'),
    destination = join(directory, 'partial-write');
  await backups.createBackupKey(keyFile);
  const source = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  source.pathname = `/${fixture.name}`;
  failure.partial = true;
  try {
    await expect(
      backups.backupDatabase({
        databaseUrl: source.toString(),
        destination,
        keyFile,
        destinationKind: 'local-simulation',
        container: 'gunita-db-1',
      }),
    ).rejects.toThrow('Synthetic archive write failure');
    expect(await readdir(destination)).toEqual([]);
  } finally {
    failure.partial = false;
  }
}, 30000);

it('dumps to a separate authenticated encrypted destination, restores isolated, cleans expiry and never grants runtime traffic', async () => {
  expect(typeof backups.backupDatabase).toBe('function');
  const keyFile = join(directory, 'backup.key'),
    destination = join(directory, 'offsite-simulation');
  await mkdir(destination);
  await backups.createBackupKey(keyFile);
  const initialKey = await readFile(keyFile);
  await expect(backups.createBackupKey(keyFile)).rejects.toThrow();
  expect(await readFile(keyFile)).toEqual(initialKey);
  initialKey.fill(0);
  const staleName = `gunita-${Date.now() - 8 * 86400000}-0123456789abcdef.gunitabackup`;
  const recentName = `gunita-${Date.now() - 6 * 86400000}-0123456789abcdef.gunitabackup`;
  await writeFile(
    join(destination, staleName),
    'synthetic stale encrypted archive placeholder',
  );
  await writeFile(
    join(destination, recentName),
    'synthetic retained archive placeholder',
  );
  await writeFile(
    join(destination, 'unrelated.txt'),
    'owned unrelated fixture',
  );
  const author = randomUUID(),
    other = randomUUID();
  await fixture.operator.query(
    "INSERT INTO \"user\"(id,name,email,email_verified) VALUES($1,'Fictional backup owner','backup-owner@test.invalid',true),($2,'Fictional reader','backup-reader@test.invalid',true)",
    [author, other],
  );
  const ids = [
    't_backup_active_abcdefghijkl',
    't_backup_expired_abcdefghijk',
    't_backup_deleted_abcdefghijk',
  ];
  const point = await coarsenPhilippinesPoint(fixture.pool, 14.6, 120.98);
  for (const [i, id] of ids.entries())
    await fixture.operator.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at) VALUES($1,$2,'Clearly fictional backup fixture','hope',ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,1,$8,statement_timestamp()-($3::int * interval '1 day'))`,
      [
        id,
        author,
        i === 1 ? 31 : 0,
        point.lng,
        point.lat,
        point.privacyCell,
        point.privacyTier,
        point.label,
      ],
    );
  await fixture.operator.query(
    'INSERT INTO bookmarks(user_id,thought_id) SELECT $1,id FROM thoughts',
    [other],
  );
  // Explicit timing: deletion precedes the snapshot; no claim about later erasure.
  await fixture.operator.query('DELETE FROM thoughts WHERE public_id=$1', [
    ids[2],
  ]);
  const sourceUrl = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  sourceUrl.pathname = `/${fixture.name}`;
  const runtimeRole = new URL(fixture.runtimeUrl).username;
  const result = await backups.backupDatabase({
    databaseUrl: sourceUrl.toString(),
    destination,
    keyFile,
    destinationKind: 'local-simulation',
    container: 'gunita-db-1',
  });
  expect(result.retentionDays).toBe(7);
  expect((await readdir(destination)).sort()).toEqual(
    [basename(result.path), recentName, 'unrelated.txt'].sort(),
  );
  const encrypted = await readFile(result.path);
  for (const secret of [
    'Clearly fictional backup fixture',
    'backup-owner@test.invalid',
    ids[0],
  ])
    expect(encrypted.includes(Buffer.from(secret))).toBe(false);
  const restoreCount = async () =>
    (
      await fixture.operator.query(
        "SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'gunita_restore_%'",
      )
    ).rows[0].n;
  const before = await restoreCount(),
    wrongKey = join(directory, 'wrong.key');
  await backups.createBackupKey(wrongKey);
  const restoreOptions = {
    archive: result.path,
    keyFile,
    operatorUrl: process.env.BOOTSTRAP_DATABASE_URL!,
    container: 'gunita-db-1',
    runtimeRole,
  };
  await expect(
    backups.restoreDatabase({ ...restoreOptions, keyFile: wrongKey }),
  ).rejects.toThrow();
  expect(await restoreCount()).toBe(before);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(result.path, tampered);
  await expect(backups.restoreDatabase(restoreOptions)).rejects.toThrow();
  expect(await restoreCount()).toBe(before);
  await writeFile(result.path, encrypted);
  // A privileged or inherited role cannot be quarantined merely by REVOKE.
  await expect(
    backups.restoreDatabase({
      ...restoreOptions,
      runtimeRole: new URL(sourceUrl).username,
    }),
  ).rejects.toThrow('no traffic enabled');
  expect(await restoreCount()).toBe(before);
  // A later deletion is unknowable from this snapshot: quarantine is mandatory.
  await fixture.operator.query('DELETE FROM thoughts WHERE public_id=$1', [
    ids[0],
  ]);
  const restored = await backups.restoreDatabase({
    archive: result.path,
    keyFile,
    operatorUrl: process.env.BOOTSTRAP_DATABASE_URL!,
    container: 'gunita-db-1',
    runtimeRole,
  });
  restoredName = restored.name;
  expect(restored).toMatchObject({
    quarantined: true,
    reconciliationRequired: true,
    cleanup: { skipped: false, totals: { thoughts: 1 } },
  });
  const deniedUrl = new URL(fixture.runtimeUrl);
  deniedUrl.pathname = `/${restored.name}`;
  const denied = new pg.Client({ connectionString: deniedUrl.toString() });
  try {
    await expect(denied.connect()).rejects.toMatchObject({ code: '42501' });
  } finally {
    await denied.end();
  }
  const restoredUrl = new URL(sourceUrl);
  restoredUrl.pathname = `/${restored.name}`;
  const check = new pg.Client({ connectionString: restoredUrl.toString() });
  await check.connect();
  try {
    expect(
      (await check.query('SELECT public_id FROM thoughts ORDER BY public_id'))
        .rows,
    ).toEqual([{ public_id: ids[0] }]);
    expect(
      (await check.query('SELECT count(*)::int n FROM bookmarks')).rows[0].n,
    ).toBe(1);
    expect(
      (await check.query('SELECT count(*)::int n FROM session')).rows[0].n,
    ).toBe(0);
    expect(
      (await check.query('SELECT count(*)::int n FROM schema_migrations'))
        .rows[0].n,
    ).toBe(7);
  } finally {
    await check.end();
  }
}, 120000);
