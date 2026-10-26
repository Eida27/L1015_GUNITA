import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { smtpSender } from '../../src/server/auth/email';
import { randomBytes, createHmac } from 'node:crypto';
import { loadLocalEnv } from '../../scripts/load-env.mjs';
import { loadDatabaseEnv } from '../../scripts/database-env.mjs';
import { migrate } from '../../src/server/db/migrate.mjs';
import { provisionRoles, grantRuntime } from '../../src/server/db/roles.mjs';
import { createAuthService } from '../../src/server/auth/service';
import {
  requireAuthenticated,
  requireVerifiedMember,
  requireAdmin,
  requireOwner,
} from '../../src/server/auth/guards';

loadLocalEnv();
loadDatabaseEnv();
const suffix = randomBytes(8).toString('hex');
const name = `gunita_test_${suffix}`;
const migrationRole = `gunita_test_m_${suffix.slice(0, 12)}`;
const runtimeRole = `gunita_test_r_${suffix.slice(0, 12)}`;
const origin = 'http://127.0.0.1:3000';
const password = randomBytes(24).toString('hex');
const authSecret = randomBytes(48).toString('hex');
const email = `auth-${suffix}@test.invalid`;
let cookie = '',
  secondCookie = '',
  verificationToken = '',
  resetToken = '';
let admin: pg.Client, db: pg.Client, pool: pg.Pool;
let service: ReturnType<typeof createAuthService>;
const observedLogs: string[] = [];
// Optional content-free timings for real integration boundaries; no auth/SMTP
// operation or assertion is replaced. Useful when diagnosing a suite timeout.
async function measure<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    if (process.env.GUNITA_AUTH_TIMING === 'true')
      process.stderr.write(
        JSON.stringify({
          operation,
          ms: Math.round(performance.now() - started),
        }) + '\n',
      );
  }
}
async function post(path: string, body: unknown, cookie = '') {
  return measure(path, () =>
    service.handle(
      new Request(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, cookie },
        body: JSON.stringify(body),
      }),
    ),
  );
}
async function mail(kind: 'verify' | 'reset', address = email) {
  const list = await (
    await fetch('http://127.0.0.1:8028/api/v1/messages', {
      signal: AbortSignal.timeout(3000),
    })
  ).json();
  const item = list.messages.find(
    (m: { To: { Address: string }[]; Subject: string }) =>
      m.To.some((to) => to.Address === address) &&
      m.Subject.includes(kind === 'verify' ? 'Verify' : 'Reset'),
  );
  expect(item).toBeTruthy();
  const message = await (
    await fetch(`http://127.0.0.1:8028/api/v1/message/${item.ID}`, {
      signal: AbortSignal.timeout(3000),
    })
  ).json();
  expect(message.Text).not.toContain(password);
  const link = message.Text.match(/http:\/\/127\.0\.0\.1:3000\/[^\s]+/)[0];
  const url = new URL(link);
  expect(url.search).toBe('');
  return new URLSearchParams(url.hash.slice(1)).get('token')!;
}
function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// Instrument the real connection at a query boundary. No query, result, hash,
// library operation or persistence side effect is replaced by a test double.
function controlledService(boundary: {
  before?: (sql: string) => boolean;
  after?: (sql: string) => boolean;
}) {
  const reached = deferred<void>(),
    release = deferred<void>(),
    pid = deferred<number>();
  let paused = false;
  const intercepted = new Proxy(pool, {
    get(target, key) {
      if (key === 'connect')
        return async () => {
          const client = await target.connect();
          pid.resolve(
            (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid,
          );
          return new Proxy(client, {
            get(connection, property) {
              if (property === 'query')
                return async (...args: unknown[]) => {
                  const sql =
                    typeof args[0] === 'string'
                      ? args[0]
                      : String((args[0] as { text?: string })?.text || '');
                  const pause = async () => {
                    paused = true;
                    reached.resolve();
                    await release.promise;
                  };
                  if (!paused && boundary.before?.(sql)) await pause();
                  const query = connection.query.bind(connection) as (
                    ...values: unknown[]
                  ) => Promise<pg.QueryResult>;
                  const result = await query(...args);
                  if (!paused && boundary.after?.(sql)) await pause();
                  return result;
                };
              const value = Reflect.get(connection, property);
              return typeof value === 'function'
                ? value.bind(connection)
                : value;
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    service: createAuthService({
      pool: intercepted,
      origin,
      secret: authSecret,
      smtpPort: 1028,
    }),
    reached,
    release,
    pid,
  };
}
async function resolvedOrBlocked(
  request: Promise<Response>,
  waiter: number,
  blocker: number,
) {
  let completed = false;
  void request.then(() => {
    completed = true;
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (completed) return 'completed';
    const row = (
      await db.query('SELECT $2::integer=ANY(pg_blocking_pids($1)) blocked', [
        waiter,
        blocker,
      ])
    ).rows[0];
    if (row.blocked) return 'blocked';
  }
  throw new Error('Expected real database lock wait or request completion');
}
const userLockQuery = (sql: string) =>
  /from\s+"user"/i.test(sql) && /for update/i.test(sql);
function requestFor(path: string, body: unknown, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: path === '/api/me/account' ? 'DELETE' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function raceIdentity(label: string) {
  const address = `${label}-${suffix}@test.invalid`;
  expect(
    (await post('/api/auth/sign-up/email', { email: address, password }))
      .status,
  ).toBe(200);
  expect(
    (
      await post('/api/auth/verify-email', {
        token: await mail('verify', address),
      })
    ).status,
  ).toBe(200);
  const login = await post('/api/auth/sign-in/email', {
    email: address,
    password,
  });
  expect(login.status).toBe(200);
  expect(
    (await post('/api/auth/request-password-reset', { email: address })).status,
  ).toBe(200);
  return {
    email: address,
    cookie: sessionCookie(login),
    token: await mail('reset', address),
    id: (await db.query('SELECT id FROM "user" WHERE email=$1', [address]))
      .rows[0].id,
  };
}
describe('real Better Auth and Mailpit account lifecycle', () => {
  beforeAll(async () => {
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        observedLogs.push(
          args
            .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
            .join(' '),
        );
      });
    const root = process.env.BOOTSTRAP_DATABASE_URL!;
    admin = new pg.Client({ connectionString: root });
    await admin.connect();
    if (!/^gunita_test_[a-f0-9]{16}$/.test(name))
      throw new Error('Unsafe database');
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(root);
    url.pathname = `/${name}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('CREATE EXTENSION postgis');
    const rolePassword = randomBytes(24).toString('hex');
    await provisionRoles(db, {
      migrationRole,
      runtimeRole,
      migrationPassword: rolePassword,
      runtimePassword: rolePassword,
    });
    const migrationUrl = new URL(url);
    migrationUrl.username = migrationRole;
    migrationUrl.password = rolePassword;
    const migrator = new pg.Client({
      connectionString: migrationUrl.toString(),
    });
    await migrator.connect();
    try {
      await migrate(migrator);
    } finally {
      await migrator.end();
    }
    await grantRuntime(db, runtimeRole);
    url.username = runtimeRole;
    url.password = rolePassword;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    const smtp = smtpSender(origin, 1028);
    service = createAuthService({
      pool,
      origin,
      secret: authSecret,
      smtpPort: 1028,
      sendEmail: {
        check: () => measure('smtp-check', () => smtp.check()),
        send: (mail) => measure('smtp-send', () => smtp.send(mail)),
      },
    });
  }, 60000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await db?.end();
    if (admin) {
      if (!/^gunita_test_[a-f0-9]{16}$/.test(name))
        throw new Error('Unsafe database');
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      for (const role of [runtimeRole, migrationRole]) {
        if (!/^gunita_test_[mr]_[a-f0-9]{12}$/.test(role))
          throw new Error('Unsafe role');
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      }
      await admin.end();
    }
  });
  it('creates an atomic permanent server identity despite hostile signup fields', async () => {
    const response = await post('/api/auth/sign-up/email', {
      email,
      password,
      name: 'Real Name',
      pseudonym: 'ChosenName-123',
      role: 'admin',
      emailVerified: true,
      image: 'https://attacker.invalid/pixel',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    const row = (
      await db.query(
        'SELECT u.name,u.image,u.email_verified,p.pseudonym,p.role,p.status FROM "user" u JOIN profiles p ON p.user_id=u.id WHERE u.email=$1',
        [email],
      )
    ).rows[0];
    expect(row).toMatchObject({
      image: null,
      email_verified: false,
      role: 'member',
      status: 'active',
    });
    expect(row.name).toBe(row.pseudonym);
    expect(row.pseudonym).toMatch(/^[A-Za-z]+-[a-f0-9]{24}$/);
  });
  it('delivers verification without credentials and gives duplicate signup a generic receipt', async () => {
    verificationToken = await mail('verify');
    const duplicate = await post('/api/auth/sign-up/email', {
      email: email.toUpperCase(),
      password,
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ status: true });
    expect(
      (await db.query('SELECT count(*)::int n FROM "user"')).rows[0].n,
    ).toBe(1);
  });
  it('blocks unverified login, guests, foreign origins and all library bypass endpoints', async () => {
    const login = await post('/api/auth/sign-in/email', { email, password });
    expect(login.status).toBe(403);
    expect((await login.json()).code).toBe('EMAIL_UNVERIFIED');
    expect(
      (await service.handle(new Request(`${origin}/api/me/account`))).status,
    ).toBe(401);
    for (const path of [
      'update-user',
      'delete-user',
      'delete-user/callback',
      'change-email',
      'change-password',
      'set-password',
      'sign-up/social',
      'sign-in/social',
      'get-session',
      'reset-password/anything',
    ]) {
      expect((await post(`/api/auth/${path}`, {})).status).toBe(404);
    }
    const cross = await service.handle(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          origin: 'https://attacker.invalid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(cross.status).toBe(403);
  });
  it('consumes verification exactly once and rejects expired tokens', async () => {
    const verified = await post('/api/auth/verify-email', {
      token: verificationToken,
    });
    expect(verified.status).toBe(200);
    expect(
      (await post('/api/auth/verify-email', { token: verificationToken }))
        .status,
    ).toBe(400);
    const expiredEmail = `expired-${suffix}@test.invalid`;
    await post('/api/auth/sign-up/email', { email: expiredEmail, password });
    const token = await mail('verify', expiredEmail);
    await db.query(
      'UPDATE verification SET expires_at=now()-interval \'1 second\' WHERE value=(SELECT id::text FROM "user" WHERE email=$1)',
      [expiredEmail],
    );
    expect((await post('/api/auth/verify-email', { token })).status).toBe(400);
  });
  it('sets safe cookies, hides session tokens and never stores request IP/user-agent', async () => {
    const login = await service.handle(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-forwarded-for': '1.2.3.4',
          'cf-connecting-ip': '5.6.7.8',
          'user-agent': 'SensitiveBrowser/PrivateDevice',
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ status: true });
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(login.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    cookie = sessionCookie(login);
    expect(cookie).toContain('session_token=');
    const second = await post('/api/auth/sign-in/email', { email, password });
    secondCookie = sessionCookie(second);
    expect(
      (await db.query('SELECT ip_address,user_agent FROM session')).rows,
    ).toEqual([
      { ip_address: null, user_agent: null },
      { ip_address: null, user_agent: null },
    ]);
    const settings = await service.handle(
      new Request(`${origin}/api/me/account`, { headers: { cookie } }),
    );
    expect(settings.status).toBe(200);
    expect(settings.headers.get('cache-control')).toBe('private, no-store');
    expect(await settings.json()).toMatchObject({ email, emailVerified: true });
  });
  it('enforces guest, unverified, verified, admin and other-owner guards from current DB state', async () => {
    const headers = new Headers({ cookie });
    const guard = (
      kind: 'auth' | 'verified' | 'admin' | 'owner',
      ownerId = '00000000-0000-4000-8000-000000000000',
      h = headers,
    ) =>
      service.withAuthTransaction((ctx) =>
        kind === 'auth'
          ? requireAuthenticated(ctx, h)
          : kind === 'verified'
            ? requireVerifiedMember(ctx, h)
            : kind === 'admin'
              ? requireAdmin(ctx, h)
              : requireOwner(ctx, h, ownerId),
      );
    await expect(
      guard('verified', undefined, new Headers()),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const actor = await guard('verified');
    await expect(guard('owner')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await guard('owner', actor.userId)).userId).toBe(actor.userId);
    await expect(guard('admin')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.query('UPDATE "user" SET email_verified=false WHERE id=$1', [
      actor.userId,
    ]);
    expect((await guard('auth')).emailVerified).toBe(false);
    await expect(guard('verified')).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    });
    const deletion = await service.handle(
      new Request(`${origin}/api/me/account`, {
        method: 'DELETE',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
    );
    expect(deletion.status).toBe(403);
    await db.query('UPDATE "user" SET email_verified=true WHERE id=$1', [
      actor.userId,
    ]);
    await db.query("UPDATE profiles SET role='admin' WHERE user_id=$1", [
      actor.userId,
    ]);
    expect((await guard('admin')).role).toBe('admin');
    await db.query("UPDATE profiles SET role='member' WHERE user_id=$1", [
      actor.userId,
    ]);
  });
  it('rejects suspended current state and restores access without trusting cached sessions', async () => {
    await db.query(
      'UPDATE profiles SET status=\'suspended\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
      [email],
    );
    expect(
      (
        await service.handle(
          new Request(`${origin}/api/me/account`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(403);
    const request = await post('/api/auth/request-password-reset', { email });
    expect(request.status).toBe(200);
    await db.query(
      'UPDATE profiles SET status=\'active\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
      [email],
    );
    expect(
      (
        await service.handle(
          new Request(`${origin}/api/me/account`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(200);
  });
  it('keeps resend responses generic when a different account is signed in', async () => {
    const known = await post(
      '/api/auth/send-verification-email',
      { email: `expired-${suffix}@test.invalid` },
      cookie,
    );
    const unknown = await post(
      '/api/auth/send-verification-email',
      { email: `unknown-${suffix}@test.invalid` },
      cookie,
    );
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual({ status: true });
    expect(await unknown.json()).toEqual({ status: true });
  }, 15000);
  it('reset revalidates status, atomically consumes the token and revokes every session', async () => {
    expect(
      (await post('/api/auth/request-password-reset', { email })).status,
    ).toBe(200);
    resetToken = await mail('reset');
    await db.query(
      'UPDATE profiles SET status=\'suspended\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
      [email],
    );
    expect(
      (
        await post('/api/auth/reset-password', {
          token: resetToken,
          newPassword: password + 'new',
        })
      ).status,
    ).toBe(400);
    await db.query(
      'UPDATE profiles SET status=\'active\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
      [email],
    );
    const resets = await Promise.all([
      post('/api/auth/reset-password', {
        token: resetToken,
        newPassword: password + 'new',
      }),
      post('/api/auth/reset-password', {
        token: resetToken,
        newPassword: password + 'new',
      }),
    ]);
    expect(resets.map((r) => r.status).sort()).toEqual([200, 400]);
    for (const oldCookie of [cookie, secondCookie])
      expect(
        (
          await service.handle(
            new Request(`${origin}/api/me/account`, {
              headers: { cookie: oldCookie },
            }),
          )
        ).status,
      ).toBe(401);
    expect(
      (await post('/api/auth/sign-in/email', { email, password })).status,
    ).toBe(401);
    cookie = sessionCookie(
      await post('/api/auth/sign-in/email', {
        email,
        password: password + 'new',
      }),
    );
  }, 15000);
  it('rolls token consumption, session revocation and password update back together on database failure', async () => {
    await post('/api/auth/request-password-reset', { email });
    const token = await mail('reset');
    const id = (await db.query('SELECT id FROM "user" WHERE email=$1', [email]))
      .rows[0].id;
    const sessions = (
      await db.query('SELECT count(*)::int n FROM session WHERE user_id=$1', [
        id,
      ])
    ).rows[0].n;
    const oldHash = (
      await db.query('SELECT password FROM account WHERE user_id=$1', [id])
    ).rows[0].password;
    try {
      await db.query(
        "CREATE FUNCTION fail_auth_test_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic password-write failure'; END $$",
      );
      await db.query(
        'CREATE TRIGGER fail_auth_test_update BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION fail_auth_test_update()',
      );
      expect(
        (
          await post('/api/auth/reset-password', {
            token,
            newPassword: password + 'failed',
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM session WHERE user_id=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(sessions);
      expect(
        (await db.query('SELECT password FROM account WHERE user_id=$1', [id]))
          .rows[0].password,
      ).toBe(oldHash);
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM verification WHERE identifier=$1',
            [`reset-password:${token}`],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS fail_auth_test_update ON account');
      await db.query('DROP FUNCTION IF EXISTS fail_auth_test_update()');
    }
  }, 15000);
  it('rejects expired resets and logs out through library cookies/session revocation', async () => {
    await post('/api/auth/request-password-reset', { email });
    const token = await mail('reset');
    await db.query(
      "UPDATE verification SET expires_at=now()-interval '1 second' WHERE identifier LIKE 'reset-password:%'",
    );
    expect(
      (
        await post('/api/auth/reset-password', {
          token,
          newPassword: password + 'other',
        })
      ).status,
    ).toBe(400);
    const out = await post('/api/auth/sign-out', {}, cookie);
    expect(out.status).toBe(200);
    expect(
      (
        await service.handle(
          new Request(`${origin}/api/me/account`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(401);
    cookie = sessionCookie(
      await post('/api/auth/sign-in/email', {
        email,
        password: password + 'new',
      }),
    );
  }, 15000);
  it('requires password reauthentication for deletion and cascades all sessions', async () => {
    const remove = (body: unknown) =>
      service.handle(
        new Request(`${origin}/api/me/account`, {
          method: 'DELETE',
          headers: { origin, cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    expect((await remove({})).status).toBe(422);
    expect((await remove({ password: 'wrong-password' })).status).toBe(401);
    const before = (
      await db.query('SELECT id FROM "user" WHERE email=$1', [email])
    ).rows[0].id;
    const thought = (
      await db.query(
        "INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label) VALUES($1,$2,'Disposable account deletion fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila') RETURNING id",
        [`t_${randomBytes(16).toString('hex')}`, before],
      )
    ).rows[0].id;
    const other = (
      await db.query('SELECT id FROM "user" WHERE email LIKE $1', [
        `expired-${suffix}%`,
      ])
    ).rows[0].id;
    await db.query(
      "INSERT INTO reactions(user_id,thought_id,type) VALUES($1,$2,'care')",
      [other, thought],
    );
    await db.query('INSERT INTO bookmarks(user_id,thought_id) VALUES($1,$2)', [
      other,
      thought,
    ]);
    await db.query(
      "INSERT INTO reports(thought_id,reporter_user_id,reporter_category,reason) VALUES($1,$2,'member','other')",
      [thought, other],
    );
    await post('/api/auth/request-password-reset', { email });
    const deleteResetToken = await mail('reset');
    const deleted = await remove({ password: password + 'new' });
    expect(deleted.status).toBe(200);
    for (const table of ['user', 'profiles', 'session', 'account']) {
      const field = table === 'user' ? 'id' : 'user_id';
      expect(
        (
          await db.query(
            `SELECT count(*)::int n FROM "${table}" WHERE ${field}=$1`,
            [before],
          )
        ).rows[0].n,
      ).toBe(0);
    }
    expect(
      (
        await service.handle(
          new Request(`${origin}/api/me/account`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(401);
    for (const table of [
      'thoughts',
      'reactions',
      'bookmarks',
      'reports',
      'post_quota_events',
    ])
      expect(
        (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
      ).toBe(0);
    expect(
      (
        await post('/api/auth/reset-password', {
          token: deleteResetToken,
          newPassword: password + 'deleted',
        })
      ).status,
    ).toBe(400);
  }, 15000);
  it('gives the same SMTP-down state for known, duplicate and unknown recipients', async () => {
    const bad = createAuthService({
      pool,
      origin,
      secret: randomBytes(48).toString('hex'),
      smtpPort: 1,
    });
    const address = `delivery-${suffix}@test.invalid`;
    const result = await bad.handle(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, password }),
      }),
    );
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain(address);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [
          address,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM profiles p LEFT JOIN "user" u ON u.id=p.user_id WHERE u.id IS NULL',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM verification WHERE value NOT IN (SELECT id::text FROM "user")',
        )
      ).rows[0].n,
    ).toBe(0);
    const known = `expired-${suffix}@test.invalid`;
    for (const action of [
      'sign-up/email',
      'request-password-reset',
      'send-verification-email',
    ]) {
      for (const email of [known, address]) {
        const response = await bad.handle(
          new Request(`${origin}/api/auth/${action}`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          }),
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          code: 'EMAIL_DELIVERY_FAILED',
          message: 'Email delivery is unavailable. Please try again.',
        });
      }
    }
  });
  it('rolls back a sender exception swallowed by Better Auth and preserves generic receipts', async () => {
    const bad = createAuthService({
      pool,
      origin,
      secret: randomBytes(48).toString('hex'),
      sendEmail: {
        check: async () => {},
        send: async () => {
          throw new Error('Synthetic provider rejection');
        },
      },
    });
    const address = `sender-${suffix}@test.invalid`;
    for (const action of [
      'sign-up/email',
      'request-password-reset',
      'send-verification-email',
    ]) {
      for (const email of [address, `expired-${suffix}@test.invalid`]) {
        const response = await bad.handle(
          new Request(`${origin}/api/auth/${action}`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: true });
      }
    }
    expect(
      (
        await db.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [
          address,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it('retries actual pseudonym collisions and rolls back after bounded exhaustion', async () => {
    const original = (
      await db.query(
        "SELECT pg_get_functiondef('generate_account_pseudonym()'::regprocedure) definition",
      )
    ).rows[0].definition;
    const taken = (await db.query('SELECT pseudonym FROM profiles LIMIT 1'))
      .rows[0].pseudonym;
    try {
      await db.query(
        `CREATE OR REPLACE FUNCTION generate_account_pseudonym() RETURNS text LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $fn$ BEGIN IF current_setting('gunita.collision_seen',true) IS DISTINCT FROM 'yes' THEN PERFORM set_config('gunita.collision_seen','yes',true); RETURN '${taken}'; END IF; RETURN 'QuietLantern-aaaaaaaaaaaaaaaaaaaaaaaa'; END $fn$`,
      );
      const address = `collision-${suffix}@test.invalid`;
      expect(
        (await post('/api/auth/sign-up/email', { email: address, password }))
          .status,
      ).toBe(200);
      expect(
        (await db.query('SELECT name FROM "user" WHERE email=$1', [address]))
          .rows[0].name,
      ).toBe('QuietLantern-aaaaaaaaaaaaaaaaaaaaaaaa');
      await db.query(
        `CREATE OR REPLACE FUNCTION generate_account_pseudonym() RETURNS text LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $fn$ SELECT '${taken}'::text $fn$`,
      );
      const exhausted = `exhausted-${suffix}@test.invalid`;
      expect(
        (await post('/api/auth/sign-up/email', { email: exhausted, password }))
          .status,
      ).toBe(500);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [
            exhausted,
          ])
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await db.query(original);
    }
  }, 15000);
  it('durably throttles wrong credentials across service instances and ignores spoofed forwarding', async () => {
    const address = `limit-${suffix}@test.invalid`;
    const observed = new Map<string, { count: number; window_start: Date }>();
    const observeAttempt = async (
      bucket: string,
      action: string,
      response: Response,
      cap: number,
      allowed: number,
    ) => {
      const current = (
        await db.query(
          'SELECT count,window_start FROM rate_limit_counters WHERE bucket_hmac=$1 AND route_group=$2 ORDER BY window_start DESC LIMIT 1',
          [bucket, `auth:${action}`],
        )
      ).rows[0];
      const previous = observed.get(bucket);
      const sameWindow =
        previous?.window_start.getTime() === current.window_start.getTime();
      expect(current.count).toBe(sameWindow ? previous!.count + 1 : 1);
      expect(response.status).toBe(current.count <= cap ? allowed : 429);
      observed.set(bucket, current);
      return current;
    };
    const loginBucket = createHmac('sha256', authSecret)
      .update(`auth:v1:email:${address}`)
      .digest('hex');
    let firstLoginWindow = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await post('/api/auth/sign-in/email', {
        email: address,
        password,
      });
      expect(response.status).toBe(401);
      const state = await observeAttempt(
        loginBucket,
        'sign-in/email',
        response,
        10,
        401,
      );
      if (attempt === 0) firstLoginWindow = state.window_start.getTime();
    }
    const restarted = createAuthService({
      pool,
      origin,
      secret: authSecret,
      smtpPort: 1028,
    });
    const repeatedLogin = () =>
      restarted.handle(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'x-forwarded-for': '8.8.8.8',
          },
          body: JSON.stringify({ email: address, password }),
        }),
      );
    let denied = await repeatedLogin();
    let loginState = await observeAttempt(
      loginBucket,
      'sign-in/email',
      denied,
      10,
      401,
    );
    // Fixed windows legitimately reset while these real scrypt/SMTP requests
    // run. Extra successes are valid only in a different persisted window.
    for (let extra = 0; denied.status !== 429 && extra < 10; extra++) {
      expect(loginState.window_start.getTime()).not.toBe(firstLoginWindow);
      expect(denied.status).toBe(401);
      denied = await repeatedLogin();
      loginState = await observeAttempt(
        loginBucket,
        'sign-in/email',
        denied,
        10,
        401,
      );
    }
    expect(denied.status).toBe(429);
    expect(loginState.count).toBe(11);
    // Share the same service secret in both fresh instances, as a real restart does.
    const one = createAuthService({
      pool,
      origin,
      secret: 'limit-fixture-secret-with-at-least-32-characters',
      smtpPort: 1028,
    });
    const two = createAuthService({
      pool,
      origin,
      secret: 'limit-fixture-secret-with-at-least-32-characters',
      smtpPort: 1028,
    });
    const request = () =>
      new Request(`${origin}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-forwarded-for': randomBytes(4).toString('hex'),
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ email: address }),
      });
    const resetBucket = createHmac(
      'sha256',
      'limit-fixture-secret-with-at-least-32-characters',
    )
      .update(`auth:v1:email:${address}`)
      .digest('hex');
    let firstResetWindow = 0;
    for (let i = 0; i < 5; i++) {
      const response = await one.handle(request());
      expect(response.status).toBe(200);
      const state = await observeAttempt(
        resetBucket,
        'request-password-reset',
        response,
        5,
        200,
      );
      if (i === 0) firstResetWindow = state.window_start.getTime();
    }
    let limited = await two.handle(request());
    let resetState = await observeAttempt(
      resetBucket,
      'request-password-reset',
      limited,
      5,
      200,
    );
    for (let extra = 0; limited.status !== 429 && extra < 5; extra++) {
      expect(resetState.window_start.getTime()).not.toBe(firstResetWindow);
      expect(limited.status).toBe(200);
      limited = await two.handle(request());
      resetState = await observeAttempt(
        resetBucket,
        'request-password-reset',
        limited,
        5,
        200,
      );
    }
    expect(limited.status).toBe(429);
    expect(resetState.count).toBe(6);
    expect(
      (
        await db.query(
          "SELECT bool_and(bucket_hmac ~ '^[a-f0-9]{64}$') safe,max(expires_at-window_start)<=interval '24 hours' ttl FROM rate_limit_counters",
        )
      ).rows[0],
    ).toEqual({ safe: true, ttl: true });
  }, 30000);
  it('uses the actual new DB window after a saturated previous window and enforces the new budget across restart', async () => {
    const address = `boundary-${suffix}@test.invalid`;
    const secret = 'boundary-fixture-secret-with-at-least-32-characters';
    const bucket = createHmac('sha256', secret)
      .update(`auth:v1:email:${address}`)
      .digest('hex');
    await db.query(
      `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at)
      VALUES($1,'auth:request-password-reset',to_timestamp(floor(extract(epoch from statement_timestamp())/900)*900)-interval '15 minutes',5,to_timestamp(floor(extract(epoch from statement_timestamp())/900)*900))`,
      [bucket],
    );
    const first = createAuthService({ pool, origin, secret, smtpPort: 1028 });
    const next = createAuthService({ pool, origin, secret, smtpPort: 1028 });
    const request = () =>
      new Request(`${origin}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });
    expect((await first.handle(request())).status).toBe(200);
    const observed = await db.query(
      "SELECT count,expires_at<=statement_timestamp() AS old FROM rate_limit_counters WHERE bucket_hmac=$1 AND route_group='auth:request-password-reset' ORDER BY window_start",
      [bucket],
    );
    expect(observed.rows).toEqual([
      { count: 5, old: true },
      { count: 1, old: false },
    ]);
    // Fill only this real current window; the next request must use the DB
    // counter even in a fresh service instance. No library/clock is mocked.
    await db.query(
      'UPDATE rate_limit_counters SET count=5 WHERE bucket_hmac=$1 AND expires_at>statement_timestamp()',
      [bucket],
    );
    expect((await next.handle(request())).status).toBe(429);
  }, 30000);
  it('serializes duplicate signup races without partial accounts or enumeration responses', async () => {
    const address = `race-${suffix}@test.invalid`;
    const results = await Promise.all([
      post('/api/auth/sign-up/email', { email: address, password }),
      post('/api/auth/sign-up/email', {
        email: address.toUpperCase(),
        password,
      }),
    ]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ status: true });
    }
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "user" u JOIN profiles p ON p.user_id=u.id JOIN account a ON a.user_id=u.id WHERE u.email=$1',
          [address],
        )
      ).rows[0].n,
    ).toBe(1);
  }, 30000);
  it('does not log email, password, credential hashes, verification or reset tokens', async () => {
    const hashes = (
      await db.query('SELECT password FROM account WHERE password IS NOT NULL')
    ).rows.map((r) => r.password);
    const sensitive = [
      email,
      password,
      verificationToken,
      resetToken,
      ...hashes,
    ].filter(Boolean);
    expect(
      observedLogs.some((line) =>
        sensitive.some((value) => line.includes(value)),
      ),
    ).toBe(false);
  });
  it('does not let unrelated cookies bypass a token throttle', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      expect(
        (
          await post(
            '/api/auth/verify-email',
            { token: 'invalid-rate-token' },
            `unrelated=${attempt}`,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await post(
          '/api/auth/verify-email',
          { token: 'invalid-rate-token' },
          'unrelated=last',
        )
      ).status,
    ).toBe(429);
  });
  describe('account lock protocol interleavings', () => {
    it('keeps expired session discovery read-only for maintenance cleanup', async () => {
      const identity = await raceIdentity('expired-discovery');
      await db.query(
        "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [identity.id],
      );
      const holder = await pool.connect(),
        probe = controlledService({});
      let read: Promise<Response> | undefined,
        resolution = '';
      try {
        await holder.query('BEGIN');
        await holder.query(
          'SELECT id FROM session WHERE user_id=$1 FOR UPDATE',
          [identity.id],
        );
        const holderPid = (await holder.query('SELECT pg_backend_pid() pid'))
          .rows[0].pid;
        read = probe.service.handle(
          new Request(`${origin}/api/me/account`, {
            headers: { cookie: identity.cookie },
          }),
        );
        resolution = await resolvedOrBlocked(
          read,
          await within(probe.pid.promise, 'Guard connection missing'),
          holderPid,
        );
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      expect((await read!).status).toBe(401);
      expect(resolution).toBe('completed');
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM session WHERE user_id=$1',
            [identity.id],
          )
        ).rows[0].n,
      ).toBe(1);
    }, 30000);
    it('never leaves an old-password login session alive after a concurrent reset', async () => {
      const identity = await raceIdentity('login-race');
      const login = controlledService({
        after: (sql) => /select/i.test(sql) && /from\s+"account"/i.test(sql),
      });
      const reset = controlledService({});
      const loginResult = login.service.handle(
        requestFor('/api/auth/sign-in/email', {
          email: identity.email,
          password,
        }),
      );
      let resetResult: Promise<Response> | undefined;
      try {
        await within(
          login.reached.promise,
          'Library credential read was not reached',
        );
        resetResult = reset.service.handle(
          requestFor('/api/auth/reset-password', {
            token: identity.token,
            newPassword: password + 'changed',
          }),
        );
        await resolvedOrBlocked(
          resetResult,
          await within(reset.pid.promise, 'Reset connection missing'),
          await login.pid.promise,
        );
      } finally {
        login.release.resolve();
      }
      const signedIn = await loginResult,
        changed = await resetResult!;
      expect(changed.status).toBe(200);
      expect([200, 401]).toContain(signedIn.status);
      if (signedIn.status === 200) {
        const probe = await service.handle(
          new Request(`${origin}/api/me/account`, {
            headers: { cookie: sessionCookie(signedIn) },
          }),
        );
        expect(probe.status).toBe(401);
      }
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM session WHERE user_id=$1',
            [identity.id],
          )
        ).rows[0].n,
      ).toBe(0);
    }, 30000);
    it('serializes reset behind deletion without a token/user lock inversion or HTTP500', async () => {
      const identity = await raceIdentity('delete-race');
      const deletion = controlledService({ after: userLockQuery }),
        reset = controlledService({});
      const deleted = deletion.service.handle(
        requestFor('/api/me/account', { password }, identity.cookie),
      );
      let changed: Promise<Response> | undefined;
      try {
        await within(
          deletion.reached.promise,
          'Deletion account lock was not reached',
        );
        changed = reset.service.handle(
          requestFor('/api/auth/reset-password', {
            token: identity.token,
            newPassword: password + 'changed',
          }),
        );
        expect(
          await resolvedOrBlocked(
            changed,
            await within(reset.pid.promise, 'Reset connection missing'),
            await deletion.pid.promise,
          ),
        ).toBe('blocked');
      } finally {
        deletion.release.resolve();
      }
      const results = await Promise.all([deleted, changed!]);
      expect(results.map((response) => response.status)).toEqual([200, 400]);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM "user" WHERE id=$1', [
            identity.id,
          ])
        ).rows[0].n,
      ).toBe(0);
    }, 30000);
    it('rejects an old-password login queued behind a reset account lock', async () => {
      const identity = await raceIdentity('reset-first');
      const reset = controlledService({ after: userLockQuery }),
        login = controlledService({});
      const changed = reset.service.handle(
        requestFor('/api/auth/reset-password', {
          token: identity.token,
          newPassword: password + 'changed',
        }),
      );
      let signedIn: Promise<Response> | undefined;
      try {
        await within(
          reset.reached.promise,
          'Reset account lock was not reached',
        );
        signedIn = login.service.handle(
          requestFor('/api/auth/sign-in/email', {
            email: identity.email,
            password,
          }),
        );
        expect(
          await resolvedOrBlocked(
            signedIn,
            await within(login.pid.promise, 'Login connection missing'),
            await reset.pid.promise,
          ),
        ).toBe('blocked');
      } finally {
        reset.release.resolve();
      }
      const results = await Promise.all([changed, signedIn!]);
      expect(results.map((response) => response.status)).toEqual([200, 401]);
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM session WHERE user_id=$1',
            [identity.id],
          )
        ).rows[0].n,
      ).toBe(0);
    }, 30000);
    it('keeps initial session discovery read-only when a due refresh overlaps reset', async () => {
      const identity = await raceIdentity('refresh-race');
      await db.query(
        "UPDATE session SET created_at=now()-interval '2 days',updated_at=now()-interval '2 days',expires_at=now()+interval '5 days' WHERE user_id=$1",
        [identity.id],
      );
      const guard = controlledService({ before: userLockQuery }),
        reset = controlledService({});
      const read = guard.service.handle(
        new Request(`${origin}/api/me/account`, {
          headers: { cookie: identity.cookie },
        }),
      );
      let changed: Promise<Response> | undefined;
      try {
        await within(
          guard.reached.promise,
          'Guard account lock boundary was not reached',
        );
        changed = reset.service.handle(
          requestFor('/api/auth/reset-password', {
            token: identity.token,
            newPassword: password + 'changed',
          }),
        );
        await resolvedOrBlocked(
          changed,
          await within(reset.pid.promise, 'Reset connection missing'),
          await guard.pid.promise,
        );
      } finally {
        guard.release.resolve();
      }
      const results = await Promise.all([changed!, read]);
      expect(results.map((response) => response.status)).toEqual([200, 401]);
    }, 30000);
  });
});
