import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
import { createThoughtService } from '../../src/server/thoughts/service';
import { publicThoughtSchema } from '../../src/lib/thought-contract';

vi.mock('server-only', () => ({}));
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let auth: ReturnType<typeof createAuthService>;
let service: ReturnType<typeof createThoughtService>;
const origin = 'http://127.0.0.1:3000';
const actors: { id: string; cookie: string }[] = [];
let target: string;
const request = (path: string, actor = 0, method = 'GET', body?: unknown) =>
  new Request(origin + path, {
    method,
    headers: {
      origin,
      cookie: actors[actor]?.cookie ?? '',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const input = (body: string) => ({
  body,
  emotion: 'hope',
  location: { lat: 14.6, lng: 120.98 },
});
async function counts() {
  return (
    await db.operator.query(`SELECT
      (SELECT count(*)::int FROM thoughts) thoughts,
      (SELECT count(*)::int FROM reactions) reactions,
      (SELECT count(*)::int FROM bookmarks) bookmarks,
      (SELECT count(*)::int FROM post_quota_events) quota`)
  ).rows[0];
}
beforeAll(async () => {
  db = await createMapDatabase({ maxConnections: 4 });
  auth = createAuthService({
    pool: db.pool,
    origin,
    secret: randomBytes(48).toString('hex'),
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  service = createThoughtService({ auth, pool: db.pool, origin });
  for (let i = 0; i < 2; i++) {
    const email = `acceptance-${randomBytes(8).toString('hex')}@test.invalid`;
    const password = randomBytes(24).toString('hex');
    expect(
      (
        await auth.handle(
          request('/api/auth/sign-up/email', -1, 'POST', { email, password }),
        )
      ).status,
    ).toBe(200);
    const user = await db.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1 RETURNING id',
      [email],
    );
    const login = await auth.handle(
      request('/api/auth/sign-in/email', -1, 'POST', { email, password }),
    );
    expect(login.status).toBe(200);
    actors.push({
      id: user.rows[0].id,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    });
    expect(
      (
        await service.handle(
          request('/api/me/consent', i, 'PUT', {
            version: 'guidelines-2026-10-19',
          }),
        )
      ).status,
    ).toBe(200);
  }
}, 60000);
afterAll(async () => {
  await db?.close();
});

it('POST-01/02 and ID-01: accepts 280 graphemes with joined emoji, rejects 281, and keeps the same public pseudonym', async () => {
  const body = 'a'.repeat(279) + '👨‍👩‍👧‍👦';
  const first = await service.handle(
    request('/api/thoughts', 0, 'POST', input(body)),
  );
  expect(first.status).toBe(201);
  const dto = publicThoughtSchema.parse(await first.json());
  expect(dto.body).toBe(body);
  target = dto.publicId;
  const before = await counts();
  expect(
    (
      await service.handle(
        request('/api/thoughts', 0, 'POST', input(body + 'b')),
      )
    ).status,
  ).toBe(422);
  expect(await counts()).toEqual(before);
  const second = await service.handle(
    request(
      '/api/thoughts',
      0,
      'POST',
      input('Another fictional acceptance thought.'),
    ),
  );
  expect(second.status).toBe(201);
  const other = publicThoughtSchema.parse(await second.json());
  expect(other.pseudonym).toBe(dto.pseudonym);
  expect(other.publicId).not.toBe(dto.publicId);
  expect(JSON.stringify([dto, other])).not.toMatch(
    /authorId|userId|profile|email/,
  );
});

it('AUTH-02/03 and MAP-02: denied guest, unverified and outside-PH writes leave content and quota unchanged', async () => {
  const before = await counts();
  for (const actor of [-1, 0]) {
    if (actor === 0)
      await db.operator.query(
        'UPDATE "user" SET email_verified=false WHERE id=$1',
        [actors[0].id],
      );
    try {
      for (const [path, method, body] of [
        ['/api/thoughts', 'POST', input('Denied fictional write.')],
        [`/api/thoughts/${target}/reaction`, 'PUT', { type: 'care' }],
        [`/api/thoughts/${target}/bookmark`, 'PUT', {}],
      ] as const) {
        expect(
          (await service.handle(request(path, actor, method, body))).status,
        ).toBe(actor < 0 ? 401 : 403);
      }
    } finally {
      if (actor === 0)
        await db.operator.query(
          'UPDATE "user" SET email_verified=true WHERE id=$1',
          [actors[0].id],
        );
    }
  }
  expect(
    (
      await service.handle(
        request('/api/thoughts', 0, 'POST', {
          ...input('Outside fictional write.'),
          location: { lat: 0, lng: 0 },
        }),
      )
    ).status,
  ).toBe(422);
  expect(await counts()).toEqual(before);
});

it('POST-05: an actual day-29 edit preserves its original day-30 expiry, identity and coarse location', async () => {
  const oldId = `t_${randomBytes(16).toString('base64url')}`;
  await db.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    SELECT $1,author_id,'Fictional day-29 thought',emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,statement_timestamp()-interval '29 days'
    FROM thoughts WHERE public_id=$2`,
    [oldId, target],
  );
  const path = `/api/thoughts/${oldId}`;
  const before = publicThoughtSchema.parse(
    await (await service.handle(request(path))).json(),
  );
  const age = Date.now() - Date.parse(before.createdAt);
  expect(age).toBeGreaterThanOrEqual(29 * 86400000);
  expect(age).toBeLessThan(29 * 86400000 + 60000);
  const snapshot = await (await service.handle(request(path + '/edit'))).json();
  const editRequest = request(path, 0, 'PATCH', {
    body: 'Edited at day 29.',
    emotion: 'gratitude',
  });
  editRequest.headers.set('if-match', snapshot.version);
  expect((await service.handle(editRequest)).status).toBe(200);
  const after = publicThoughtSchema.parse(
    await (await service.handle(request(path))).json(),
  );
  expect(after).toEqual({
    ...before,
    body: 'Edited at day 29.',
    emotion: 'gratitude',
  });
  expect(Date.parse(after.expiresAt) - Date.parse(after.createdAt)).toBe(
    30 * 86400000,
  );
});

it('POST-03/04: after four creations including one deletion, two contenders yield exactly one fifth and one 429', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const out = await service.handle(
      request('/api/thoughts', 1, 'POST', input(`Fictional quota setup ${i}.`)),
    );
    expect(out.status).toBe(201);
    ids.push((await out.json()).publicId);
  }
  expect(
    (await service.handle(request(`/api/thoughts/${ids[0]}`, 1, 'DELETE')))
      .status,
  ).toBe(200);
  const results = await Promise.all(
    [0, 1].map((i) =>
      service.handle(
        request(
          '/api/thoughts',
          1,
          'POST',
          input(`Fictional fifth contender ${i}.`),
        ),
      ),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
  expect((await results.find((r) => r.status === 429)!.json()).code).toBe(
    'POST_LIMIT_REACHED',
  );
  const result = await db.operator.query(
    `SELECT
    (SELECT count(*)::int FROM post_quota_events WHERE author_id=$1) quota,
    (SELECT count(*)::int FROM thoughts WHERE author_id=$1) live`,
    [actors[1].id],
  );
  expect(result.rows[0]).toEqual({ quota: 5, live: 4 });
});

it('ID-02: author-query and profile discovery have no service endpoint; private list rejects a supplied userId', async () => {
  for (const [path, status] of [
    [`/api/thoughts?author=${actors[0].id}`, 422],
    [`/api/users/${actors[0].id}`, 404],
    [`/api/profiles/${actors[0].id}`, 404],
  ] as const) {
    const out = await service.handle(request(path));
    expect(out.status).toBe(status);
    expect(await out.text()).not.toContain(actors[0].id);
  }
  expect(
    (await service.handle(request(`/api/me/thoughts?userId=${actors[1].id}`)))
      .status,
  ).toBe(422);
});
