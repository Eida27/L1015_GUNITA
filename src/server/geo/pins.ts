import 'server-only';
import type { Pool } from 'pg';
import {
  emotions,
  type MapPins,
  type MapMembers,
  type MapMember,
} from '@/lib/map-contract';
import { publishedPredicate } from '../db/published.mjs';
export class MapInputError extends Error {}
function parseViewport(query: URLSearchParams, members = false) {
  const allowed = members
    ? ['bbox', 'zoom', 'emotion', 'group', 'after']
    : ['bbox', 'zoom', 'emotion'];
  if (
    [...query.keys()].some((key) => !allowed.includes(key)) ||
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
  return { zoom, parameters: [west, south, east, north, emotion, step] };
}
// Both discovery paths use exactly the same viewport, filter and publication boundary.
const visibleBins = `WITH visible AS MATERIALIZED (
      SELECT t.public_id,t.emotion,t.location_label,ST_X(t.public_point) AS x,ST_Y(t.public_point) AS y
      FROM thoughts t WHERE ${publishedPredicate}
      AND ($5::emotion IS NULL OR t.emotion=$5::emotion)
      AND CASE WHEN $1::float8<=$3::float8
        THEN t.public_point && ST_MakeEnvelope($1,$2,$3,$4,4326)
        ELSE (t.public_point && ST_MakeEnvelope($1,$2,180,$4,4326)
          OR t.public_point && ST_MakeEnvelope(-180,$2,$3,$4,4326)) END
    ), binned AS (
      SELECT *,floor((CASE WHEN x<$1 THEN x+360 ELSE x END-$1)/$6) AS gx,
        floor((y-$2)/$6) AS gy FROM visible
    )`;

export async function queryMapPins(
  db: Pick<Pool, 'query'>,
  query: URLSearchParams,
): Promise<MapPins> {
  const { zoom, parameters } = parseViewport(query);
  const { rows } = await db.query(
    `${visibleBins}, grouped AS (
      SELECT gx,gy,count(*)::int AS count,min(public_id) AS representative FROM binned GROUP BY gx,gy
    ) SELECT g.count,g.gx,g.gy,v.* FROM grouped g JOIN visible v ON v.public_id=g.representative ORDER BY g.gx,g.gy`,
    parameters,
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
          : {
              kind: 'aggregate',
              count: row.count,
              ...(zoom === 18 ? { group: `${row.gx}:${row.gy}` } : {}),
            },
    })),
  };
}

export async function queryMapMembers(
  db: Pick<Pool, 'query'>,
  query: URLSearchParams,
): Promise<MapMembers> {
  const { zoom, parameters } = parseViewport(query, true);
  const group = query.get('group');
  const after = query.get('after');
  if (
    zoom !== 18 ||
    !group ||
    !/^(?:[0-9]|[12][0-9]|30):(?:[0-9]|[12][0-9]|30)$/.test(group) ||
    (after !== null && !/^t_[A-Za-z0-9_-]{22,64}$/.test(after))
  )
    throw new MapInputError();
  const [gx, gy] = group.split(':').map(Number);
  const { rows } = await db.query(
    `${visibleBins}, members AS MATERIALIZED (
      SELECT public_id,emotion,location_label FROM binned WHERE gx=$7 AND gy=$8
    ), page AS (
      SELECT public_id AS "publicId",emotion,location_label AS label FROM members
      WHERE ($9::text IS NULL OR public_id>$9) ORDER BY public_id LIMIT 21
    ) SELECT (SELECT count(*)::int FROM members) AS total,
      COALESCE(json_agg(page ORDER BY page."publicId"),'[]'::json) AS members FROM page`,
    [...parameters, gx, gy, after],
  );
  const page: MapMember[] = rows[0].members;
  const members = page.slice(0, 20);
  return {
    total: rows[0].total,
    members,
    nextCursor: page.length > 20 ? members.at(-1)!.publicId : null,
  };
}
