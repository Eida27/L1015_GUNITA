import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createMapDatabase } from '../fixtures/map-database';
import { createAuthService } from '../../src/server/auth/service';
import { createThoughtService } from '../../src/server/thoughts/service';
import { createModerationService } from '../../src/server/moderation/service';
import { localTurnstileToken } from '../../src/lib/turnstile-local';
import {
  turnstileConfig,
  TEST_SITE_KEY,
  TEST_SECRET_KEY,
} from '../../src/server/security/turnstile';
import { bootstrapAdmin } from '../../scripts/admin-bootstrap-lib.mjs';
import { verifyTurnstile, claimOnce } from '../../src/server/security/abuse';
import { SPENT_SECRET_KEY } from '../../src/server/security/turnstile';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
vi.mock('server-only', () => ({}));
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let auth: ReturnType<typeof createAuthService>;
let thoughts: ReturnType<typeof createThoughtService>;
const origin = 'http://127.0.0.1:3000';
const secret = randomBytes(48).toString('hex');
const actors: { id: string; cookie: string; email: string }[] = [];
let id: string;
// Initially the existing boundary has no moderation routes. Replace this
// adapter with the new boundary once this missing behavior is observed.
let handle: (request: Request) => Promise<Response>;
const req = (path: string, actor = -1, method = 'GET', body?: unknown) =>
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
  auth = createAuthService({
    pool: db.pool,
    origin,
    secret,
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  thoughts = createThoughtService({ auth, pool: db.pool, origin, secret });
  handle = createModerationService({
    auth,
    origin,
    pool: db.pool,
    secret,
    turnstile: turnstileConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: origin,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
      TURNSTILE_SECRET_KEY: TEST_SECRET_KEY,
    }),
  }).handle;
  for (let i = 0; i < 3; i++) {
    const email = `moderation-${randomBytes(8).toString('hex')}@test.invalid`,
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
  await thoughts.handle(
    req('/api/me/consent', 0, 'PUT', { version: 'guidelines-2026-10-19' }),
  );
  const post = await thoughts.handle(
    req('/api/thoughts', 0, 'POST', {
      body: 'Clearly fictional moderation fixture.',
      emotion: 'hope',
      location: { lat: 14.6, lng: 120.98 },
    }),
  );
  expect(post.status).toBe(201);
  id = (await post.json()).publicId;
}, 60000);
afterAll(async () => {
  await db?.close();
});
it('rejects guest and member admin access with private responses', async () => {
  for (const path of [
    '/api/admin/reports',
    '/api/admin/audit',
    '/api/admin/accounts',
  ]) {
    expect((await handle(req(path))).status).toBe(401);
    expect((await handle(req(path, 0))).status).toBe(403);
  }
});
it('admin can hide and unhide a nonexpired thought with a content-free audit', async () => {
  const path = `/api/admin/thoughts/${id}/moderate`;
  expect(
    (
      await handle(
        req(path, 1, 'POST', { action: 'hide', reasonCode: 'PRIVATE_INFO' }),
      )
    ).status,
  ).toBe(200);
  expect((await thoughts.handle(req(`/api/thoughts/${id}`))).status).toBe(404);
  expect(
    (
      await handle(
        req(path, 1, 'POST', { action: 'unhide', reasonCode: 'NO_VIOLATION' }),
      )
    ).status,
  ).toBe(200);
  expect((await thoughts.handle(req(`/api/thoughts/${id}`))).status).toBe(200);
  const audit = await handle(req('/api/admin/audit', 1));
  expect(audit.status).toBe(200);
  const json = JSON.stringify(await audit.json());
  expect(json).toContain('PRIVATE_INFO');
  expect(json).not.toContain('Clearly fictional');
  for (const actor of actors) expect(json).not.toContain(actor.email);
});
it('suspends and unsuspends an account and revokes its sessions', async () => {
  const path = `/api/admin/accounts/${actors[0].id}/suspension`;
  expect(
    (
      await handle(
        req(path, 1, 'POST', { suspended: true, reasonCode: 'SPAM' }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await db.operator.query(
        'SELECT count(*)::int n FROM session WHERE user_id=$1',
        [actors[0].id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await handle(
        req(path, 1, 'POST', { suspended: false, reasonCode: 'NO_VIOLATION' }),
      )
    ).status,
  ).toBe(200);
});
it('accepts a guest report through actual Siteverify, dedupes, rejects replay and never hides from report volume', async () => {
  const token = localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report');
  const body = {
    thoughtPublicId: id,
    reason: 'spam',
    details: 'Fictional report detail.',
    turnstileToken: token,
  };
  expect((await handle(req('/api/reports', -1, 'POST', body))).status).toBe(
    200,
  );
  expect((await handle(req('/api/reports', -1, 'POST', body))).status).toBe(
    403,
  );
  expect(
    (
      await handle(
        req('/api/reports', -1, 'POST', {
          ...body,
          turnstileToken: localTurnstileToken(
            'XXXX.DUMMY.TOKEN.XXXX',
            'report',
          ),
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await db.operator.query('SELECT count(*)::int n FROM reports')).rows[0].n,
  ).toBe(1);
  expect((await thoughts.handle(req(`/api/thoughts/${id}`))).status).toBe(200);
  const queue = await handle(req('/api/admin/reports', 1));
  expect(queue.status).toBe(200);
  const items = (await queue.json()).items;
  expect(items[0]).toMatchObject({
    reason: 'spam',
    reporterCategory: 'guest',
    thought: { publicId: id },
    author: { id: actors[0].id },
  });
  expect(
    (
      await handle(
        req(`/api/admin/reports/${items[0].id}`, 1, 'PATCH', {
          status: 'reviewing',
          reasonCode: 'SPAM',
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await handle(
        req(`/api/admin/reports/${items[0].id}`, 1, 'PATCH', {
          status: 'resolved',
          reasonCode: 'NO_VIOLATION',
        }),
      )
    ).status,
  ).toBe(200);
}, 30000);
it('requires actual registration verification and rejects a token reused across report and registration', async () => {
  const config = turnstileConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    TURNSTILE_SECRET_KEY: TEST_SECRET_KEY,
  });
  const protectedAuth = createAuthService({
    pool: db.pool,
    origin,
    secret,
    sendEmail: { check: async () => {}, send: async () => {} },
    turnstile: config,
  });
  const credentials = {
    email: `registration-${randomBytes(8).toString('hex')}@test.invalid`,
    password: randomBytes(24).toString('hex'),
  };
  expect(
    (
      await protectedAuth.handle(
        req('/api/auth/sign-up/email', -1, 'POST', credentials),
      )
    ).status,
  ).toBe(403);
  const token = localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'registration');
  expect(
    (
      await protectedAuth.handle(
        req('/api/auth/sign-up/email', -1, 'POST', {
          ...credentials,
          turnstileToken: token,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await protectedAuth.handle(
        req('/api/auth/sign-up/email', -1, 'POST', {
          ...credentials,
          turnstileToken: token,
        }),
      )
    ).status,
  ).toBe(403);
}, 30000);
it('bootstrap requires exact verified email and confirmation, runtime cannot promote', async () => {
  await expect(
    bootstrapAdmin(db.operator, actors[0].email, 'wrong'),
  ).rejects.toThrow();
  await expect(
    bootstrapAdmin(
      db.operator,
      actors[0].email.toUpperCase(),
      actors[0].email.toUpperCase(),
    ),
  ).rejects.toThrow();
  await expect(
    bootstrapAdmin(db.operator, actors[0].email, actors[0].email),
  ).resolves.toEqual({ status: true });
  expect(
    (
      await db.operator.query('SELECT role FROM profiles WHERE user_id=$1', [
        actors[0].id,
      ])
    ).rows[0].role,
  ).toBe('admin');
  const client = await db.pool.connect();
  try {
    await expect(
      bootstrapAdmin(client, actors[0].email, actors[0].email),
    ).rejects.toThrow();
  } finally {
    client.release();
  }
});
it('serializes two admins in both directions before any account guard can invert locks', async () => {
  const config = turnstileConfig({ NODE_ENV: 'test', APP_ORIGIN: origin });
  const ordered = [1, 2].sort((a, b) =>
    actors[a].id.localeCompare(actors[b].id),
  );
  for (const firstIndex of ordered) {
    const secondIndex = ordered.find((i) => i !== firstIndex)!;
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      }),
      resume = new Promise<void>((resolve) => {
        release = resolve;
      });
    let firstPid = 0;
    const firstAuth = {
      withAuthTransaction: <T>(
        work: Parameters<typeof auth.withAuthTransaction<T>>[0],
      ) =>
        auth.withAuthTransaction(async (context) => {
          firstPid = (await context.client.query('SELECT pg_backend_pid() pid'))
            .rows[0].pid;
          const query = context.client.query.bind(context.client);
          let held = false;
          context.client.query = (async (...args: Parameters<typeof query>) => {
            const result = await query(...args);
            if (
              !held &&
              String(args[0]).includes('"user"') &&
              String(args[0]).includes('FOR UPDATE')
            ) {
              held = true;
              acquired();
              await resume;
            }
            return result;
          }) as typeof context.client.query;
          try {
            return await work(context);
          } finally {
            context.client.query = query;
          }
        }),
    };
    const first = createModerationService({
      auth: firstAuth,
      origin,
      pool: db.pool,
      secret,
      turnstile: config,
    }).handle(
      req(
        `/api/admin/accounts/${actors[secondIndex].id}/suspension`,
        firstIndex,
        'POST',
        { suspended: false, reasonCode: 'NO_VIOLATION' },
      ),
    );
    await locked;
    const second = handle(
      req(
        `/api/admin/accounts/${actors[firstIndex].id}/suspension`,
        secondIndex,
        'POST',
        { suspended: false, reasonCode: 'NO_VIOLATION' },
      ),
    );
    try {
      await vi.waitFor(
        async () => {
          const blocking = await db.operator.query(
            'SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
            [firstPid],
          );
          expect(blocking.rows[0].n).toBe(1);
        },
        { timeout: 3000, interval: 20 },
      );
    } finally {
      release();
    }
    expect((await Promise.all([first, second])).map((r) => r.status)).toEqual([
      200, 200,
    ]);
  }
}, 15000);
it('rejects actual spent Siteverify, cross-route replay, spoofed forwarding and fourth guest attempt durably', async () => {
  const config = turnstileConfig({ NODE_ENV: 'test', APP_ORIGIN: origin });
  await expect(
    verifyTurnstile(
      db.pool,
      secret,
      { ...config, secret: SPENT_SECRET_KEY },
      localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report'),
      'report',
    ),
  ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
  const token = localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'registration');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    expect(
      await claimOnce(client, secret, `turnstile:${token}`, 'turnstile', 300),
    ).toBe(true);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  await expect(
    verifyTurnstile(db.pool, secret, config, token, 'registration'),
  ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
  // Precisely isolate this fixture's report budget. No app or retained DB touched.
  await db.operator.query(
    "DELETE FROM rate_limit_counters WHERE route_group='reports'",
  );
  for (let i = 0; i < 4; i++) {
    const request = req('/api/reports', -1, 'POST', {
      thoughtPublicId: id,
      reason: 'other',
      turnstileToken: localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report'),
    });
    request.headers.set('x-forwarded-for', `192.0.2.${i + 1}`);
    request.headers.set('cf-connecting-ip', `192.0.2.${i + 1}`);
    const fresh = createModerationService({
      auth,
      origin,
      pool: db.pool,
      secret,
      turnstile: config,
    });
    expect((await fresh.handle(request)).status).toBe(i < 3 ? 200 : 429);
  }
  expect(
    JSON.stringify(
      (await db.operator.query('SELECT * FROM rate_limit_counters')).rows,
    ),
  ).not.toContain('192.0.2.');
}, 30000);
it('validates admin boundaries and never restores an expired target', async () => {
  const path = `/api/admin/thoughts/${id}/moderate`;
  const forged = req(path, -1, 'POST', {
    action: 'hide',
    reasonCode: 'SPAM',
    role: 'admin',
  });
  forged.headers.set('cookie', 'better-auth.session_token=forged');
  expect((await handle(forged)).status).toBe(422);
  const badOrigin = req(path, 1, 'POST', {
    action: 'hide',
    reasonCode: 'SPAM',
  });
  badOrigin.headers.set('origin', 'https://evil.invalid');
  expect((await handle(badOrigin)).status).toBe(403);
  expect(
    (
      await handle(
        req(path, 1, 'POST', {
          action: 'hide',
          reasonCode: 'email@example.invalid',
        }),
      )
    ).status,
  ).toBe(422);
  await db.operator.query(
    'ALTER TABLE thoughts DISABLE TRIGGER thoughts_immutable',
  );
  try {
    await db.operator.query(
      "UPDATE thoughts SET created_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE public_id=$1",
      [id],
    );
  } finally {
    await db.operator.query(
      'ALTER TABLE thoughts ENABLE TRIGGER thoughts_immutable',
    );
  }
  expect(
    (
      await handle(
        req(path, 1, 'POST', { action: 'unhide', reasonCode: 'NO_VIOLATION' }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await (await handle(req('/api/admin/reports', 1))).json()).items,
  ).toEqual([]);
});
it('revalidates current admin role, verification and suspension after a valid cookie was issued', async () => {
  for (const [sql, restore] of [
    [
      "UPDATE profiles SET role='member' WHERE user_id=$1",
      "UPDATE profiles SET role='admin' WHERE user_id=$1",
    ],
    [
      'UPDATE "user" SET email_verified=false WHERE id=$1',
      'UPDATE "user" SET email_verified=true WHERE id=$1',
    ],
    [
      "UPDATE profiles SET status='suspended' WHERE user_id=$1",
      "UPDATE profiles SET status='active' WHERE user_id=$1",
    ],
  ]) {
    await db.operator.query(sql, [actors[1].id]);
    try {
      expect((await handle(req('/api/admin/reports', 1))).status).toBe(403);
    } finally {
      await db.operator.query(restore, [actors[1].id]);
    }
  }
});
it('rolls moderation back on audit failure and hard-deletes content/dependencies with erased audit linkage', async () => {
  const publicId = `t_${randomBytes(16).toString('base64url')}`;
  const created = await db.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
    SELECT $1,author_id,'Fictional deletion fixture',emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label FROM thoughts WHERE public_id=$2 RETURNING id`,
    [publicId, id],
  );
  const thoughtId = created.rows[0].id;
  await db.operator.query(
    "INSERT INTO reports(thought_id,reporter_category,reason) VALUES($1,'guest','other')",
    [thoughtId],
  );
  await db.operator.query(
    "CREATE FUNCTION fixture_deny_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit denied'; END $$",
  );
  await db.operator.query(
    'CREATE TRIGGER fixture_deny_audit BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION fixture_deny_audit()',
  );
  try {
    expect(
      (
        await handle(
          req(`/api/admin/thoughts/${publicId}/moderate`, 1, 'POST', {
            action: 'hide',
            reasonCode: 'OTHER',
          }),
        )
      ).status,
    ).toBe(500);
  } finally {
    await db.operator.query('DROP TRIGGER fixture_deny_audit ON admin_audit');
    await db.operator.query('DROP FUNCTION fixture_deny_audit()');
  }
  expect((await thoughts.handle(req(`/api/thoughts/${publicId}`))).status).toBe(
    200,
  );
  expect(
    (
      await handle(
        req(`/api/admin/thoughts/${publicId}/moderate`, 1, 'POST', {
          action: 'delete',
          reasonCode: 'OTHER',
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await db.operator.query('SELECT 1 FROM reports WHERE thought_id=$1', [
        thoughtId,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await db.operator.query(
        "SELECT subject_thought_id FROM admin_audit WHERE action='delete_thought'",
      )
    ).rows[0].subject_thought_id,
  ).toBeNull();
});
it('runs the bootstrap CLI only against this disposable database and rejects missing confirmation', async () => {
  expect(db.name).toMatch(/^gunita_test_[a-f0-9]{16}$/);
  const url = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  url.pathname = '/' + db.name;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: url.toString(),
    FORCE_COLOR: '0',
  };
  delete env.NO_COLOR;
  const command = resolve('scripts/admin-bootstrap.mjs');
  const rejected = spawnSync(
    process.execPath,
    [command, '--email', actors[1].email],
    { env, encoding: 'utf8', windowsHide: true },
  );
  expect(rejected.status).toBe(1);
  const accepted = spawnSync(
    process.execPath,
    [command, '--email', actors[1].email, '--confirm-email', actors[1].email],
    { env, encoding: 'utf8', windowsHide: true },
  );
  expect(accepted.status).toBe(0);
  expect(accepted.stdout).toContain('Admin bootstrap completed');
  expect(accepted.stdout + accepted.stderr).not.toContain(actors[1].email);
});
