// Sent over stdin to the isolated operator image by scripts/rehearse.mjs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { latLngToCell } from 'h3-js';
import { runMaintenance } from './src/server/db/maintenance.mjs';
import { bootstrapAdmin } from './scripts/admin-bootstrap-lib.mjs';
import {
  backupDatabase,
  restoreDatabase,
  decryptArchive,
} from './scripts/backup-lib.mjs';
process.loadEnvFile('/run/secrets/operator_env');
const client = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const bootstrap = new pg.Client({
  connectionString: process.env.BOOTSTRAP_DATABASE_URL,
});
const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
let restore;
const author = randomUUID();
try {
  await client.connect();
  await bootstrap.connect();
  await runtime.connect();
  assert.equal(
    (await client.query('SELECT count(*)::int AS n FROM thoughts')).rows[0].n,
    0,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int AS n FROM geo_admin_areas'))
      .rows[0].n,
    87,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n,
    0,
  );
  const role = (
    await runtime.query(
      `SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user`,
    )
  ).rows[0];
  assert.ok(Object.values(role).every((value) => value === false));
  assert.equal(
    (
      await runtime.query(
        "SELECT has_column_privilege(current_user,'profiles','role','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  console.log(
    'PASS initialized 87 areas, zero demo users/thoughts, least-privilege runtime',
  );
  await client.query(
    `INSERT INTO "user"(id,name,email,email_verified) VALUES($1,'Synthetic rehearsal','synthetic-rehearsal@example.invalid',false)`,
    [author],
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int AS n FROM profiles WHERE user_id=$1',
        [author],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    bootstrapAdmin(
      client,
      'synthetic-rehearsal@example.invalid',
      'synthetic-rehearsal@example.invalid',
    ),
  );
  await client.query('UPDATE "user" SET email_verified=true WHERE id=$1', [
    author,
  ]);
  await assert.rejects(
    bootstrapAdmin(
      client,
      'synthetic-rehearsal@example.invalid',
      'different@example.invalid',
    ),
  );
  await bootstrapAdmin(
    client,
    'synthetic-rehearsal@example.invalid',
    'synthetic-rehearsal@example.invalid',
  );
  assert.equal(
    (await client.query('SELECT role FROM profiles WHERE user_id=$1', [author]))
      .rows[0].role,
    'admin',
  );
  await assert.rejects(
    bootstrapAdmin(
      runtime,
      'synthetic-rehearsal@example.invalid',
      'synthetic-rehearsal@example.invalid',
    ),
  );
  console.log(
    'PASS admin bootstrap verification, exact confirmation and operator-only privilege',
  );
  await client.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    VALUES('t_rehearsal_expired_abcdefghijkl',$1,'Synthetic operations expiry fixture','hope',ST_SetSRID(ST_MakePoint(121,14.6),4326),$2,7,1,'Metro Manila',statement_timestamp()-interval '31 days')`,
    [author, latLngToCell(14.6, 121, 7)],
  );
  const keyFile = '/keys/backup.key';
  const before = await readdir('/archives');
  assert.ok(before.some((name) => name.endsWith('.gunitabackup')));
  const archive = await backupDatabase({
    databaseUrl: process.env.BOOTSTRAP_DATABASE_URL,
    destination: '/archives',
    keyFile,
    destinationKind: 'local-simulation',
  });
  assert.equal(archive.retentionDays, 7);
  assert.equal(
    (await readFile(archive.path)).includes(
      Buffer.from('Synthetic operations expiry fixture'),
    ),
    false,
  );
  const key = await readFile(keyFile),
    tampered = await readFile(archive.path);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptArchive(tampered, key));
  key.fill(0);
  restore = await restoreDatabase({
    archive: archive.path,
    keyFile,
    operatorUrl: process.env.BOOTSTRAP_DATABASE_URL,
    runtimeRole: 'gunita_app',
  });
  const restoredUrl = new URL(process.env.BOOTSTRAP_DATABASE_URL);
  restoredUrl.pathname = `/${restore.name}`;
  const restored = new pg.Client({ connectionString: restoredUrl.toString() });
  await restored.connect();
  try {
    assert.equal(
      (await restored.query('SELECT count(*)::int AS n FROM thoughts')).rows[0]
        .n,
      0,
    );
    assert.equal(
      (await restored.query('SELECT count(*)::int AS n FROM session')).rows[0]
        .n,
      0,
    );
    assert.equal(
      (await restored.query('SELECT count(*)::int AS n FROM verification'))
        .rows[0].n,
      0,
    );
  } finally {
    await restored.end();
  }
  const deniedUrl = new URL(process.env.DATABASE_URL);
  deniedUrl.pathname = `/${restore.name}`;
  const denied = new pg.Client({ connectionString: deniedUrl.toString() });
  try {
    await assert.rejects(denied.connect());
  } finally {
    await denied.end();
  }
  console.log(
    'PASS scheduled archive present; encrypted backup, tamper rejection, isolated restore/expiry/session cleanup, runtime CONNECT denied',
  );
  await client.query('SELECT pg_advisory_lock(196742,5)');
  const second = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await second.connect();
  try {
    assert.equal((await runMaintenance(second)).skipped, true);
  } finally {
    await second.end();
    await client.query('SELECT pg_advisory_unlock(196742,5)');
  }
  assert.equal((await runMaintenance(client)).skipped, false);
  assert.equal(
    (await client.query('SELECT count(*)::int AS n FROM thoughts')).rows[0].n,
    0,
  );
  console.log(
    'PASS maintenance no-overlap lock and actual expired-row deletion',
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'rehearsal_probe_failed',
      code: /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : 'OPERATION',
    }),
  );
  process.exitCode = 1;
} finally {
  await client
    .query('DELETE FROM "user" WHERE id=$1', [author])
    .catch(() => {});
  if (restore) {
    assert.match(restore.name, /^gunita_restore_[a-f0-9]{16}$/);
    await bootstrap.query(`DROP DATABASE "${restore.name}" WITH (FORCE)`);
  }
  await runtime.end();
  await client.end();
  await bootstrap.end();
}
