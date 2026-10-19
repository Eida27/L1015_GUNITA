import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLocalEnv } from '../../scripts/load-env.mjs';
import { loadDatabaseEnv } from '../../scripts/database-env.mjs';
import { migrate } from '../../src/server/db/migrate.mjs';
import { seedGeo } from '../../src/server/db/seed-geo.mjs';
import {
  findPublishedThought,
  publishedPredicate,
} from '../../src/server/db/published.mjs';
import { cleanupExpired } from '../../src/server/db/cleanup.mjs';
import { provisionRoles, grantRuntime } from '../../src/server/db/roles.mjs';

loadLocalEnv();
loadDatabaseEnv();
const name = `gunita_test_${randomBytes(8).toString('hex')}`;
let admin;
let db;
let testUrl;
const suiteMigrationRole = `gunita_test_m_${randomBytes(6).toString('hex')}`;
const suiteRuntimeRole = `gunita_test_r_${randomBytes(6).toString('hex')}`;
async function user(email = `${randomBytes(8).toString('hex')}@test.invalid`) {
  return (
    await db.query(
      'INSERT INTO "user"(name,email) VALUES($1,$2) RETURNING id',
      ['Internal', email],
    )
  ).rows[0].id;
}
async function thought(author, overrides = {}) {
  return (
    await db.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at,status)
    VALUES($1,$2,$3,'hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila',$4,$5) RETURNING *`,
      [
        overrides.publicId || `t_${randomBytes(16).toString('base64url')}`,
        author,
        overrides.body || 'Disposable integration fixture',
        overrides.createdAt || new Date(),
        overrides.status || 'published',
      ],
    )
  ).rows[0];
}
describe('real isolated PostgreSQL/PostGIS integrity', () => {
  beforeAll(async () => {
    admin = new pg.Client({
      connectionString:
        process.env.BOOTSTRAP_DATABASE_URL || process.env.DATABASE_URL,
    });
    await admin.connect();
    if (!/^gunita_test_[a-f0-9]{16}$/.test(name))
      throw new Error('Unsafe test database name');
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(
      process.env.BOOTSTRAP_DATABASE_URL || process.env.DATABASE_URL,
    );
    url.pathname = `/${name}`;
    testUrl = url.toString();
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('CREATE EXTENSION postgis');
    const password = randomBytes(24).toString('hex');
    await provisionRoles(db, {
      migrationRole: suiteMigrationRole,
      runtimeRole: suiteRuntimeRole,
      migrationPassword: password,
      runtimePassword: password,
    });
    const migrationUrl = new URL(testUrl);
    migrationUrl.username = suiteMigrationRole;
    migrationUrl.password = password;
    const migrator = new pg.Client({
      connectionString: migrationUrl.toString(),
    });
    await migrator.connect();
    try {
      await migrate(migrator);
    } finally {
      await migrator.end();
    }
    await seedGeo(db);
  }, 60000);
  beforeEach(async () => {
    await db.query('TRUNCATE "user" CASCADE');
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      if (!/^gunita_test_[a-f0-9]{16}$/.test(name))
        throw new Error('Unsafe test database name');
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      for (const role of [suiteRuntimeRole, suiteMigrationRole]) {
        if (!/^gunita_test_[mr]_[a-f0-9]{12}$/.test(role))
          throw new Error('Unsafe test role cleanup');
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      }
      await admin.end();
    }
  });
  // Missing migration execution must fail here before any implementation.
  it('initializes the full domain in an empty PostGIS database', async () => {
    const result = await db.query(
      "SELECT to_regclass('public.thoughts')::text AS table_name",
    );
    expect(result.rows[0].table_name).toBe('thoughts');
  });
  it('repeat migrations preserve live data and serialize concurrent runners', async () => {
    const id = await user();
    const other = new pg.Client({ connectionString: testUrl });
    await other.connect();
    try {
      expect(await Promise.all([migrate(db), migrate(other)])).toEqual([0, 0]);
    } finally {
      await other.end();
    }
    expect((await db.query('SELECT id FROM "user"')).rows).toEqual([{ id }]);
  });
  it('refuses catalog drift instead of trusting the migration ledger', async () => {
    await db.query('DROP INDEX thoughts_public_point_gist');
    await expect(migrate(db)).rejects.toThrow('schema drift');
    await db.query(
      'CREATE INDEX thoughts_public_point_gist ON thoughts USING gist(public_point)',
    );
    expect(await migrate(db)).toBe(0);
  });
  it('detects even an unexpected table with no columns as catalog drift', async () => {
    await db.query('CREATE TABLE unexpected_empty()');
    try {
      await expect(migrate(db)).rejects.toThrow('schema drift');
    } finally {
      await db.query('DROP TABLE unexpected_empty');
    }
  });
  it('fails closed when the stored relation guard is missing', async () => {
    const name = (
      await db.query(
        'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
      )
    ).rows[0].name;
    const original = (
      await db.query(
        'SELECT relation_inventory FROM schema_migrations WHERE name=$1',
        [name],
      )
    ).rows[0].relation_inventory;
    await db.query(
      'UPDATE schema_migrations SET relation_inventory=NULL WHERE name=$1',
      [name],
    );
    try {
      await expect(migrate(db)).rejects.toThrow('schema drift');
    } finally {
      await db.query(
        'UPDATE schema_migrations SET relation_inventory=$1 WHERE name=$2',
        [JSON.stringify(original), name],
      );
    }
  });
  it('refuses changed migration checksums and rolls a failed later migration back without harming existing data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gunita-migrations-'));
    const author = await user();
    try {
      const source = new URL(
        '../../src/server/db/migrations/',
        import.meta.url,
      );
      const names = (await readdir(source)).filter((name) =>
        name.endsWith('.sql'),
      );
      for (const name of names)
        await writeFile(
          join(directory, name),
          await readFile(new URL(name, source)),
        );
      await writeFile(
        join(directory, '0001_auth.sql'),
        '-- changed\n' +
          (await readFile(join(directory, '0001_auth.sql'), 'utf8')),
      );
      await expect(migrate(db, directory)).rejects.toThrow('checksum mismatch');
      await writeFile(
        join(directory, '0001_auth.sql'),
        await readFile(new URL('0001_auth.sql', source)),
      );
      await writeFile(
        join(directory, '9999_failure.sql'),
        'CREATE TABLE rollback_marker(id integer); SELECT 1/0;',
      );
      await expect(migrate(db, directory)).rejects.toMatchObject({
        code: '22012',
      });
      expect(
        (await db.query("SELECT to_regclass('rollback_marker') AS marker"))
          .rows[0].marker,
      ).toBeNull();
      expect((await db.query('SELECT id FROM "user"')).rows).toEqual([
        { id: author },
      ]);
      expect(await migrate(db)).toBe(0);
    } finally {
      if (
        resolve(directory) !== join(resolve(tmpdir()), basename(directory)) ||
        !/^gunita-migrations-[a-zA-Z0-9]+$/.test(basename(directory))
      )
        throw new Error('Unsafe temporary migration cleanup');
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('suppresses SQL bodies and parameter logging even on database errors', async () => {
    const { rows } = await db.query(
      "SELECT current_setting('log_statement') AS statement,current_setting('log_min_error_statement') AS errors,current_setting('log_parameter_max_length') AS params,current_setting('log_parameter_max_length_on_error') AS error_params",
    );
    expect(rows[0]).toEqual({
      statement: 'none',
      errors: 'panic',
      params: '0',
      error_params: '0',
    });
  });
  it('clears audit and reporter identifiers on account/content deletion and refuses rewriting audit history', async () => {
    const author = await user();
    const member = await user();
    const row = await thought(author);
    const report = (
      await db.query(
        "INSERT INTO reports(thought_id,reporter_user_id,resolved_by,reason) VALUES($1,$2,$2,'spam') RETURNING id",
        [row.id, member],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO admin_audit(admin_user_id,action,subject_kind,subject_user_id,reason_code) VALUES($1,'suspend','account',$1,'SPAM')",
      [member],
    );
    await expect(
      db.query("UPDATE admin_audit SET reason_code='OTHER'"),
    ).rejects.toMatchObject({ code: '23514' });
    await db.query('DELETE FROM "user" WHERE id=$1', [member]);
    expect(
      (
        await db.query(
          'SELECT reporter_user_id,resolved_by FROM reports WHERE id=$1',
          [report.id],
        )
      ).rows[0],
    ).toEqual({ reporter_user_id: null, resolved_by: null });
    expect(
      (
        await db.query(
          'SELECT admin_user_id,subject_user_id,reason_code FROM admin_audit',
        )
      ).rows[0],
    ).toEqual({
      admin_user_id: null,
      subject_user_id: null,
      reason_code: 'SPAM',
    });
  });
  it('rejects duplicate case-insensitive email, pseudonym and orphan ownership', async () => {
    const id = await user('One@Test.invalid');
    await expect(user('one@test.invalid')).rejects.toMatchObject({
      code: '23505',
    });
    await db.query(
      "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
      [id],
    );
    const other = await user();
    await expect(
      db.query(
        "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
        [other],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      thought('00000000-0000-4000-8000-000000000001'),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('keeps pseudonyms permanent while allowing private status changes', async () => {
    const id = await user();
    await db.query(
      "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
      [id],
    );
    await expect(
      db.query(
        "UPDATE profiles SET pseudonym='OtherName-1234' WHERE user_id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await db.query("UPDATE profiles SET status='suspended' WHERE user_id=$1", [
      id,
    ]);
    expect((await db.query('SELECT status FROM profiles')).rows[0].status).toBe(
      'suspended',
    );
  });
  it('fixes expiry at 720 hours and prevents changing identity, author or location', async () => {
    const author = await user();
    const row = await thought(author, {
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(row.expires_at.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    const updates = [
      "expires_at=expires_at+interval '1 second'",
      "created_at=created_at+interval '1 second'",
      "public_id='t_1234567890123456789012'",
      'public_point=ST_SetSRID(ST_MakePoint(121,15),4326)',
      "privacy_cell='87752a30cffffff'",
      'privacy_tier=5',
      'privacy_algorithm_version=2',
      "location_label='Other'",
      "location_region_code='OTHER'",
      'author_id=gen_random_uuid()',
      'id=gen_random_uuid()',
    ];
    for (const update of updates)
      await expect(
        db.query(`UPDATE thoughts SET ${update} WHERE id=$1`, [row.id]),
      ).rejects.toMatchObject({ code: '23514' });
    await db.query(
      "UPDATE thoughts SET body='Edited',emotion='gratitude' WHERE id=$1",
      [row.id],
    );
    expect(
      (await db.query('SELECT expires_at FROM thoughts')).rows[0].expires_at,
    ).toEqual(row.expires_at);
  });
  it('never stores original coordinate columns or exposes private fields through published reads', async () => {
    const columns = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='thoughts'",
      )
    ).rows.map((row) => row.column_name);
    expect(
      columns.filter((name) =>
        /^(lat|lng|latitude|longitude|original_|picked_|raw_)/.test(name),
      ),
    ).toEqual([]);
    const author = await user();
    await db.query(
      "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
      [author],
    );
    const row = await thought(author);
    const result = await findPublishedThought(db, row.public_id);
    expect(result?.pseudonym).toBe('QuietLantern-7F2K');
    expect(result).not.toHaveProperty('author_id');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('reactionCounts');
    expect(await findPublishedThought(db, "' OR 1=1 --")).toBeNull();
  });
  it('excludes hidden, deleted and expired thoughts before hard cleanup', async () => {
    const author = await user();
    await db.query(
      "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
      [author],
    );
    const visible = await thought(author);
    const hidden = await thought(author, { status: 'hidden' });
    await db.query('BEGIN');
    try {
      const boundary = (
        await db.query("SELECT now()-interval '720 hours' AS created")
      ).rows[0].created;
      const expired = await thought(author, { createdAt: boundary });
      expect(await findPublishedThought(db, visible.public_id)).not.toBeNull();
      expect(await findPublishedThought(db, hidden.public_id)).toBeNull();
      expect(await findPublishedThought(db, expired.public_id)).toBeNull();
    } finally {
      await db.query('ROLLBACK');
    }
    await db.query('DELETE FROM thoughts WHERE id=$1', [visible.id]);
    expect(await findPublishedThought(db, visible.public_id)).toBeNull();
  });
  it('excludes a thought at the exact database timestamp boundary without timestamp rounding', async () => {
    const author = await user();
    const { rows } = await db.query(
      `WITH inserted AS (
      INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
      VALUES($1,$2,'Exact boundary disposable fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila',statement_timestamp()-interval '720 hours') RETURNING *
    ) SELECT EXISTS(SELECT 1 FROM inserted t WHERE ${publishedPredicate}) AS visible`,
      [`t_${randomBytes(16).toString('base64url')}`, author],
    );
    expect(rows[0].visible).toBe(false);
  });
  it('enforces unique interactions and cascades content dependencies while preserving deleted-post quota', async () => {
    const author = await user();
    const member = await user();
    const row = await thought(author);
    await db.query(
      "INSERT INTO reactions(user_id,thought_id,type) VALUES($1,$2,'care')",
      [member, row.id],
    );
    await expect(
      db.query(
        "INSERT INTO reactions(user_id,thought_id,type) VALUES($1,$2,'love')",
        [member, row.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await db.query('INSERT INTO bookmarks(user_id,thought_id) VALUES($1,$2)', [
      member,
      row.id,
    ]);
    await db.query(
      "INSERT INTO reports(thought_id,reporter_user_id,reason) VALUES($1,$2,'spam')",
      [row.id, member],
    );
    await db.query('DELETE FROM thoughts WHERE id=$1', [row.id]);
    for (const table of ['reactions', 'bookmarks', 'reports'])
      expect(
        (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
      ).toBe(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM post_quota_events'))
        .rows[0].n,
    ).toBe(1);
    await db.query('DELETE FROM "user" WHERE id=$1', [author]);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM post_quota_events'))
        .rows[0].n,
    ).toBe(0);
  });
  it('cannot bypass five creations by deleting thoughts or racing transactions', async () => {
    const author = await user();
    for (let i = 0; i < 5; i++) {
      const row = await thought(author);
      await db.query('DELETE FROM thoughts WHERE id=$1', [row.id]);
    }
    await expect(thought(author)).rejects.toMatchObject({ code: '23514' });
    expect(
      (await db.query('SELECT count(*)::int AS n FROM thoughts')).rows[0].n,
    ).toBe(0);
  });
  it('serializes concurrent creations so exactly five commits survive', async () => {
    const author = await user();
    const clients = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const client = new pg.Client({ connectionString: testUrl });
        await client.connect();
        await client.query(
          "SET default_transaction_isolation='read committed'",
        );
        return client;
      }),
    );
    try {
      const results = await Promise.allSettled(
        clients.map((client) =>
          client.query(
            `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
        VALUES($1,$2,'Concurrent disposable fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila')`,
            [`t_${randomBytes(16).toString('base64url')}`, author],
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(5);
      expect(
        results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason.code),
      ).toEqual(['23514']);
      expect(
        (await db.query('SELECT count(*)::int AS n FROM post_quota_events'))
          .rows[0].n,
      ).toBe(5);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });
  it.each(['repeatable read', 'serializable', 'read uncommitted'])(
    'rejects %s publication transactions after all six snapshots are established',
    async (isolation) => {
      const author = await user();
      const clients = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const client = new pg.Client({ connectionString: testUrl });
          await client.connect();
          return client;
        }),
      );
      try {
        // Establish every transaction snapshot before any insert can commit.
        await Promise.all(
          clients.map(async (client) => {
            await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
            expect(
              (
                await client.query(
                  'SELECT count(*)::int AS n FROM post_quota_events',
                )
              ).rows[0].n,
            ).toBe(0);
          }),
        );
        const results = await Promise.all(
          clients.map(async (client) => {
            try {
              await client.query(
                `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
              VALUES($1,$2,'Isolation disposable fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila')`,
                [`t_${randomBytes(16).toString('base64url')}`, author],
              );
              await client.query('COMMIT');
              return { outcome: 'committed' };
            } catch (error) {
              await client.query('ROLLBACK');
              return { outcome: 'rejected', code: error.code };
            }
          }),
        );
        const counts = (
          await db.query(
            'SELECT (SELECT count(*)::int FROM thoughts) AS thoughts,(SELECT count(*)::int FROM post_quota_events) AS quota_events',
          )
        ).rows[0];
        expect({ results, counts }).toEqual({
          results: Array.from({ length: 6 }, () => ({
            outcome: 'rejected',
            code: '25000',
          })),
          counts: { thoughts: 0, quota_events: 0 },
        });
      } finally {
        await Promise.all(
          clients.map(async (client) => {
            await client.query('ROLLBACK');
            await client.end();
          }),
        );
      }
    },
  );
  it('provisions a runtime that reads/writes domain data but cannot migrate, promote roles, or erase quota/audit/static data', async () => {
    const suffix = randomBytes(6).toString('hex');
    const migrationRole = `gunita_test_m_${suffix}`,
      runtimeRole = `gunita_test_r_${suffix}`;
    const password = randomBytes(24).toString('hex');
    let runtime;
    try {
      await provisionRoles(db, {
        migrationRole,
        runtimeRole,
        migrationPassword: password,
        runtimePassword: password,
      });
      const role = (
        await db.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',
          [runtimeRole],
        )
      ).rows[0];
      expect(role).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
      await grantRuntime(db, runtimeRole);
      const url = new URL(testUrl);
      url.username = runtimeRole;
      url.password = password;
      runtime = new pg.Client({ connectionString: url.toString() });
      await runtime.connect();
      const author = await user();
      await db.query(
        "INSERT INTO profiles(user_id,pseudonym) VALUES($1,'QuietLantern-7F2K')",
        [author],
      );
      expect(
        (await runtime.query('SELECT count(*)::int AS n FROM geo_admin_areas'))
          .rows[0].n,
      ).toBe(87);
      for (const query of [
        'CREATE TABLE forbidden(id int)',
        'DROP TABLE thoughts',
        "UPDATE profiles SET role='admin'",
        'DELETE FROM post_quota_events',
        'DELETE FROM admin_audit',
        "UPDATE geo_admin_areas SET public_label='Wrong'",
      ])
        await expect(runtime.query(query)).rejects.toMatchObject({
          code: '42501',
        });
      await runtime.query(
        `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
        VALUES($1,$2,'Runtime disposable fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila')`,
        [`t_${randomBytes(16).toString('base64url')}`, author],
      );
      expect(
        (
          await runtime.query(
            'SELECT count(*)::int AS n FROM post_quota_events',
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await runtime?.end();
      for (const role of [runtimeRole, migrationRole]) {
        if (!/^gunita_test_[mr]_[a-f0-9]{12}$/.test(role))
          throw new Error('Unsafe test role cleanup');
        const exists = (
          await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
        ).rowCount;
        if (exists) {
          await db.query(`DROP OWNED BY "${role}"`);
          await db.query(`DROP ROLE "${role}"`);
        }
      }
    }
  });
  it('imports valid SRID4326 land geometry repeatably without production thoughts', async () => {
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM geo_admin_areas WHERE ST_IsValid(geom) AND ST_SRID(geom)=4326',
        )
      ).rows[0].n,
    ).toBe(87);
    expect(await seedGeo(db)).toBe(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM thoughts')).rows[0].n,
    ).toBe(0);
  });
  it.each([
    [120.9842, 14.5995, 'Metro Manila'],
    [123.8854, 10.3157, 'Cebu'],
    [122.5621, 10.7202, 'Iloilo'],
    [125.6128, 7.0701, 'Davao del Sur'],
    [121.9703, 20.4485, 'Batanes'],
    [121.80941423100012, 20.336653299000034, 'Batanes'],
    [120.94963466900003, 14.636499878000052, 'Metro Manila'],
    [126.067, 9.815, 'Surigao del Norte'],
    [120.8, 14.5, null],
    [139.69, 35.68, null],
    [14.5995, 120.9842, null],
  ])(
    'uses real land coverage for [%s,%s] including islands/coastline',
    async (lng, lat, want) => {
      const { rows } = await db.query(
        'SELECT public_label FROM geo_admin_areas WHERE ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326)) ORDER BY public_label',
        [lng, lat],
      );
      expect(rows[0]?.public_label || null).toBe(want);
    },
  );
  it('deletes expired content and token/rate/quota/audit retention in idempotent batches', async () => {
    const author = await user();
    const member = await user();
    const expired = await thought(author, {
      createdAt: new Date(Date.now() - 31 * 86400000),
    });
    const active = await thought(author);
    await db.query('INSERT INTO bookmarks(user_id,thought_id) VALUES($1,$2)', [
      member,
      expired.id,
    ]);
    await db.query(
      "INSERT INTO verification(identifier,value,expires_at) VALUES('fixture','secret',now()-interval '1 second')",
    );
    await db.query(
      "INSERT INTO post_quota_events(author_id,created_at) VALUES($1,now()-interval '26 hours')",
      [author],
    );
    await db.query(
      "INSERT INTO rate_limit_counters VALUES($1,'test',now()-interval '2 hours',1,now()-interval '1 hour')",
      ['a'.repeat(64)],
    );
    await db.query(
      "INSERT INTO admin_audit(action,subject_kind,reason_code,created_at) VALUES('hide','thought','SPAM',now()-interval '91 days')",
    );
    const result = await cleanupExpired(db, { batchSize: 1 });
    expect(result.thoughts).toBe(1);
    expect((await db.query('SELECT id FROM thoughts')).rows).toEqual([
      { id: active.id },
    ]);
    for (const table of [
      'bookmarks',
      'verification',
      'rate_limit_counters',
      'admin_audit',
    ])
      expect(
        (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
      ).toBe(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM post_quota_events'))
        .rows[0].n,
    ).toBe(2);
    expect((await cleanupExpired(db, { batchSize: 1 })).thoughts).toBe(0);
  });
  it('uses spatial, active and author indexes for selective query plans', async () => {
    await db.query('SET enable_seqscan=off');
    try {
      const spatial = (
        await db.query(
          'EXPLAIN (FORMAT JSON) SELECT id FROM thoughts WHERE public_point && ST_MakeEnvelope(120,14,121,15,4326)',
        )
      ).rows;
      expect(JSON.stringify(spatial)).toContain('thoughts_public_point_gist');
      const active = (
        await db.query(
          "EXPLAIN (FORMAT JSON) SELECT id FROM thoughts WHERE status='published' AND expires_at>now() ORDER BY created_at DESC",
        )
      ).rows;
      expect(JSON.stringify(active)).toContain(
        'thoughts_status_expiry_created',
      );
      const author = (
        await db.query(
          "EXPLAIN (FORMAT JSON) SELECT id FROM thoughts WHERE author_id='00000000-0000-4000-8000-000000000001' AND expires_at>now()",
        )
      ).rows;
      expect(JSON.stringify(author)).toContain('thoughts_author_expiry');
    } finally {
      await db.query('RESET enable_seqscan');
    }
  });
});
