import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { latLngToCell } from 'h3-js';
import { createMapDatabase } from './map-database.ts';

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
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!(await fetch(`${origin}/api/ready`)).ok)
    throw new Error('Fixture startup unavailable');
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
  await writeFile(
    `.local/phase-4-fixture-${port}.json`,
    JSON.stringify({
      pid: process.pid,
      appPid: child.pid,
      url: origin,
      database: fixture.name,
      thoughts: 60,
    }),
  );
  console.log(
    `Disposable map fixture ready at ${origin}; app PID ${child.pid}; 60 fictional thoughts.`,
  );
  process.send?.({ ready: true, url: origin });
} catch {
  console.error('Disposable fixture setup failed');
  await shutdown(1);
}
