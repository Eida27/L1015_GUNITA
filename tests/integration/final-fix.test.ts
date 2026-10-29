import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
import { createThoughtService } from '../../src/server/thoughts/service';
import { createModerationService } from '../../src/server/moderation/service';
import { turnstileConfig } from '../../src/server/security/turnstile';
vi.mock('server-only', () => ({}));
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let thoughts: ReturnType<typeof createThoughtService>;
let moderation: ReturnType<typeof createModerationService>;
let cookie = '',
  otherCookie = '',
  userId = '',
  path = '';
const origin = 'http://127.0.0.1:3000';
function req(url: string, method = 'GET', body?: unknown, version?: string) {
  return new Request(origin + url, {
    method,
    headers: {
      origin,
      cookie,
      'content-type': 'application/json',
      ...(version ? { 'if-match': version } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  db = await createMapDatabase({ maxConnections: 4 });
  const secret = randomBytes(48).toString('hex');
  const auth = createAuthService({
    pool: db.pool,
    origin,
    secret,
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  const email = `fix-${randomBytes(8).toString('hex')}@test.invalid`,
    password = randomBytes(24).toString('hex');
  expect(
    (
      await auth.handle(
        req('/api/auth/sign-up/email', 'POST', { email, password }),
      )
    ).status,
  ).toBe(200);
  userId = (
    await db.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1 RETURNING id',
      [email],
    )
  ).rows[0].id;
  const login = await auth.handle(
    req('/api/auth/sign-in/email', 'POST', { email, password }),
  );
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const otherEmail = `other-${randomBytes(8).toString('hex')}@test.invalid`;
  await auth.handle(
    req('/api/auth/sign-up/email', 'POST', { email: otherEmail, password }),
  );
  await db.operator.query(
    'UPDATE "user" SET email_verified=true WHERE email=$1',
    [otherEmail],
  );
  otherCookie = (
    await auth.handle(
      req('/api/auth/sign-in/email', 'POST', { email: otherEmail, password }),
    )
  ).headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  thoughts = createThoughtService({ auth, pool: db.pool, origin, secret });
  moderation = createModerationService({
    auth,
    pool: db.pool,
    origin,
    secret,
    turnstile: turnstileConfig({ NODE_ENV: 'test', APP_ORIGIN: origin }),
  });
  await db.operator.query("UPDATE profiles SET role='admin' WHERE user_id=$1", [
    userId,
  ]);
  await thoughts.handle(
    req('/api/me/consent', 'PUT', { version: 'guidelines-2026-10-19' }),
  );
  const post = await thoughts.handle(
    req('/api/thoughts', 'POST', {
      body: 'Fictional original for edit conflict.',
      emotion: 'hope',
      location: { lat: 14.6, lng: 120.98 },
    }),
  );
  expect(post.status).toBe(201);
  path = '/api/thoughts/' + (await post.json()).publicId;
}, 60000);
afterAll(async () => {
  await db?.close();
});

it('rejects a stale loaded draft instead of overwriting a newer save', async () => {
  const before = await (await thoughts.handle(req(path))).json();
  // RED fell back to the old body-only client before this route existed.
  // Require the coherent snapshot contract in the completed implementation.
  async function snapshot() {
    const response = await thoughts.handle(req(path + '/edit'));
    expect(response.status).toBe(200);
    return response.json();
  }
  const first = await snapshot(),
    second = await snapshot();
  expect(
    (
      await thoughts.handle(
        req(
          path,
          'PATCH',
          { body: 'First writer saved this.', emotion: 'gratitude' },
          first.version,
        ),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await thoughts.handle(
        req(
          path,
          'PATCH',
          { body: second.body, emotion: 'regret' },
          second.version,
        ),
      )
    ).status,
  ).toBe(409);
  expect(await (await thoughts.handle(req(path))).json()).toEqual({
    ...before,
    body: 'First writer saved this.',
    emotion: 'gratitude',
  });
  const refreshed = await thoughts.handle(req(path + '/edit'));
  expect(refreshed.headers.get('cache-control')).toBe('private, no-store');
  const fresh = await refreshed.json();
  expect(Object.keys(fresh).sort()).toEqual(['body', 'emotion', 'version']);
  expect(fresh.body).toBe('First writer saved this.');
  expect(fresh.version).not.toBe(first.version);
  expect(
    (
      await thoughts.handle(
        req(path, 'PATCH', { body: 'Fresh subsequent edit.' }, fresh.version),
      )
    ).status,
  ).toBe(200);
});

it('serializes two controlled same-version writers and safely rejects absent/invalid versions', async () => {
  const before = await (await thoughts.handle(req(path))).json();
  const snapshot = await (await thoughts.handle(req(path + '/edit'))).json();
  for (const version of [
    undefined,
    '*',
    '"invalid"',
    snapshot.version + ', ' + snapshot.version,
  ])
    expect(
      (
        await thoughts.handle(
          req(path, 'PATCH', { body: 'Must not save.' }, version),
        )
      ).status,
    ).toBe(409);
  expect(await (await thoughts.handle(req(path))).json()).toEqual(before);
  await db.operator.query('BEGIN');
  await db.operator.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
    userId,
  ]);
  const writes = ['Concurrent first.', 'Concurrent second.'].map((body) =>
    thoughts.handle(req(path, 'PATCH', { body }, snapshot.version)),
  );
  try {
    await vi.waitFor(
      async () => {
        await db.operator.query('SELECT pg_stat_clear_snapshot()');
        const blocked = await db.operator.query(
          'SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0',
        );
        expect(blocked.rows[0].n).toBe(2);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    await db.operator.query('COMMIT');
    await Promise.all(writes);
  }
  const responses = await Promise.all(writes);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const saved = await (await thoughts.handle(req(path))).json();
  expect(saved).toEqual({
    ...before,
    body:
      responses[0].status === 200 ? 'Concurrent first.' : 'Concurrent second.',
  });
  expect(
    (
      await db.operator.query(
        'SELECT count(*)::int n FROM post_quota_events WHERE author_id=$1',
        [userId],
      )
    ).rows[0].n,
  ).toBe(1);
}, 10000);

it('keeps edit snapshots private and freshly rejects guest, nonowner, unverified, hidden and expired access', async () => {
  const snapshot = await (await thoughts.handle(req(path + '/edit'))).json();
  for (const [session, status] of [
    ['', 401],
    [otherCookie, 404],
  ] as const) {
    for (const suffix of ['/edit', '']) {
      const request = suffix
        ? req(path + suffix)
        : req(path, 'PATCH', { body: 'Forbidden write.' }, snapshot.version);
      request.headers.set('cookie', session);
      const response = await thoughts.handle(request);
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toMatch(
        /version|Concurrent|author_id/,
      );
    }
  }
  await db.operator.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [userId],
  );
  expect((await thoughts.handle(req(path + '/edit'))).status).toBe(403);
  expect(
    (
      await thoughts.handle(
        req(path, 'PATCH', { body: 'Forbidden write.' }, snapshot.version),
      )
    ).status,
  ).toBe(403);
  await db.operator.query('UPDATE "user" SET email_verified=true WHERE id=$1', [
    userId,
  ]);
  await db.operator.query(
    "UPDATE thoughts SET status='hidden' WHERE public_id=$1",
    [path.split('/').at(-1)],
  );
  expect((await thoughts.handle(req(path + '/edit'))).status).toBe(404);
  await db.operator.query(
    "UPDATE thoughts SET status='published' WHERE public_id=$1",
    [path.split('/').at(-1)],
  );
  const expired = `t_${randomBytes(16).toString('base64url')}`;
  await db.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    SELECT $1,author_id,'Expired fictional body',emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,statement_timestamp()-interval '31 days' FROM thoughts WHERE public_id=$2`,
    [expired, path.split('/').at(-1)],
  );
  expect(
    (await thoughts.handle(req('/api/thoughts/' + expired + '/edit'))).status,
  ).toBe(404);
  expect(
    (
      await thoughts.handle(
        req(
          '/api/thoughts/' + expired,
          'PATCH',
          { body: 'Expired change.' },
          snapshot.version,
        ),
      )
    ).status,
  ).toBe(404);
});

it('withholds an edit snapshot that expires while its row lock is blocked', async () => {
  const expiring = `t_${randomBytes(16).toString('base64url')}`;
  await db.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    SELECT $1,author_id,'Lock boundary fictional body',emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,clock_timestamp()-interval '720 hours'+interval '3 seconds' FROM thoughts WHERE public_id=$2`,
    [expiring, path.split('/').at(-1)],
  );
  await db.operator.query('BEGIN');
  await db.operator.query(
    'SELECT id FROM thoughts WHERE public_id=$1 FOR UPDATE',
    [expiring],
  );
  const pending = thoughts.handle(req('/api/thoughts/' + expiring + '/edit'));
  try {
    await vi.waitFor(
      async () => {
        await db.operator.query('SELECT pg_stat_clear_snapshot()');
        const blocked = await db.operator.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE 'SELECT author_id,%'",
        );
        expect(blocked.rows[0].n).toBe(1);
      },
      { timeout: 1500, interval: 20 },
    );
    await vi.waitFor(
      async () => {
        const expiry = await db.operator.query(
          'SELECT expires_at<=clock_timestamp() AS expired FROM thoughts WHERE public_id=$1',
          [expiring],
        );
        expect(expiry.rows[0].expired).toBe(true);
      },
      { timeout: 3500, interval: 20 },
    );
  } finally {
    await db.operator.query('COMMIT');
  }
  const response = await pending;
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    code: 'THOUGHT_UNAVAILABLE',
    message: 'This thought is unavailable.',
  });
}, 10000);

it('surfaces chronological actionable reports ahead of multiple pages of resolved UUIDs', async () => {
  const reportTime = (
    await db.operator.query(
      "SELECT date_trunc('second',statement_timestamp())::text AS time",
    )
  ).rows[0].time;
  for (let i = 0; i < 65; i++) {
    await db.operator.query(
      `INSERT INTO reports(id,thought_id,reason,status,reporter_category,created_at)
      SELECT $1,id,'other',$2,'guest',$5::timestamptz - interval '1 day' + ($3::int * interval '1 microsecond') FROM thoughts WHERE public_id=$4`,
      [
        randomUUID(),
        i < 41 ? 'resolved' : i % 2 ? 'open' : 'reviewing',
        Math.floor(i / 2),
        path.split('/').at(-1),
        reportTime,
      ],
    );
  }
  const result = await moderation.handle(req('/api/admin/reports'));
  expect(result.status).toBe(200);
  const page = await result.json();
  expect(
    page.items.every((r: { status: string }) => r.status !== 'resolved'),
  ).toBe(true);
  const expected = (
    await db.operator.query(
      "SELECT id FROM reports WHERE status IN ('open','reviewing') ORDER BY created_at,id",
    )
  ).rows.map((r) => r.id);
  const ids = page.items.map((r: { id: string }) => r.id);
  expect(ids).toEqual(expected.slice(0, 20));
  const next = await (
    await moderation.handle(
      req('/api/admin/reports?cursor=' + encodeURIComponent(page.nextCursor)),
    )
  ).json();
  expect([...ids, ...next.items.map((r: { id: string }) => r.id)]).toEqual(
    expected,
  );
  expect(next.nextCursor).toBeNull();
  for (const view of ['open', 'reviewing', 'resolved', 'all']) {
    let cursor: string | null = null;
    const traversed: string[] = [];
    do {
      const response = await moderation.handle(
        req(
          `/api/admin/reports?view=${view}${cursor ? '&cursor=' + cursor : ''}`,
        ),
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      traversed.push(...result.items.map((r: { id: string }) => r.id));
      cursor = result.nextCursor;
      expect(traversed.length).toBeLessThanOrEqual(65);
    } while (cursor);
    expect(traversed).toEqual(
      (
        await db.operator.query(
          "SELECT id FROM reports WHERE $1='all' OR status::text=$1 ORDER BY created_at,id",
          [view],
        )
      ).rows.map((r) => r.id),
    );
  }
  for (const query of [
    'view=resolved&cursor=' + page.nextCursor,
    'cursor=broken',
    'view=unknown',
    'view=all&view=open',
  ])
    expect(
      (await moderation.handle(req('/api/admin/reports?' + query))).status,
    ).toBe(422);
  const priorAudits = (
    await db.operator.query(
      "SELECT count(*)::int n FROM admin_audit WHERE reason_code='INSPECT' AND subject_kind='report'",
    )
  ).rows[0].n;
  expect(priorAudits).toBe(24 + 24 + 41 + 65);
  expect(
    (
      await moderation.handle(
        req('/api/admin/reports/' + ids[0], 'PATCH', {
          status: 'resolved',
          reasonCode: 'NO_VIOLATION',
        }),
      )
    ).status,
  ).toBe(200);
  const refreshed = await (
    await moderation.handle(req('/api/admin/reports'))
  ).json();
  expect(refreshed.items.map((r: { id: string }) => r.id)).not.toContain(
    ids[0],
  );
  const guest = req('/api/admin/reports');
  guest.headers.set('cookie', '');
  expect((await moderation.handle(guest)).status).toBe(401);
  const member = req('/api/admin/reports');
  member.headers.set('cookie', otherCookie);
  expect((await moderation.handle(member)).status).toBe(403);
}, 15000);
