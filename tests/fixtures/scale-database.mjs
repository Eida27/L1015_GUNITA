// Test-only synthetic dataset. Never import this module from application code.
import { latLngToCell } from 'h3-js';
export async function seedScaleDatabase(fixture, preview, confirmation) {
  if (
    confirmation !== 'synthetic-test-only' ||
    !/^gunita_test_[a-f0-9]{16}$/.test(fixture.name)
  )
    throw new Error('Explicit disposable scale fixture required');
  const actual = (
    await fixture.operator.query('SELECT current_database() AS name')
  ).rows[0].name;
  if (actual !== fixture.name)
    throw new Error('Scale fixture ownership mismatch');
  if (
    (await fixture.operator.query('SELECT count(*)::int n FROM thoughts'))
      .rows[0].n !== 0
  )
    throw new Error('Scale seed requires empty owned fixture');
  const areas = (
    await fixture.operator.query(
      `SELECT source_feature_id,privacy_tier,ST_X(ST_PointOnSurface(geom)) AS lng,ST_Y(ST_PointOnSurface(geom)) AS lat FROM geo_admin_areas ORDER BY source_feature_id`,
    )
  ).rows;
  const points = [];
  for (const area of areas) {
    const point = await preview(area.lat, area.lng);
    const tier = point.privacyTier ?? area.privacy_tier;
    points.push({
      index: points.length,
      lat: point.lat,
      lng: point.lng,
      label: point.label,
      tier,
      cell: point.privacyCell ?? latLngToCell(point.lat, point.lng, tier),
    });
  }
  await fixture.operator.query('BEGIN');
  try {
    await fixture.operator.query(
      `INSERT INTO "user"(id,name,email,email_verified) SELECT md5('scale-owner-'||i)::uuid,'Clearly fictional scale fixture','scale-owner-'||i||'@test.invalid',true FROM generate_series(1,2100) i`,
    );
    await fixture.operator.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
      SELECT 't_scale_'||lpad(i::text,32,'0'),md5('scale-owner-'||((i-1)/5+1))::uuid,'Clearly fictional performance fixture',
      (ARRAY['hope','gratitude','other']::emotion[])[(i-1)%3+1],ST_SetSRID(ST_MakePoint(p.lng,p.lat),4326),p.cell,p.tier,1,p.label
      FROM generate_series(1,10500) i JOIN json_to_recordset($1::json) AS p(index int,lat float8,lng float8,label text,tier smallint,cell text) ON p.index=(i-1)%$2`,
      [JSON.stringify(points), points.length],
    );
    await fixture.operator.query('COMMIT');
  } catch (error) {
    await fixture.operator.query('ROLLBACK');
    throw error;
  }
  await fixture.operator.query('ANALYZE thoughts');
  return {
    thoughts: 10500,
    areas: areas.length,
    tiers: [...new Set(areas.map((area) => area.privacy_tier))],
  };
}
