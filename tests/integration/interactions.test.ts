import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
import { createThoughtService } from '../../src/server/thoughts/service';
vi.mock('server-only', () => ({}));
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let auth: ReturnType<typeof createAuthService>;
let service: ReturnType<typeof createThoughtService>;
const origin = 'http://127.0.0.1:3000';
const actors: { id: string; cookie: string }[] = [];
let id: string;
const req = (path: string, actor = 0, method = 'GET', body?: unknown) =>
  new Request(origin + path, {
    method,
    headers: {
      origin,
      cookie: actors[actor]?.cookie ?? '',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const path = () => `/api/thoughts/${id}`;
const totals = () => `/api/me/thoughts/${id}/reactions`;
beforeAll(async () => {
  db = await createMapDatabase({ maxConnections: 4 });
  auth = createAuthService({
    pool: db.pool,
    origin,
    secret: randomBytes(48).toString('hex'),
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  service = createThoughtService({ auth, pool: db.pool, origin });
  for (let i = 0; i < 3; i++) {
    const email = `interaction-${randomBytes(8).toString('hex')}@test.invalid`;
    const password = randomBytes(24).toString('hex');
    expect(
      (
        await auth.handle(
          new Request(origin + '/api/auth/sign-up/email', {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          }),
        )
      ).status,
    ).toBe(200);
    const user = await db.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1 RETURNING id',
      [email],
    );
    const login = await auth.handle(
      new Request(origin + '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    actors.push({
      id: user.rows[0].id,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    });
  }
  await db.operator.query("UPDATE profiles SET role='admin' WHERE user_id=$1", [
    actors[2].id,
  ]);
  await service.handle(
    req('/api/me/consent', 0, 'PUT', { version: 'guidelines-2026-10-19' }),
  );
  const created = await service.handle(
    req('/api/thoughts', 0, 'POST', {
      body: 'Clearly fictional interaction fixture.',
      emotion: 'hope',
      location: { lat: 14.6, lng: 120.98 },
    }),
  );
  expect(created.status).toBe(201);
  id = (await created.json()).publicId;
}, 60000);
afterAll(async () => {
  await db?.close();
});
it('toggles, changes and removes one reaction transactionally; bookmarks are unique and private', async () => {
  expect(
    (
      await service.handle(
        req(path() + '/reaction', 1, 'PUT', { type: 'love' }),
      )
    ).status,
  ).toBe(200);
  let viewer = await service.handle(req(path() + '/viewer', 1));
  expect(viewer.headers.get('cache-control')).toBe('private, no-store');
  expect(await viewer.json()).toEqual({
    canManage: false,
    myReaction: 'love',
    bookmarked: false,
  });
  await service.handle(req(path() + '/reaction', 1, 'PUT', { type: 'care' }));
  viewer = await service.handle(req(path() + '/viewer', 1));
  expect((await viewer.json()).myReaction).toBe('care');
  await service.handle(req(path() + '/reaction', 1, 'PUT', { type: 'care' }));
  expect(
    (await (await service.handle(req(path() + '/viewer', 1))).json())
      .myReaction,
  ).toBeNull();
  const concurrentReactions = await Promise.all(
    Array.from({ length: 4 }, () =>
      service.handle(req(path() + '/reaction', 1, 'PUT', { type: 'sad' })),
    ),
  );
  expect(concurrentReactions.map((response) => response.status)).toEqual([
    200, 200, 200, 200,
  ]);
  expect(
    (await (await service.handle(req(path() + '/viewer', 1))).json())
      .myReaction,
  ).toBeNull();
  await service.handle(req(path() + '/reaction', 1, 'PUT', { type: 'happy' }));
  expect(
    (await service.handle(req(path() + '/reaction', 1, 'DELETE'))).status,
  ).toBe(200);
  const concurrentBookmarks = await Promise.all(
    Array.from({ length: 3 }, () =>
      service.handle(req(path() + '/bookmark', 1, 'PUT')),
    ),
  );
  expect(concurrentBookmarks.map((response) => response.status)).toEqual([
    200, 200, 200,
  ]);
  expect(
    (await (await service.handle(req(path() + '/viewer', 1))).json())
      .bookmarked,
  ).toBe(true);
  expect(
    (await db.operator.query('SELECT count(*)::int n FROM bookmarks')).rows[0]
      .n,
  ).toBe(1);
});
it('enforces fresh role/state checks, owner-only dashboards and protected four-type totals', async () => {
  await service.handle(req(path() + '/reaction', 1, 'PUT', { type: 'care' }));
  for (const endpoint of [
    totals(),
    '/api/me/thoughts',
    '/api/me/bookmarks',
    path() + '/viewer',
  ]) {
    expect((await service.handle(req(endpoint, 9))).status).toBe(401);
  }
  expect((await service.handle(req(totals(), 1))).status).toBe(404);
  for (const actor of [0, 2]) {
    const out = await service.handle(req(totals(), actor));
    expect(out.status).toBe(200);
    expect(out.headers.get('cache-control')).toBe('private, no-store');
    expect(await out.json()).toEqual({
      totals: { love: 0, sad: 0, care: 1, happy: 0 },
    });
  }
  expect(
    (await service.handle(req('/api/me/thoughts?userId=' + actors[0].id, 1)))
      .status,
  ).toBe(422);
  expect(
    (await (await service.handle(req('/api/me/thoughts', 1))).json()).items,
  ).toEqual([]);
  const own = await service.handle(req('/api/me/thoughts'));
  expect(own.headers.get('cache-control')).toBe('private, no-store');
  expect((await own.json()).items[0]).toMatchObject({
    thought: { publicId: id },
    status: 'published',
    totals: { love: 0, sad: 0, care: 1, happy: 0 },
  });
  for (const endpoint of ['reaction', 'bookmark']) {
    expect(
      (
        await service.handle(
          req(
            path() + '/' + endpoint,
            0,
            'PUT',
            endpoint === 'reaction' ? { type: 'love' } : undefined,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await service.handle(
          req(
            path() + '/' + endpoint,
            9,
            'PUT',
            endpoint === 'reaction' ? { type: 'love' } : undefined,
          ),
        )
      ).status,
    ).toBe(401);
  }
  for (const state of ['unverified', 'suspended']) {
    await db.operator.query(
      state === 'unverified'
        ? 'UPDATE "user" SET email_verified=false WHERE id=$1'
        : "UPDATE profiles SET status='suspended' WHERE user_id=$1",
      [actors[1].id],
    );
    for (const endpoint of [
      '/api/me/thoughts',
      '/api/me/bookmarks',
      path() + '/viewer',
      totals(),
    ])
      expect((await service.handle(req(endpoint, 1))).status).toBe(403);
    for (const endpoint of ['reaction', 'bookmark'])
      expect(
        (
          await service.handle(
            req(
              path() + '/' + endpoint,
              1,
              'PUT',
              endpoint === 'reaction' ? { type: 'love' } : undefined,
            ),
          )
        ).status,
      ).toBe(403);
    await db.operator.query(
      'UPDATE "user" SET email_verified=true WHERE id=$1',
      [actors[1].id],
    );
    await db.operator.query(
      "UPDATE profiles SET status='active' WHERE user_id=$1",
      [actors[1].id],
    );
  }
});
it('rejects extra input, foreign Origin and malformed types without leaking private data', async () => {
  for (const body of [
    { type: 'wow' },
    { type: 'love', userId: actors[0].id },
    {},
  ])
    expect(
      (await service.handle(req(path() + '/reaction', 1, 'PUT', body))).status,
    ).toBe(422);
  const foreign = req(path() + '/bookmark', 1, 'PUT');
  foreign.headers.set('origin', 'https://foreign.invalid');
  expect((await service.handle(foreign)).status).toBe(403);
  expect(
    (
      await service.handle(
        req(path() + '/bookmark', 1, 'PUT', { userId: actors[0].id }),
      )
    ).status,
  ).toBe(422);
  const publicOut = await (await service.handle(req(path(), 9))).json();
  expect(publicOut.reactionTypes).toEqual(['love', 'sad', 'care', 'happy']);
  expect(JSON.stringify(publicOut)).not.toMatch(
    /totals|userId|authorId|myReaction|bookmarked/,
  );
  expect(JSON.stringify(publicOut)).not.toContain(actors[0].id);
});
it('validates actual dashboard producer output and keeps errors generic and private', async () => {
  await db.operator.query('UPDATE thoughts SET body=$1 WHERE public_id=$2', [
    'private-producer-canary'.repeat(20),
    id,
  ]);
  const response = await service.handle(req('/api/me/thoughts'));
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
  await db.operator.query('UPDATE thoughts SET body=$1 WHERE public_id=$2', [
    'Clearly fictional interaction fixture.',
    id,
  ]);
});
it('accepts a zero-byte HTTP stream as an empty bookmark input while keeping malformed and unbounded input rejected', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  const empty = new Request(origin + path() + '/bookmark', {
    method: 'PUT',
    headers: { origin, cookie: actors[1].cookie },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  expect((await service.handle(empty)).status).toBe(200);
  for (const [body, status] of [
    ['{', 400],
    ['{"unexpected":true}', 422],
    [' '.repeat(257), 413],
  ] as const) {
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const request = new Request(origin + path() + '/bookmark', {
      method: 'PUT',
      headers: {
        origin,
        cookie: actors[1].cookie,
        'content-type': 'application/json',
      },
      body: chunked,
      duplex: 'half',
    } as RequestInit);
    expect((await service.handle(request)).status).toBe(status);
  }
});
it('enforces one durable combined interaction budget without cross-account spillover', async () => {
  // Saturate the exact current budget via successful alternating requests.
  // Observe fixed-window rollovers instead of assuming a frozen wall clock.
  for (let i = 0; i < 65; i++) {
    const response = await service.handle(req(path() + '/bookmark', 1, 'PUT'));
    if (response.status === 429) break;
    expect(response.status).toBe(200);
  }
  const limited = await service.handle(
    req(path() + '/reaction', 1, 'PUT', { type: 'love' }),
  );
  expect(limited.status).toBe(429);
  expect((await limited.json()).code).toBe('RATE_LIMITED');
  expect(
    (await service.handle(req(path() + '/bookmark', 2, 'PUT'))).status,
  ).toBe(200);
});
it('hides removed content immediately from all lists and totals, and excludes hard expiry even for admin', async () => {
  await db.operator.query(
    "UPDATE thoughts SET status='hidden' WHERE public_id=$1",
    [id],
  );
  expect(
    (await (await service.handle(req('/api/me/bookmarks', 1))).json()).items,
  ).toEqual([]);
  expect(
    (
      await service.handle(
        req(path() + '/reaction', 1, 'PUT', { type: 'love' }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await service.handle(req(path() + '/bookmark', 1, 'DELETE'))).status,
  ).toBe(404);
  expect(
    await (await service.handle(req(path() + '/viewer', 1))).json(),
  ).toEqual({ canManage: false, myReaction: null, bookmarked: false });
  expect(
    (await (await service.handle(req('/api/me/thoughts'))).json()).items,
  ).toEqual([]);
  for (const actor of [0, 2])
    expect((await service.handle(req(totals(), actor))).status).toBe(404);
  // An exact 720-hour-old row is expired before maintenance runs.
  const expiredId = 't_' + randomBytes(16).toString('hex');
  await db.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at) SELECT $1,author_id,'Expired fictional interaction','hope',public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,statement_timestamp()-interval '720 hours' FROM thoughts WHERE public_id=$2`,
    [expiredId, id],
  );
  for (const actor of [0, 1, 2])
    expect(
      (
        await service.handle(
          req(`/api/me/thoughts/${expiredId}/reactions`, actor),
        )
      ).status,
    ).toBe(404);
  expect(
    (await service.handle(req(`/api/thoughts/${expiredId}/bookmark`, 1, 'PUT')))
      .status,
  ).toBe(404);
  await service.handle(req(path(), 0, 'DELETE'));
  expect((await service.handle(req(totals(), 2))).status).toBe(404);
  expect(
    (await db.operator.query('SELECT count(*)::int n FROM reactions')).rows[0]
      .n,
  ).toBe(0);
  expect(
    (await db.operator.query('SELECT count(*)::int n FROM bookmarks')).rows[0]
      .n,
  ).toBe(0);
});

it('paginates 21 real own and bookmarked rows with a 20-item cap, no duplicates and no foreign, hidden or expired content', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const point = await coarsenPhilippinesPoint(db.pool, 14.6, 120.98);
  const own: string[] = [],
    saved: string[] = [];
  // Explicit historical test data only; each batch consumes the real quota,
  // then ages its creation events to simulate publications on previous days.
  for (let index = 0; index < 24; index++) {
    for (const actor of [0, 2]) {
      await db.operator.query(
        "UPDATE post_quota_events SET created_at=statement_timestamp()-interval '25 hours' WHERE author_id=$1",
        [actors[actor].id],
      );
      const publicId = `t_${randomBytes(16).toString('hex')}`;
      await db.operator.query(
        `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at,status) VALUES($1,$2,'Clearly fictional pagination fixture','hope',ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,1,$7,statement_timestamp()-($8::int*interval '1 day'),$9)`,
        [
          publicId,
          actors[actor].id,
          point.lng,
          point.lat,
          point.privacyCell,
          point.privacyTier,
          point.label,
          index === 23 ? 31 : 1,
          index === 22 ? 'hidden' : 'published',
        ],
      );
      if (actor === 2)
        await db.operator.query(
          'INSERT INTO bookmarks(user_id,thought_id) SELECT $1,id FROM thoughts WHERE public_id=$2',
          [actors[index === 21 ? 0 : 1].id, publicId],
        );
      if (index < 21) (actor === 0 ? own : saved).push(publicId);
    }
  }
  // Row21 of the owner is a deliberate extra foreign-to-bookmark record; remove
  // it so the independently expected own page is exactly21 eligible rows.
  const ownRows = (
    await db.operator.query(
      "SELECT public_id FROM thoughts WHERE author_id=$1 AND body='Clearly fictional pagination fixture' AND status='published' AND expires_at>now()",
      [actors[0].id],
    )
  ).rows;
  for (const row of ownRows)
    if (!own.includes(row.public_id))
      await db.operator.query('DELETE FROM thoughts WHERE public_id=$1', [
        row.public_id,
      ]);
  for (const [endpoint, actor, expected, nested] of [
    ['/api/me/thoughts', 0, own.sort(), true],
    ['/api/me/bookmarks', 1, saved.sort(), false],
  ] as const) {
    const firstResponse = await service.handle(req(endpoint, actor));
    expect(firstResponse.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(20);
    const ids = first.items.map(
      (item: { publicId: string; thought: { publicId: string } }) =>
        nested ? item.thought.publicId : item.publicId,
    );
    expect(ids).toEqual(expected.slice(0, 20));
    expect(first.nextCursor).toBe(expected[19]);
    const second = await (
      await service.handle(req(`${endpoint}?cursor=${first.nextCursor}`, actor))
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    ids.push(
      nested ? second.items[0].thought.publicId : second.items[0].publicId,
    );
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(21);
  }
  // Preserve the pre-existing lifecycle cases' isolated initial fixture state.
  await db.operator.query(
    "DELETE FROM thoughts WHERE body='Clearly fictional pagination fixture'",
  );
}, 30000);
