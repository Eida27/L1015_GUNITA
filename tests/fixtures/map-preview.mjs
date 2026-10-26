import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { latLngToCell } from 'h3-js';
import { createMapDatabase } from './map-database.ts';
import { localTurnstileToken } from '../../src/lib/turnstile-local.ts';
import { bootstrapAdmin } from '../../scripts/admin-bootstrap-lib.mjs';
import { seedScaleDatabase } from './scale-database.mjs';

// Explicit opt-in only. This file is never imported by product code.
if (process.env.GUNITA_MAP_FIXTURE !== 'disposable-only')
  throw new Error('Explicit disposable fixture opt-in required');
const port = process.env.GUNITA_MAP_FIXTURE_PORT ?? '3001';
if (!['3001', '3002'].includes(port)) throw new Error('Invalid fixture port');
// Refuse to mistake an unrelated listener for the fixture being started.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(Number(port), '127.0.0.1', () => probe.close(resolve));
});
const fixture = await createMapDatabase();
const origin = `http://127.0.0.1:${port}`;
const childEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  LOCAL_PREVIEW: 'true',
  PORT: port,
  APP_ORIGIN: origin,
  DATABASE_URL: fixture.runtimeUrl,
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1028',
  SMTP_FROM: 'Gunita <no-reply@test.invalid>',
  NODE_OPTIONS: '--max-old-space-size=1536',
  FORCE_COLOR: '0',
  NEXT_TELEMETRY_DISABLED: '1',
};
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: resolve('.'),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: true,
});
let closing = false;
const shutdown = async (code = 0) => {
  if (closing) return;
  closing = true;
  child.kill();
  await fixture.close();
  process.exit(code);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('message', (message) => {
  if (message === 'shutdown') void shutdown();
});
child.on('exit', () => {
  if (!closing) void shutdown(1);
});
try {
  const coldStarted = performance.now();
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!(await fetch(`${origin}/api/ready`)).ok)
    throw new Error('Fixture startup unavailable');
  if (process.env.GUNITA_SCALE_FIXTURE === 'synthetic-10500') {
    if (port !== '3002')
      throw new Error('Scale proof requires disposable automation port');
    const coldReadyMs = performance.now() - coldStarted;
    const firstMap = performance.now();
    const emptyMap = await fetch(
      `${origin}/api/map/pins?bbox=-180,-85,180,85&zoom=1`,
    );
    if (!emptyMap.ok) throw new Error('Cold map unavailable');
    await emptyMap.json();
    const coldFirstMapMs = performance.now() - firstMap;
    const seeded = await seedScaleDatabase(
      fixture,
      async (lat, lng) => {
        const response = await fetch(`${origin}/api/map/preview`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        });
        if (!response.ok) throw new Error('Scale privacy preview failed');
        return response.json();
      },
      'synthetic-test-only',
    );
    await writeFile(
      '.local/phase-8-scale-startup.json',
      JSON.stringify({ coldReadyMs, coldFirstMapMs, seeded }),
    );
  }
  const chosen = [
    [14.5995, 120.9842],
    [14.65, 121.03],
    [14.55, 121.02],
    [10.72, 122.56],
    [10.32, 123.89],
    [7.08, 125.6],
  ];
  const safe = [];
  for (const [lat, lng] of chosen) {
    const response = await fetch(`${origin}/api/map/preview`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    if (!response.ok) throw new Error('Fixture preview rejected');
    safe.push(await response.json());
  }
  await fixture.operator.query(
    `INSERT INTO "user"(id,name,email,email_verified) SELECT md5('browser-'||i)::uuid,'Fictional fixture','browser-'||i||'@test.invalid',true FROM generate_series(1,12) i`,
  );
  for (let i = 0; i < 60; i++) {
    const point = safe[i < 21 ? 0 : i < 38 ? 1 : i < 57 ? 2 : i - 54];
    const tier = point.label === 'Metro Manila' ? 7 : 6;
    await fixture.pool.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
      VALUES($1,$2,'Clearly fictional local map fixture',$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$7,$8,1,$6)`,
      [
        `t_${randomBytes(16).toString('base64url')}`,
        (
          await fixture.operator.query(
            "SELECT md5('browser-'||$1)::uuid AS id",
            [Math.floor(i / 5) + 1],
          )
        ).rows[0].id,
        i % 2 ? 'hope' : 'love',
        point.lng,
        point.lat,
        point.label,
        latLngToCell(point.lat, point.lng, tier),
        tier,
      ],
    );
  }
  await mkdir('.local', { recursive: true });
  if (process.env.GUNITA_THOUGHT_FIXTURE === 'synthetic-only') {
    const identity = {
      email: `thought-browser-${randomBytes(8).toString('hex')}@test.invalid`,
      password: randomBytes(24).toString('hex'),
    };
    const post = (path, method, body, cookie = '') =>
      fetch(origin + path, {
        method,
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(
          path === '/api/auth/sign-up/email'
            ? {
                ...body,
                turnstileToken: localTurnstileToken(
                  'XXXX.DUMMY.TOKEN.XXXX',
                  'registration',
                ),
              }
            : body,
        ),
      });
    if (!(await post('/api/auth/sign-up/email', 'POST', identity)).ok)
      throw new Error('Synthetic registration failed');
    await fixture.operator.query(
      'UPDATE "user" SET email_verified=true WHERE email=$1',
      [identity.email],
    );
    const login = await post('/api/auth/sign-in/email', 'POST', identity);
    if (!login.ok) throw new Error('Synthetic login failed');
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    if (
      !(
        await post(
          '/api/me/consent',
          'PUT',
          { version: 'guidelines-2026-10-19' },
          cookie,
        )
      ).ok
    )
      throw new Error('Synthetic consent failed');
    const published = await post(
      '/api/thoughts',
      'POST',
      {
        body: 'Clearly fictional: a little hope for the morning.',
        emotion: 'hope',
        location: { lat: 14.5995, lng: 120.9842 },
      },
      cookie,
    );
    if (!published.ok) throw new Error('Synthetic publication failed');
    const thought = await published.json();
    let other, admin;
    if (process.env.GUNITA_INTERACTION_FIXTURE === 'synthetic-only') {
      other = {
        email: `interaction-browser-${randomBytes(8).toString('hex')}@test.invalid`,
        password: randomBytes(24).toString('hex'),
      };
      if (!(await post('/api/auth/sign-up/email', 'POST', other)).ok)
        throw new Error('Second synthetic registration failed');
      await fixture.operator.query(
        'UPDATE "user" SET email_verified=true WHERE email=$1',
        [other.email],
      );
      const otherLogin = await post('/api/auth/sign-in/email', 'POST', other);
      if (!otherLogin.ok) throw new Error('Second synthetic login failed');
      const otherCookie = otherLogin.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      if (
        !(
          await post(
            '/api/me/consent',
            'PUT',
            { version: 'guidelines-2026-10-19' },
            otherCookie,
          )
        ).ok
      )
        throw new Error('Second synthetic consent failed');
      const otherThought = await post(
        '/api/thoughts',
        'POST',
        {
          body: 'Clearly fictional: another quiet moment.',
          emotion: 'gratitude',
          location: { lat: 14.65, lng: 121.03 },
        },
        otherCookie,
      );
      if (!otherThought.ok)
        throw new Error('Second synthetic publication failed');
      other.publicId = (await otherThought.json()).publicId;
      await post('/api/auth/sign-out', 'POST', {}, otherCookie);
      admin = {
        email: `admin-browser-${randomBytes(8).toString('hex')}@test.invalid`,
        password: randomBytes(24).toString('hex'),
      };
      if (!(await post('/api/auth/sign-up/email', 'POST', admin)).ok)
        throw new Error('Synthetic admin registration failed');
      await fixture.operator.query(
        'UPDATE "user" SET email_verified=true WHERE email=$1',
        [admin.email],
      );
      await bootstrapAdmin(fixture.operator, admin.email, admin.email);
    }
    // Only the disposable automated lifecycle exercises a fresh agreement.
    // The retained controller fixture keeps its established consent.
    const needsAgreement =
      process.env.GUNITA_THOUGHT_REAGREE === 'synthetic-only';
    if (needsAgreement)
      await fixture.operator.query(
        'DELETE FROM user_consents WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
        [identity.email],
      );
    await writeFile(
      `.local/phase-5-browser-fixture-${port}.json`,
      JSON.stringify({
        ...identity,
        url: origin,
        thoughtUrl: `${origin}/thought/${thought.publicId}`,
        publicId: thought.publicId,
        database: fixture.name,
        pid: process.pid,
        appPid: child.pid,
        mode: 'LOCAL_PREVIEW',
        consentVersion: 'guidelines-2026-10-19',
        needsAgreement,
        ...(other ? { other } : {}),
        ...(admin ? { admin } : {}),
      }),
    );
    await post('/api/auth/sign-out', 'POST', {}, cookie);
  }
  await writeFile(
    `.local/phase-4-fixture-${port}.json`,
    JSON.stringify({
      pid: process.pid,
      appPid: child.pid,
      url: origin,
      database: fixture.name,
      thoughts:
        process.env.GUNITA_THOUGHT_FIXTURE === 'synthetic-only' ? 61 : 60,
    }),
  );
  console.log(
    `Disposable map fixture ready at ${origin}; app PID ${child.pid}; ${process.env.GUNITA_THOUGHT_FIXTURE === 'synthetic-only' ? 61 : 60} fictional thoughts.`,
  );
  process.send?.({ ready: true, url: origin });
} catch {
  console.error('Disposable fixture setup failed');
  await shutdown(1);
}
