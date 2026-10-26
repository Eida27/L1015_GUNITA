import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
let fixture: ChildProcess;
const origin = 'http://127.0.0.1:3002';
test.beforeAll(async () => {
  test.setTimeout(180000);
  const env = {
    ...process.env,
    GUNITA_MAP_FIXTURE: 'disposable-only',
    GUNITA_MAP_FIXTURE_PORT: '3002',
    GUNITA_SCALE_FIXTURE: 'synthetic-10500',
    FORCE_COLOR: '0',
  };
  delete (env as NodeJS.ProcessEnv).NO_COLOR;
  fixture = spawn(process.execPath, ['tests/fixtures/map-preview.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  fixture.stdout?.resume();
  fixture.stderr?.resume();
  await Promise.race([
    once(fixture, 'message').then(([message]) =>
      expect(message).toEqual({ ready: true, url: origin }),
    ),
    once(fixture, 'exit').then(() => {
      throw new Error('Scale fixture failed');
    }),
  ]);
});
test.afterAll(async () => {
  if (fixture?.connected) {
    fixture.send('shutdown');
    await once(fixture, 'exit');
  }
});
test('measures warmed standalone map HTTP p50/p95 separately from cold startup with 10500+ thoughts', async ({
  request,
}) => {
  test.setTimeout(120000);
  const samples = [];
  for (const [label, query] of [
    ['world', 'bbox=-180,-85,180,85&zoom=1'],
    ['philippines', 'bbox=116,4,127,22&zoom=5'],
    ['metro', 'bbox=120.8,14.3,121.2,14.9&zoom=12'],
    ['emotion', 'bbox=116,4,127,22&zoom=6&emotion=hope'],
  ]) {
    const timings = [];
    let features = 0,
      total = 0,
      bytes = 0;
    for (let i = 0; i < 31; i++) {
      const started = performance.now(),
        response = await request.get(`${origin}/api/map/pins?${query}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      const data = await response.json();
      const elapsed = performance.now() - started;
      features = data.features.length;
      total = data.total;
      bytes = JSON.stringify(data).length;
      expect(features).toBeLessThanOrEqual(1000);
      expect(bytes).toBeLessThan(256000);
      expect(JSON.stringify(data)).not.toMatch(
        /author_id|email|body|reactionTotals|userId/,
      );
      if (label === 'world') expect(total).toBe(10560);
      if (i) timings.push(elapsed);
    }
    timings.sort((a, b) => a - b);
    samples.push({
      label,
      features,
      total,
      bytes,
      samples: timings.length,
      p50Ms: timings[14],
      p95Ms: timings[28],
      targetMet: timings[28] < 750,
    });
  }
  await writeFile(
    '.local/phase-8-map-http-benchmark.json',
    JSON.stringify(
      {
        kind: 'standalone-loopback-http',
        startup: JSON.parse(
          await readFile('.local/phase-8-scale-startup.json', 'utf8'),
        ),
        samples,
      },
      null,
      2,
    ),
  );
  for (const sample of samples)
    expect(sample.p95Ms, `${sample.label} local p95 target`).toBeLessThan(750);
});
