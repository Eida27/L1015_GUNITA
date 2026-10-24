import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
import { createThoughtService } from '../../src/server/thoughts/service';
import { createModerationService } from '../../src/server/moderation/service';
import { turnstileConfig } from '../../src/server/security/turnstile';
import { localTurnstileToken } from '../../src/lib/turnstile-local';
vi.mock('server-only', () => ({}));
const origin = 'http://127.0.0.1:3000';
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let handle: ReturnType<typeof createModerationService>['handle'];
const actors: { id: string; cookie: string; email: string }[] = [];
let publicId: string;
const req = (path: string, actor = 1, method = 'GET', body?: unknown) =>
  new Request(origin + path, {
    method,
    headers: {
      origin,
      cookie: actors[actor]?.cookie ?? '',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  db = await createMapDatabase({ maxConnections: 4 });
  const secret = randomBytes(48).toString('hex');
  const auth = createAuthService({
    pool: db.pool,
    origin,
    secret,
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  handle = createModerationService({
    auth,
    pool: db.pool,
    origin,
    secret,
    turnstile: turnstileConfig({ NODE_ENV: 'test', APP_ORIGIN: origin }),
  }).handle;
  for (let i = 0; i < 3; i++) {
    const email = `review-${randomBytes(8).toString('hex')}@test.invalid`,
      password = randomBytes(24).toString('hex');
    expect(
      (
        await auth.handle(
          req('/api/auth/sign-up/email', -1, 'POST', { email, password }),
        )
      ).status,
    ).toBe(200);
    const user = await db.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1 RETURNING id',
      [email],
    );
    const login = await auth.handle(
      req('/api/auth/sign-in/email', -1, 'POST', { email, password }),
    );
    actors.push({
      id: user.rows[0].id,
      email,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    });
  }
  await db.operator.query(
    "UPDATE profiles SET role='admin' WHERE user_id=ANY($1::uuid[])",
    [[actors[1].id, actors[2].id]],
  );
  const thoughts = createThoughtService({
    auth,
    pool: db.pool,
    origin,
    secret,
  });
  expect(
    (
      await thoughts.handle(
        req('/api/me/consent', 0, 'PUT', { version: 'guidelines-2026-10-19' }),
      )
    ).status,
  ).toBe(200);
  const post = await thoughts.handle(
    req('/api/thoughts', 0, 'POST', {
      body: 'Fictional review regression body.',
      emotion: 'hope',
      location: { lat: 14.6, lng: 120.98 },
    }),
  );
  expect(post.status).toBe(201);
  publicId = (await post.json()).publicId;
}, 60000);
afterAll(async () => {
  await db?.close();
});

it('accepts unrelated guest cookies but freshly rejects invalid, empty, revoked and ineligible member sessions', async () => {
  async function report(cookie: string) {
    // Isolate only this disposable fixture's direct attempt budget between guard cases.
    await db.operator.query(
      "DELETE FROM rate_limit_counters WHERE route_group='reports'",
    );
    const request = req('/api/reports', -1, 'POST', {
      thoughtPublicId: publicId,
      reason: 'other',
      turnstileToken: localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report'),
    });
    request.headers.set('cookie', cookie);
    return handle(request);
  }
  expect((await report('theme=dark; language=fil')).status).toBe(200);
  expect((await report(actors[0].cookie + '; theme=dark')).status).toBe(200);
  expect(
    (
      await db.operator.query(
        'SELECT reporter_category FROM reports ORDER BY reporter_category',
      )
    ).rows,
  ).toEqual([{ reporter_category: 'guest' }, { reporter_category: 'member' }]);
  for (const cookie of [
    'better-auth.session_token=forged',
    'better-auth.session_token=',
  ])
    expect((await report(cookie)).status).toBe(401);
  await db.operator.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [actors[0].id],
  );
  expect((await report(actors[0].cookie)).status).toBe(403);
  await db.operator.query('UPDATE "user" SET email_verified=true WHERE id=$1', [
    actors[0].id,
  ]);
  await db.operator.query(
    "UPDATE profiles SET status='suspended' WHERE user_id=$1",
    [actors[0].id],
  );
  expect((await report(actors[0].cookie)).status).toBe(403);
  await db.operator.query(
    "UPDATE profiles SET status='active' WHERE user_id=$1",
    [actors[0].id],
  );
  await db.operator.query('DELETE FROM session WHERE user_id=$1', [
    actors[0].id,
  ]);
  expect((await report(actors[0].cookie)).status).toBe(401);
}, 30000);

it.each(['expiry', 'deletion'])(
  'keeps a suspended author manageable after last report %s without retaining content',
  async (mode) => {
    const id = `t_${randomBytes(16).toString('base64url')}`;
    const inserted = await db.operator.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
    SELECT $1,author_id,'Ephemeral regression content',emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label FROM thoughts WHERE public_id=$2 RETURNING id`,
      [id, publicId],
    );
    const thoughtId = inserted.rows[0].id;
    await db.operator.query(
      'DELETE FROM reports WHERE thought_id IN (SELECT id FROM thoughts WHERE author_id=$1)',
      [actors[0].id],
    );
    await db.operator.query(
      "INSERT INTO reports(thought_id,reporter_category,reason) VALUES($1,'guest','other')",
      [thoughtId],
    );
    const path = `/api/admin/accounts/${actors[0].id}/suspension`;
    expect(
      (
        await handle(
          req(path, 1, 'POST', { suspended: true, reasonCode: 'SPAM' }),
        )
      ).status,
    ).toBe(200);
    if (mode === 'deletion') {
      expect(
        (
          await handle(
            req(`/api/admin/thoughts/${id}/moderate`, 1, 'POST', {
              action: 'delete',
              reasonCode: 'OTHER',
            }),
          )
        ).status,
      ).toBe(200);
    } else {
      await db.operator.query(
        'ALTER TABLE thoughts DISABLE TRIGGER thoughts_immutable',
      );
      try {
        await db.operator.query(
          "UPDATE thoughts SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1",
          [thoughtId],
        );
      } finally {
        await db.operator.query(
          'ALTER TABLE thoughts ENABLE TRIGGER thoughts_immutable',
        );
      }
    }
    expect(
      (await (await handle(req('/api/admin/reports'))).json()).items,
    ).toEqual([]);
    const response = await handle(req('/api/admin/accounts'));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const accounts = await response.json();
    expect(accounts.items).toEqual([
      expect.objectContaining({ id: actors[0].id, status: 'suspended' }),
    ]);
    expect(accounts.nextCursor).toBeNull();
    expect(JSON.stringify(accounts)).not.toMatch(
      /Ephemeral|regression body|test.invalid/,
    );
    expect(
      (
        await handle(
          req(
            `/api/admin/accounts/${accounts.items[0].id}/suspension`,
            1,
            'POST',
            { suspended: false, reasonCode: 'NO_VIOLATION' },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await handle(req('/api/admin/accounts'))).json()).items,
    ).toEqual([]);
  },
);

it('distinguishes subjects and administrators in history while erasing deleted linkage and excluding content or email copies', async () => {
  for (const [actor, subject] of [
    [1, 0],
    [2, 1],
  ]) {
    expect(
      (
        await handle(
          req(
            `/api/admin/accounts/${actors[subject].id}/suspension`,
            actor,
            'POST',
            { suspended: false, reasonCode: 'NO_VIOLATION' },
          ),
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await handle(
        req(`/api/admin/thoughts/${publicId}/moderate`, 2, 'POST', {
          action: 'hide',
          reasonCode: 'OTHER',
        }),
      )
    ).status,
  ).toBe(200);
  const history = (await (await handle(req('/api/admin/audit'))).json()).items;
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subjectKind: 'account',
        subjectReference: actors[0].id,
        actorId: actors[1].id,
      }),
      expect.objectContaining({
        subjectKind: 'account',
        subjectReference: actors[1].id,
        actorId: actors[2].id,
      }),
      expect.objectContaining({
        subjectKind: 'thought',
        subjectReference: publicId,
        actorId: actors[2].id,
      }),
    ]),
  );
  await db.operator.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [actors[0].id, actors[2].id],
  ]);
  const erased = (await (await handle(req('/api/admin/audit'))).json()).items;
  expect(erased).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subjectKind: 'account',
        subjectReference: null,
        actorId: actors[1].id,
      }),
      expect.objectContaining({
        subjectKind: 'account',
        subjectReference: actors[1].id,
        actorId: null,
      }),
      expect.objectContaining({
        subjectKind: 'thought',
        subjectReference: null,
        actorId: null,
      }),
    ]),
  );
  const json = JSON.stringify(erased);
  for (const value of [
    actors[0].id,
    actors[2].id,
    publicId,
    'Fictional review regression body.',
    ...actors.map((a) => a.email),
  ])
    expect(json).not.toContain(value);
});
