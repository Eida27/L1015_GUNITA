import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
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
async function post(path: string, body: unknown, cookie = '') {
  return service.handle(
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      body: JSON.stringify(body),
    }),
  );
}
async function mail(kind: 'verify' | 'reset', address = email) {
  const list = await (
    await fetch('http://127.0.0.1:8028/api/v1/messages')
  ).json();
  const item = list.messages.find(
    (m: { To: { Address: string }[]; Subject: string }) =>
      m.To.some((to) => to.Address === address) &&
      m.Subject.includes(kind === 'verify' ? 'Verify' : 'Reset'),
  );
  expect(item).toBeTruthy();
  const message = await (
    await fetch(`http://127.0.0.1:8028/api/v1/message/${item.ID}`)
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
    service = createAuthService({
      pool,
      origin,
      secret: authSecret,
      smtpPort: 1028,
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
  });
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
  });
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
  });
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
  });
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
      "INSERT INTO reports(thought_id,reporter_user_id,reason) VALUES($1,$2,'other')",
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
  });
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
  });
  it('durably throttles wrong credentials across service instances and ignores spoofed forwarding', async () => {
    const address = `limit-${suffix}@test.invalid`;
    for (let attempt = 0; attempt < 10; attempt++)
      expect(
        (await post('/api/auth/sign-in/email', { email: address, password }))
          .status,
      ).toBe(401);
    const restarted = createAuthService({
      pool,
      origin,
      secret: authSecret,
      smtpPort: 1028,
    });
    const denied = await restarted.handle(
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
    expect(denied.status).toBe(429);
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
    for (let i = 0; i < 5; i++)
      expect((await one.handle(request())).status).toBe(200);
    const limited = await two.handle(request());
    expect(limited.status).toBe(429);
    expect(
      (
        await db.query(
          "SELECT bool_and(bucket_hmac ~ '^[a-f0-9]{64}$') safe,max(expires_at-window_start)<=interval '24 hours' ttl FROM rate_limit_counters",
        )
      ).rows[0],
    ).toEqual({ safe: true, ttl: true });
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
});
