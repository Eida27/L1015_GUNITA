import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createMapDatabase } from './map-database.ts';

if (process.env.GUNITA_STANDALONE_TEST !== 'disposable-only')
  throw new Error('Explicit disposable standalone test required');
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(3000, '127.0.0.1', () => probe.close(resolve));
});
const fixture = await createMapDatabase();
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  LOCAL_PREVIEW: 'true',
  PORT: '3000',
  APP_ORIGIN: 'http://127.0.0.1:3000',
  DATABASE_URL: fixture.runtimeUrl,
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1028',
  SMTP_FROM: 'Gunita <no-reply@test.invalid>',
  NODE_OPTIONS: '--max-old-space-size=1536',
  FORCE_COLOR: '0',
  NEXT_TELEMETRY_DISABLED: '1',
};
const app = spawn(process.execPath, ['scripts/start.mjs'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
app.stdout.resume();
app.stderr.resume();
let runner;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null)
      throw new Error('Standalone stopped before readiness');
    try {
      ready = (
        await fetch(env.APP_ORIGIN + '/api/ready', {
          signal: AbortSignal.timeout(2500),
        })
      ).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Standalone readiness failed');
  const testEnv = { ...process.env, FORCE_COLOR: '0' };
  delete testEnv.NO_COLOR;
  runner = spawn(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.standalone.config.ts',
      ...process.argv.slice(2),
    ],
    { env: testEnv, stdio: 'inherit', windowsHide: true },
  );
  const [code] = await once(runner, 'exit');
  process.exitCode = code ?? 1;
} finally {
  runner?.kill();
  if (app.exitCode === null) {
    const stopped = once(app, 'exit');
    app.kill();
    await stopped;
  }
  await fixture.close();
}
