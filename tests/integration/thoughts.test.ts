import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
vi.mock('server-only', () => ({}));

let fixture: Awaited<ReturnType<typeof createMapDatabase>>;
let auth: ReturnType<typeof createAuthService>;
let service: { handle: (r: Request) => Promise<Response> };
const origin = 'http://127.0.0.1:3000';
const password = randomBytes(24).toString('hex');
const email = `thought-${randomBytes(8).toString('hex')}@test.invalid`;
let cookie = '',
  authorId = '';
const input = (body = 'A fictional quiet hope.') => ({
  body,
  emotion: 'hope',
  location: { lat: 14.59951237, lng: 120.98421943 },
});
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  session = cookie,
) {
  return new Request(origin + path, {
    method,
    headers: { origin, cookie: session, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  fixture = await createMapDatabase({ maxConnections: 3 });
  auth = createAuthService({
    pool: fixture.pool,
    origin,
    secret: randomBytes(48).toString('hex'),
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  expect(
    (
      await auth.handle(
        request('/api/auth/sign-up/email', 'POST', { email, password }),
      )
    ).status,
  ).toBe(200);
  authorId = (
    await fixture.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1 RETURNING id',
      [email],
    )
  ).rows[0].id;
  const login = await auth.handle(
    request('/api/auth/sign-in/email', 'POST', { email, password }),
  );
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const loadedModule = await import('../../src/server/thoughts/service').catch(
    () => ({}),
  );
  const factory = (
    loadedModule as {
      createThoughtService?: (options: unknown) => typeof service;
    }
  ).createThoughtService;
  service = factory?.({ auth, pool: fixture.pool, origin }) ?? {
    handle: async () => new Response(null, { status: 404 }),
  };
}, 60000);
afterAll(async () => {
  await fixture?.close();
});

it('requires current consent and verified auth, then publishes only a safe coarse DTO', async () => {
  expect(
    (await service.handle(request('/api/thoughts', 'POST', input(), '')))
      .status,
  ).toBe(401);
  expect(
    (await service.handle(request('/api/thoughts', 'POST', input()))).status,
  ).toBe(403);
  expect(
    (
      await service.handle(
        request('/api/me/consent', 'PUT', { version: 'old-guidelines' }),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await service.handle(
        request('/api/me/consent', 'PUT', { version: 'guidelines-2026-10-19' }),
      )
    ).status,
  ).toBe(200);
  const out = await service.handle(request('/api/thoughts', 'POST', input()));
  expect(out.status).toBe(201);
  const dto = await out.json();
  expect(dto).toMatchObject({
    body: 'A fictional quiet hope.',
    emotion: 'hope',
    location: { label: 'Metro Manila' },
  });
  expect(dto.location.lat).not.toBe(14.59951237);
  expect(dto.location.lng).not.toBe(120.98421943);
  expect(JSON.stringify(dto)).not.toMatch(
    /author|userId|privacyCell|totals|14\.59951237|120\.98421943/,
  );
  expect(
    new Date(dto.expiresAt).getTime() - new Date(dto.createdAt).getTime(),
  ).toBe(2592000000);
  const guest = await service.handle(
    request(`/api/thoughts/${dto.publicId}`, 'GET', undefined, ''),
  );
  expect(await guest.json()).toEqual(dto);
  expect(guest.headers.get('cache-control')).toContain('no-store');
  const { queryMapPins } = await import('../../src/server/geo/pins');
  const map = await queryMapPins(
    fixture.pool,
    new URLSearchParams({ bbox: '-180,-85,180,85', zoom: '1' }),
  );
  expect(
    map.features.some(
      (feature) => feature.properties.publicId === dto.publicId,
    ),
  ).toBe(true);
  expect(
    (await service.handle(request('/api/thoughts', 'POST', input()))).status,
  ).toBe(422);
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int n FROM post_quota_events WHERE author_id=$1',
        [authorId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it('blocks invalid content, raw-location overrides, unverified and suspended bypasses', async () => {
  expect(
    (
      await service.handle(
        new Request(origin + '/api/thoughts', {
          method: 'POST',
          headers: {
            origin: 'https://foreign.invalid',
            'content-type': 'application/json',
            cookie,
          },
          body: JSON.stringify(input()),
        }),
      )
    ).status,
  ).toBe(403);
  for (const body of [
    '',
    'e\u0301'.repeat(281),
    'Email me at private@test.invalid',
    'https://scam.test buy now',
    'kill yourself',
  ]) {
    expect(
      (await service.handle(request('/api/thoughts', 'POST', input(body))))
        .status,
    ).toBe(422);
  }
  expect(
    (
      await service.handle(
        request('/api/thoughts', 'POST', {
          ...input(),
          location: { lat: 0, lng: 0 },
        }),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await service.handle(
        request('/api/thoughts', 'POST', { ...input(), authorId }),
      )
    ).status,
  ).toBe(422);
  await fixture.operator.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [authorId],
  );
  expect(
    (await service.handle(request('/api/thoughts', 'POST', input()))).status,
  ).toBe(403);
  await fixture.operator.query(
    'UPDATE "user" SET email_verified=true WHERE id=$1',
    [authorId],
  );
  await fixture.operator.query(
    "UPDATE profiles SET status='suspended' WHERE user_id=$1",
    [authorId],
  );
  expect(
    (await service.handle(request('/api/thoughts', 'POST', input()))).status,
  ).toBe(403);
  await fixture.operator.query(
    "UPDATE profiles SET status='active' WHERE user_id=$1",
    [authorId],
  );
});

it('edits keep lifetime and location, owner checks deny outsiders, deletion cannot restore quota', async () => {
  const created = await service.handle(
    request(
      '/api/thoughts',
      'POST',
      input('I feel suicidal but I am reaching out for care.'),
    ),
  );
  expect(created.status).toBe(201);
  const dto = await created.json();
  const path = `/api/thoughts/${dto.publicId}`;
  expect(
    (
      await service.handle(
        request(path, 'PATCH', {
          body: 'Edited fictional hope.',
          emotion: 'gratitude',
        }),
      )
    ).status,
  ).toBe(200);
  const edited = await (await service.handle(request(path))).json();
  expect(edited.createdAt).toBe(dto.createdAt);
  expect(edited.expiresAt).toBe(dto.expiresAt);
  expect(edited.location).toEqual(dto.location);
  expect(
    (
      await service.handle(
        request(path, 'PATCH', { location: { lat: 14, lng: 121 } }),
      )
    ).status,
  ).toBe(422);
  const other = `other-${randomBytes(8).toString('hex')}@test.invalid`;
  await auth.handle(
    request('/api/auth/sign-up/email', 'POST', { email: other, password }),
  );
  await fixture.operator.query(
    'UPDATE "user" SET email_verified=true WHERE email=$1',
    [other],
  );
  const login = await auth.handle(
    request('/api/auth/sign-in/email', 'POST', { email: other, password }),
  );
  const outsider = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(
    (await service.handle(request(path, 'PATCH', { body: 'Stolen' }, outsider)))
      .status,
  ).toBe(404);
  expect(
    (await service.handle(request(path, 'DELETE', undefined, outsider))).status,
  ).toBe(404);
  expect((await service.handle(request(path, 'DELETE'))).status).toBe(200);
  expect((await service.handle(request(path))).status).toBe(404);
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int n FROM post_quota_events WHERE author_id=$1',
        [authorId],
      )
    ).rows[0].n,
  ).toBe(2);
});

it('serializes concurrent real publication requests and counts exactly five creation events', async () => {
  const outputs = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      service.handle(
        request(
          '/api/thoughts',
          'POST',
          input(`Concurrent fictional hope ${i}`),
        ),
      ),
    ),
  );
  expect(outputs.map((r) => r.status).sort()).toEqual([
    201, 201, 201, 429, 429, 429,
  ]);
  const limited = outputs.find((r) => r.status === 429)!;
  expect((await limited.json()).code).toBe('POST_LIMIT_REACHED');
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int n FROM post_quota_events WHERE author_id=$1',
        [authorId],
      )
    ).rows[0].n,
  ).toBe(5);
});

it('never serves hidden or exact-expiry detail and cleanup drains dependent live records with no overlap', async () => {
  const rows = await fixture.operator.query(
    'SELECT public_id FROM thoughts WHERE author_id=$1 ORDER BY created_at',
    [authorId],
  );
  const hidden = rows.rows[0].public_id;
  await fixture.operator.query(
    "UPDATE thoughts SET status='hidden' WHERE public_id=$1",
    [hidden],
  );
  expect(
    (await service.handle(request(`/api/thoughts/${hidden}`))).status,
  ).toBe(404);
  const id = randomBytes(16).toString('hex');
  await fixture.operator.query(
    `INSERT INTO "user"(id,name,email,email_verified) VALUES($1,'Fictional',$2,true)`,
    [id, `expiry-${id}@test.invalid`],
  );
  await fixture.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
  VALUES($1,$2,'Expired fictional thought','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila',statement_timestamp()-interval '720 hours')`,
    [`t_${id}`, id],
  );
  expect((await service.handle(request(`/api/thoughts/t_${id}`))).status).toBe(
    404,
  );
  const expired = (
    await fixture.operator.query('SELECT id FROM thoughts WHERE public_id=$1', [
      `t_${id}`,
    ])
  ).rows[0].id;
  await fixture.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    SELECT public_id||'x',author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at FROM thoughts WHERE public_id=$1`,
    [`t_${id}`],
  );
  await fixture.operator.query(
    "INSERT INTO reactions(user_id,thought_id,type) VALUES($1,$2,'care')",
    [authorId, expired],
  );
  await fixture.operator.query(
    'INSERT INTO bookmarks(user_id,thought_id) VALUES($1,$2)',
    [authorId, expired],
  );
  await fixture.operator.query(
    "INSERT INTO reports(thought_id,reason) VALUES($1,'other')",
    [expired],
  );
  const loadedModule =
    await import('../../src/server/db/maintenance.mjs').catch(() => ({}));
  const run = (
    loadedModule as {
      runMaintenance?: (c: unknown, o?: unknown) => Promise<unknown>;
    }
  ).runMaintenance;
  expect(run).toBeTypeOf('function');
  const competing = new pg.Client({ connectionString: fixture.runtimeUrl });
  await competing.connect();
  await competing.query('SELECT pg_advisory_lock(196742,5)');
  try {
    expect(await run?.(fixture.operator)).toEqual({ skipped: true });
  } finally {
    await competing.query('SELECT pg_advisory_unlock(196742,5)');
    await competing.end();
  }
  const restricted = new pg.Client({ connectionString: fixture.runtimeUrl });
  await restricted.connect();
  let result: unknown;
  try {
    await expect(run?.(restricted)).rejects.toMatchObject({ code: '42501' });
    // Keep the failed connection open: disconnect must not be what releases
    // the job lock. A different client must acquire it immediately.
    result = await run?.(fixture.operator, { batchSize: 1 });
  } finally {
    await restricted.end();
  }
  expect(result).toMatchObject({ skipped: false, totals: { thoughts: 2 } });
  expect(
    (
      await fixture.operator.query(
        'SELECT count(*)::int n FROM thoughts WHERE public_id=$1',
        [`t_${id}`],
      )
    ).rows[0].n,
  ).toBe(0);
  for (const table of ['reactions', 'bookmarks', 'reports'])
    expect(
      (
        await fixture.operator.query(
          `SELECT count(*)::int n FROM ${table} WHERE thought_id=$1`,
          [expired],
        )
      ).rows[0].n,
    ).toBe(0);
  expect(await run?.(fixture.operator)).toMatchObject({
    skipped: false,
    totals: {
      thoughts: 0,
      post_quota_events: 0,
      rate_limit_counters: 0,
      verification: 0,
      session: 0,
      admin_audit: 0,
    },
  });
});
