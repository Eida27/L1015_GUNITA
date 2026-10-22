import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMapDatabase } from '../fixtures/map-database';
import { latLngToCell } from 'h3-js';
vi.mock('server-only', () => ({}));

let fixture: Awaited<ReturnType<typeof createMapDatabase>>;
beforeAll(async () => {
  fixture = await createMapDatabase();
}, 60000);
afterAll(async () => {
  await fixture?.close();
});

it('coarsens Manila in real PostGIS without returning the selected point', async () => {
  const privacy = await import('../../src/server/geo/privacy');
  const result = await privacy.coarsenPhilippinesPoint(
    fixture.pool,
    14.59951237,
    120.98421943,
  );
  expect(result).toMatchObject({
    privacyTier: 7,
    algorithmVersion: 1,
    label: 'Metro Manila',
  });
  expect(result?.lat).not.toBe(14.59951237);
  expect(result?.lng).not.toBe(120.98421943);
  const inland = await fixture.pool.query(
    'SELECT EXISTS(SELECT 1 FROM geo_admin_areas WHERE ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326))) AS yes',
    [result!.lng, result!.lat],
  );
  expect(inland.rows[0].yes).toBe(true);
});

it('rejects ocean, foreign, swapped and nonfinite locations', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  for (const [lat, lng] of [
    [0, 0],
    [35.68, 139.69],
    [120.98, 14.6],
    [NaN, 120],
    [14.6, Infinity],
  ])
    await expect(
      coarsenPhilippinesPoint(fixture.pool, lat, lng),
    ).rejects.toThrow();
});

it('returns a deterministic cell representative for nearby originals', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const first = await coarsenPhilippinesPoint(
    fixture.pool,
    14.59951237,
    120.98421943,
  );
  const second = await coarsenPhilippinesPoint(
    fixture.pool,
    14.59961237,
    120.98431943,
  );
  expect(first).toEqual(second);
  expect(first.privacyCell).toBe(latLngToCell(14.59951237, 120.98421943, 7));
});

it('uses one deterministic representative across real administrative boundaries', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const pairs = await fixture.pool.query(`WITH edges AS (
    SELECT a.geom AS a,b.geom AS b,a.privacy_tier AS tier,
      ST_PointOnSurface(ST_Intersection(ST_Boundary(a.geom),ST_Boundary(b.geom))) AS edge
    FROM geo_admin_areas a JOIN geo_admin_areas b ON a.source_feature_id<b.source_feature_id
      AND a.privacy_tier=b.privacy_tier AND a.public_label<>b.public_label
      AND ST_Intersects(a.geom,b.geom)
    WHERE ST_Dimension(ST_Intersection(ST_Boundary(a.geom),ST_Boundary(b.geom)))=1
    ORDER BY a.source_feature_id,b.source_feature_id LIMIT 20
  ), points AS (SELECT tier,ST_PointOnSurface(ST_Intersection(a,ST_Buffer(edge,0.0001))) AS a,
    ST_PointOnSurface(ST_Intersection(b,ST_Buffer(edge,0.0001))) AS b FROM edges)
    SELECT tier,ST_X(a) AS ax,ST_Y(a) AS ay,ST_X(b) AS bx,ST_Y(b) AS by FROM points`);
  let tested = 0;
  for (const p of pairs.rows) {
    if (latLngToCell(p.ay, p.ax, p.tier) !== latLngToCell(p.by, p.bx, p.tier))
      continue;
    expect(await coarsenPhilippinesPoint(fixture.pool, p.ay, p.ax)).toEqual(
      await coarsenPhilippinesPoint(fixture.pool, p.by, p.bx),
    );
    if (++tested === 3) break;
  }
  expect(tested).toBe(3);
}, 60000);

it('moves isolated tiny land to a broad province and discards the tiny origin cell', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const candidates = await fixture.pool.query(`WITH parts AS MATERIALIZED (
    SELECT public_label,(ST_Dump(geom)).geom AS geom FROM geo_admin_areas
  ), sized AS MATERIALIZED (SELECT *,ST_Area(geom::geography) AS area FROM parts),
  tiny AS (SELECT s.* FROM sized s WHERE s.area BETWEEN 1000 AND 200000
    AND NOT EXISTS(SELECT 1 FROM sized large WHERE large.area>1000000 AND ST_DWithin(s.geom,large.geom,0.08))
    ORDER BY s.area DESC LIMIT 12)
    SELECT ST_X(ST_PointOnSurface(geom)) AS lng,ST_Y(ST_PointOnSurface(geom)) AS lat FROM tiny`);
  let found = false;
  for (const p of candidates.rows) {
    const safe = await coarsenPhilippinesPoint(fixture.pool, p.lat, p.lng);
    if (safe.privacyCell === latLngToCell(p.lat, p.lng, 5)) continue;
    expect(safe.privacyTier).toBe(5);
    expect(safe.privacyCell).toBe(latLngToCell(safe.lat, safe.lng, 5));
    const distance = await fixture.pool.query(
      'SELECT ST_Distance(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) AS meters',
      [p.lng, p.lat, safe.lng, safe.lat],
    );
    expect(distance.rows[0].meters).toBeGreaterThan(1000);
    expect(await coarsenPhilippinesPoint(fixture.pool, p.lat, p.lng)).toEqual(
      safe,
    );
    found = true;
    break;
  }
  expect(found).toBe(true);
}, 60000);

it('bounds a real 10000-thought query without losing counts or exporting private fields', async () => {
  // Operator seeds synthetic coarse points only inside its disposable database.
  await fixture.operator.query(`INSERT INTO "user"(id,name,email,email_verified)
    SELECT md5('map-user-'||i)::uuid,'Fictional', 'map-'||i||'@test.invalid',true FROM generate_series(1,2000) i`);
  await fixture.operator
    .query(`INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,
    privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
    SELECT 't_'||md5('map-thought-'||i),md5('map-user-'||ceil(i/5.0)::int)::uuid,
    'PRIVATE_BODY_CANARY',CASE WHEN i%2=0 THEN 'hope'::emotion ELSE 'love'::emotion END,
    ST_SetSRID(ST_MakePoint(120.98+(i%100)*0.001,14.6+floor((i-1)/100.0)*0.001),4326),
    '87752a30dffffff',7,1,'Metro Manila' FROM generate_series(1,10000) i`);
  const { queryMapPins } = await import('../../src/server/geo/pins');
  for (const zoom of [1, 10, 18]) {
    const result = await queryMapPins(
      fixture.pool,
      new URLSearchParams({ bbox: '-180,-85,180,85', zoom: String(zoom) }),
    );
    expect(result.total).toBe(10000);
    expect(result.features.length).toBeLessThanOrEqual(1000);
    expect(
      result.features.reduce((sum, f) => sum + f.properties.count, 0),
    ).toBe(10000);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_BODY_CANARY|author|pseudonym|reaction|email|privacyCell/,
    );
  }
  const filtered = await queryMapPins(
    fixture.pool,
    new URLSearchParams({ bbox: '120,14,122,16', zoom: '8', emotion: 'hope' }),
  );
  expect(filtered.total).toBe(5000);
  const empty = await queryMapPins(
    fixture.pool,
    new URLSearchParams({ bbox: '170,-20,-170,20', zoom: '4' }),
  );
  expect(empty.total).toBe(0);
  const timings: number[] = [];
  const queries = vi.spyOn(fixture.pool, 'query');
  let bytes = 0,
    features = 0;
  for (let i = 0; i < 11; i++) {
    const start = performance.now();
    const dense = await queryMapPins(
      fixture.pool,
      new URLSearchParams({ bbox: '120.98,14.6,121.08,14.7', zoom: '18' }),
    );
    timings.push(performance.now() - start);
    expect(dense.total).toBe(10000);
    expect(dense.features.reduce((sum, f) => sum + f.properties.count, 0)).toBe(
      10000,
    );
    expect(dense.features.length).toBeGreaterThan(100);
    expect(dense.features.length).toBeLessThanOrEqual(1000);
    bytes = Buffer.byteLength(JSON.stringify(dense));
    features = dense.features.length;
    expect(bytes).toBeLessThan(250000);
  }
  console.info('Map 10000-thought dense proof', {
    features,
    bytes,
    p95ms: Math.round(timings.sort((a, b) => a - b)[10]),
  });
  const [sql, parameters] = queries.mock.calls.at(-1)!;
  queries.mockRestore();
  const explained = await fixture.pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    parameters,
  );
  const plan = explained.rows[0]['QUERY PLAN'][0];
  console.info('Map dense query plan', JSON.stringify(plan));
}, 60000);

it('persists only the coarse location, and hides expired or moderated rows before aggregation', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const { queryMapPins } = await import('../../src/server/geo/pins');
  const safe = await coarsenPhilippinesPoint(
    fixture.pool,
    14.59951237,
    120.98421943,
  );
  const author = (
    await fixture.pool.query(
      `INSERT INTO "user"(name,email,email_verified) VALUES('Fictional','coarse@test.invalid',true) RETURNING id`,
    )
  ).rows[0].id;
  await fixture.pool.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at,status)
    VALUES('t_'||md5('coarse-proof-'||$9),$1,'Fictional coarse proof','gratitude',ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,$7,$8,$9::thought_status)`,
    [
      author,
      safe.lng,
      safe.lat,
      safe.privacyCell,
      safe.privacyTier,
      safe.algorithmVersion,
      safe.label,
      new Date(),
      'published',
    ],
  );
  const stored = await fixture.pool.query(
    `SELECT row_to_json(t)::text AS data,ST_X(public_point) AS lng,ST_Y(public_point) AS lat FROM thoughts t WHERE author_id=$1`,
    [author],
  );
  expect(stored.rows[0].lng).toBe(safe.lng);
  expect(stored.rows[0].lat).toBe(safe.lat);
  expect(stored.rows[0].data).not.toMatch(/14\.59951237|120\.98421943/);
  const params = new URLSearchParams({
    bbox: '-180,-85,180,85',
    zoom: '1',
    emotion: 'gratitude',
  });
  expect((await queryMapPins(fixture.pool, params)).total).toBe(1);
  await fixture.pool.query(
    "UPDATE thoughts SET status='hidden' WHERE author_id=$1",
    [author],
  );
  expect((await queryMapPins(fixture.pool, params)).total).toBe(0);
  await fixture.pool.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label,created_at)
    VALUES('t_'||md5('expired-proof'),$1,'Expired fixture','gratitude',ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,$7,now()-interval '31 days')`,
    [
      author,
      safe.lng,
      safe.lat,
      safe.privacyCell,
      safe.privacyTier,
      safe.algorithmVersion,
      safe.label,
    ],
  );
  expect((await queryMapPins(fixture.pool, params)).total).toBe(0);
});

it('keeps Cebu, Iloilo, rural Luzon and Batanes on versioned land at their configured tier or safer', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  for (const [lat, lng, tier] of [
    [10.32, 123.89, 6],
    [10.72, 122.56, 6],
    [17.61, 121.72, 6],
    [20.45, 121.97, 5],
  ]) {
    const safe = await coarsenPhilippinesPoint(fixture.pool, lat, lng);
    expect(safe.privacyTier).toBeLessThanOrEqual(tier);
    expect(
      (
        await fixture.pool.query(
          'SELECT EXISTS(SELECT 1 FROM geo_admin_areas WHERE dataset_version=1 AND ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326))) AS inland',
          [safe.lng, safe.lat],
        )
      ).rows[0].inland,
    ).toBe(true);
  }
});

it('bounds repeated anonymous preview requests in the shared database', async () => {
  const { limitMapRequests } = await import('../../src/server/geo/limits');
  for (let i = 0; i < 120; i++) await limitMapRequests(fixture.pool, 'preview');
  await expect(limitMapRequests(fixture.pool, 'preview')).rejects.toThrow(
    'Too many attempts',
  );
});

it('discovers every terminal colocated member with bounded pages and current visibility', async () => {
  const { coarsenPhilippinesPoint } =
    await import('../../src/server/geo/privacy');
  const safe = await coarsenPhilippinesPoint(fixture.pool, 14.5995, 120.9842);
  await fixture.operator.query(`INSERT INTO "user"(id,name,email,email_verified)
    SELECT md5('terminal-user-'||i)::uuid,'Private owner','terminal-'||i||'@test.invalid',true FROM generate_series(1,10) i`);
  await fixture.operator.query(
    `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,
    privacy_cell,privacy_tier,privacy_algorithm_version,location_label,status,created_at)
    SELECT 't_'||md5('terminal-'||i),md5('terminal-user-'||ceil(i/5.0)::int)::uuid,
    'PRIVATE_BODY_CANARY',CASE WHEN i%2=1 THEN 'gratitude'::emotion ELSE 'confession'::emotion END,
    ST_SetSRID(ST_MakePoint($1,$2),4326),$3,$4,1,$5,
    CASE WHEN i=46 THEN 'hidden'::thought_status ELSE 'published'::thought_status END,
    CASE WHEN i=47 THEN now()-interval '31 days' ELSE now() END
    FROM generate_series(1,47) i`,
    [safe.lng, safe.lat, safe.privacyCell, safe.privacyTier, safe.label],
  );
  const queries = await import('../../src/server/geo/pins');
  const params = new URLSearchParams({
    bbox: `${safe.lng - 0.0001},${safe.lat - 0.0001},${safe.lng + 0.0001},${safe.lat + 0.0001}`,
    zoom: '18',
  });
  const pins = await queries.queryMapPins(fixture.pool, params);
  const group = pins.features.find((f) => f.properties.count === 45)!;
  expect(group?.properties.group).toMatch(/^\d+:\d+$/);
  params.set('group', group.properties.group!);
  const seen: string[] = [];
  for (const size of [20, 20, 5]) {
    const result = await queries.queryMapMembers(fixture.pool, params);
    expect(result.total).toBe(45);
    expect(result.members).toHaveLength(size);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(6000);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_BODY|author|pseudonym|reaction|email|privacyCell/,
    );
    for (const member of result.members) {
      expect(Object.keys(member).sort()).toEqual([
        'emotion',
        'label',
        'publicId',
      ]);
      expect(member.label).toBe('Metro Manila');
      seen.push(member.publicId);
    }
    if (result.nextCursor) params.set('after', result.nextCursor);
    else expect(size).toBe(5);
  }
  expect(new Set(seen).size).toBe(45);
  params.delete('after');
  params.set('emotion', 'gratitude');
  const filtered = await queries.queryMapMembers(fixture.pool, params);
  expect(filtered.total).toBe(23);
  expect(filtered.members.every((m) => m.emotion === 'gratitude')).toBe(true);
  const hiddenId = filtered.members[0].publicId;
  await fixture.pool.query(
    "UPDATE thoughts SET status='hidden' WHERE public_id=$1",
    [hiddenId],
  );
  const current = await queries.queryMapMembers(fixture.pool, params);
  expect(current.total).toBe(22);
  expect(current.members.some((m) => m.publicId === hiddenId)).toBe(false);
  const outside = new URLSearchParams(params);
  outside.set('bbox', '0,0,1,1');
  expect((await queries.queryMapMembers(fixture.pool, outside)).total).toBe(0);
  for (const [key, value] of [
    ['zoom', '17'],
    ['group', '31:0'],
    ['group', '-1:0'],
    ['after', 'bad'],
    ['limit', '10000'],
  ]) {
    const invalid = new URLSearchParams(params);
    invalid.set(key, value);
    await expect(
      queries.queryMapMembers(fixture.pool, invalid),
    ).rejects.toThrow();
  }
  const duplicate = new URLSearchParams(params);
  duplicate.append('group', '0:0');
  await expect(
    queries.queryMapMembers(fixture.pool, duplicate),
  ).rejects.toThrow();
}, 60000);
