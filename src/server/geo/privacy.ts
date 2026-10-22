import 'server-only';
import type { Pool } from 'pg';
import { cellToBoundary, latLngToCell, cellToParent } from 'h3-js';

export type CoarseLocation = {
  lat: number;
  lng: number;
  label: string;
  privacyCell: string;
  privacyTier: number;
  algorithmVersion: number;
};
export class LocationError extends Error {
  constructor(public code: 'INVALID_LOCATION' | 'OUTSIDE_PHILIPPINES') {
    super(code);
  }
}
// Version 1 is bound to dataset 1 and ADR 014. Raw inputs are parameters
// only; never interpolate, log, cache or return them.
export async function coarsenPhilippinesPoint(
  db: Pick<Pool, 'query'>,
  lat: number,
  lng: number,
): Promise<CoarseLocation> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw new LocationError('INVALID_LOCATION');
  const original = await db.query(
    `SELECT min(privacy_tier)::int AS tier FROM geo_admin_areas
     WHERE dataset_version=1 AND ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326))`,
    [lng, lat],
  );
  if (original.rows[0].tier === null)
    throw new LocationError('OUTSIDE_PHILIPPINES');
  let tier: number = original.rows[0].tier;
  let cell = latLngToCell(lat, lng, tier);
  for (;;) {
    const ring = cellToBoundary(cell, true);
    const polygon = JSON.stringify({
      type: 'Polygon',
      coordinates: [[...ring, ring[0]]],
    });
    const { rows } = await db.query(
      `WITH cell AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS geom),
       pieces AS (
         SELECT a.public_label, a.source_feature_id, ST_Intersection(a.geom,c.geom) AS geom
         FROM geo_admin_areas a,cell c WHERE a.dataset_version=1 AND ST_Intersects(a.geom,c.geom)
       ), land AS (SELECT ST_UnaryUnion(ST_Collect(geom ORDER BY source_feature_id)) AS geom FROM pieces),
       parts AS (SELECT (ST_Dump(ST_CollectionExtract(geom,3))).geom FROM land),
       biggest AS (SELECT geom FROM parts ORDER BY ST_Area(geom::geography) DESC,ST_AsEWKB(geom) LIMIT 1),
       point AS (SELECT ST_PointOnSurface(geom) AS geom FROM biggest)
       SELECT ST_X(p.geom) AS lng,ST_Y(p.geom) AS lat,
         (SELECT ST_Area(geom::geography) FROM biggest) AS area,
         (SELECT public_label FROM pieces ORDER BY ST_Area(geom::geography) DESC,public_label,source_feature_id LIMIT 1) AS label
       FROM point p`,
      [polygon],
    );
    const row = rows[0];
    if (!row) throw new LocationError('OUTSIDE_PHILIPPINES');
    if (row.area >= 1_000_000) {
      return {
        lat: row.lat,
        lng: row.lng,
        label: row.label,
        privacyCell: cell,
        privacyTier: tier,
        algorithmVersion: 1,
      };
    }
    if (tier > 5) {
      tier -= 1;
      cell = cellToParent(cell, tier);
      continue;
    }
    // Tiny islands must not retain the revealing source-cell identifier.
    // Largest component of the entire selected broad province is deterministic.
    const fallback = await db.query(
      `WITH land AS (
         SELECT ST_UnaryUnion(ST_Collect(geom ORDER BY source_feature_id)) AS geom
         FROM geo_admin_areas WHERE dataset_version=1 AND public_label=$1
       ), parts AS (SELECT (ST_Dump(geom)).geom FROM land),
       point AS (SELECT ST_PointOnSurface(geom) AS geom FROM parts
         ORDER BY ST_Area(geom::geography) DESC,ST_AsEWKB(geom) LIMIT 1)
       SELECT ST_X(geom) AS lng,ST_Y(geom) AS lat FROM point`,
      [row.label],
    );
    const safe = fallback.rows[0];
    return {
      ...safe,
      label: row.label,
      privacyCell: latLngToCell(safe.lat, safe.lng, 5),
      privacyTier: 5,
      algorithmVersion: 1,
    };
  }
}
