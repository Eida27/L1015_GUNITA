import 'server-only';
import type { Pool } from 'pg';
import { emotions, type MapPins } from '@/lib/map-contract';
import { publishedPredicate } from '../db/published.mjs';
export class MapInputError extends Error {}
export async function queryMapPins(
  db: Pick<Pool, 'query'>,
  query: URLSearchParams,
): Promise<MapPins> {
  if (
    [...query.keys()].some(
      (key) => !['bbox', 'zoom', 'emotion'].includes(key),
    ) ||
    [...query.keys()].some((key) => query.getAll(key).length !== 1)
  )
    throw new MapInputError();
  const values = query.get('bbox')?.split(',');
  const zoomText = query.get('zoom');
  const zoom = Number(zoomText);
  if (
    !values ||
    values.length !== 4 ||
    values.some((v) => !v.trim() || !Number.isFinite(Number(v))) ||
    !zoomText?.trim() ||
    !Number.isFinite(zoom) ||
    zoom < 0 ||
    zoom > 18
  )
    throw new MapInputError();
  const [west, south, east, north] = values.map(Number);
  if (
    south >= north ||
    Math.abs(south) > 90 ||
    Math.abs(north) > 90 ||
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    west === east
  )
    throw new MapInputError();
  const emotion = query.get('emotion');
  if (
    emotion !== null &&
    !emotions.includes(emotion as (typeof emotions)[number])
  )
    throw new MapInputError();
  const width = east >= west ? east - west : 360 - west + east;
  // At most 31*31 occupied bins, including exact viewport edges, at any zoom.
  const step = Math.max(
    360 / 2 ** (Math.floor(zoom) + 5),
    width / 30,
    (north - south) / 30,
  );
  const { rows } = await db.query(
    `WITH visible AS MATERIALIZED (
      SELECT t.public_id,t.emotion,t.location_label,ST_X(t.public_point) AS x,ST_Y(t.public_point) AS y
      FROM thoughts t WHERE ${publishedPredicate}
      AND ($5::emotion IS NULL OR t.emotion=$5::emotion)
      AND CASE WHEN $1::float8<=$3::float8
        THEN t.public_point && ST_MakeEnvelope($1,$2,$3,$4,4326)
        ELSE (t.public_point && ST_MakeEnvelope($1,$2,180,$4,4326)
          OR t.public_point && ST_MakeEnvelope(-180,$2,$3,$4,4326)) END
    ), grouped AS (
      SELECT floor((CASE WHEN x<$1 THEN x+360 ELSE x END-$1)/$6) AS gx,
        floor((y-$2)/$6) AS gy, count(*)::int AS count,
        min(public_id) AS representative FROM visible GROUP BY 1,2
    ) SELECT g.count,v.* FROM grouped g JOIN visible v ON v.public_id=g.representative ORDER BY g.gx,g.gy`,
    [west, south, east, north, emotion, step],
  );
  return {
    type: 'FeatureCollection',
    total: rows.reduce((sum, row) => sum + row.count, 0),
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.x, row.y] },
      properties:
        row.count === 1
          ? {
              kind: 'pin',
              count: 1,
              publicId: row.public_id,
              emotion: row.emotion,
              label: row.location_label,
            }
          : { kind: 'aggregate', count: row.count },
    })),
  };
}
