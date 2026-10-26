import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { cpus, totalmem, release, platform } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { createMapDatabase } from '../fixtures/map-database';
vi.mock('server-only', () => ({}));
import { queryMapPins } from '../../src/server/geo/pins';
import { coarsenPhilippinesPoint } from '../../src/server/geo/privacy';
let fixture: Awaited<ReturnType<typeof createMapDatabase>>;
beforeAll(async () => {
  fixture = await createMapDatabase();
}, 60000);
afterAll(async () => {
  await fixture?.close();
});

it('aggregates 10500 fictional urban, rural and island thoughts deterministically with bounded output and indexed selective plans', async () => {
  const subject = await import('../fixtures/scale-database.mjs').catch(
    () => ({}),
  );
  expect('seedScaleDatabase' in subject).toBe(true);
  if (!('seedScaleDatabase' in subject)) return;
  const seed = subject.seedScaleDatabase as (
    fixture: unknown,
    preview: (lat: number, lng: number) => Promise<unknown>,
    confirmation: string,
  ) => Promise<{ thoughts: number; areas: number; tiers: number[] }>;
  await expect(seed(fixture, async () => ({}), '')).rejects.toThrow();
  const seeded = await seed(
    fixture,
    (lat, lng) => coarsenPhilippinesPoint(fixture.pool, lat, lng),
    'synthetic-test-only',
  );
  expect(seeded.thoughts).toBe(10500);
  expect(seeded.areas).toBeGreaterThan(70);
  expect(seeded.tiers.sort()).toEqual([5, 6, 7]);
  const samples = [];
  for (const [label, query] of [
    ['world', 'bbox=-180,-85,180,85&zoom=1'],
    ['philippines', 'bbox=116,4,127,22&zoom=5'],
    ['metro', 'bbox=120.8,14.3,121.2,14.9&zoom=12'],
    ['emotion', 'bbox=116,4,127,22&zoom=6&emotion=hope'],
  ]) {
    let sql = '',
      parameters: unknown[] = [];
    const captured = {
      query: async (text: string, values: unknown[]) => {
        sql = text;
        parameters = values;
        return fixture.pool.query(text, values);
      },
    };
    const result = await queryMapPins(
      captured as never,
      new URLSearchParams(query),
    );
    expect(result.features.length).toBeLessThanOrEqual(1000);
    expect(result.features.reduce((n, f) => n + f.properties.count, 0)).toBe(
      result.total,
    );
    if (label === 'world') expect(result.total).toBe(10500);
    if (label === 'emotion') expect(result.total).toBe(3500);
    expect(
      await queryMapPins(fixture.pool, new URLSearchParams(query)),
    ).toEqual(result);
    const timings: number[] = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      await queryMapPins(fixture.pool, new URLSearchParams(query));
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    const plan = (
      await fixture.operator.query(
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql,
        parameters,
      )
    ).rows[0]['QUERY PLAN'];
    if (label === 'metro')
      expect(JSON.stringify(plan)).toContain('thoughts_public_point_gist');
    samples.push({
      label,
      features: result.features.length,
      total: result.total,
      bytes: JSON.stringify(result).length,
      samples: timings.length,
      p50Ms: timings[14],
      p95Ms: timings[28],
      plan,
    });
  }
  await writeFile(
    '.local/phase-8-map-query-benchmark.json',
    JSON.stringify(
      {
        kind: 'direct-query-not-http',
        hardware: {
          cpu: cpus()[0].model,
          logicalCpus: cpus().length,
          ramBytes: totalmem(),
          platform: platform(),
          release: release(),
        },
        postgres: (
          await fixture.operator.query(
            'SELECT version() AS version,postgis_full_version() AS postgis',
          )
        ).rows[0],
        seeded,
        samples,
      },
      null,
      2,
    ),
  );
}, 120000);
