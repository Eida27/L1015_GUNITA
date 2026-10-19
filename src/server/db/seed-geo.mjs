import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const geoVersion = 1;
export const geoSha256 =
  'fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189';
const sourceUrl =
  'https://github.com/wmgeolab/geoBoundaries/raw/41af8f1/releaseData/gbOpen/PHL/ADM2/geoBoundaries-PHL-ADM2_simplified.geojson';
const sparse = new Set([
  'Batanes',
  'Basilan',
  'Biliran',
  'Camiguin',
  'Catanduanes',
  'Dinagat Islands',
  'Guimaras',
  'Marinduque',
  'Masbate',
  'Occidental Mindoro',
  'Oriental Mindoro',
  'Palawan',
  'Romblon',
  'Siquijor',
  'Sulu',
  'Tawi-Tawi',
  'City of Isabela',
]);

export async function seedGeo(client) {
  const source = await readFile(
    new URL('../../../assets/geo/phl-adm2.geojson', import.meta.url),
  );
  if (createHash('sha256').update(source).digest('hex') !== geoSha256)
    throw new Error('Geographic source checksum mismatch');
  const data = JSON.parse(source.toString('utf8'));
  if (data.features.length !== 87)
    throw new Error('Unexpected geographic source feature count');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(196742,2)');
    const current = (
      await client.query('SELECT sha256 FROM geo_datasets WHERE version=$1', [
        geoVersion,
      ])
    ).rows[0];
    if (current && current.sha256 !== geoSha256)
      throw new Error('Geographic dataset version conflict');
    if (!current)
      await client.query(
        `INSERT INTO geo_datasets(version,source_id,source_url,attribution,license,sha256)
      VALUES($1,'PHL-ADM2-2640588',$2,'geoBoundaries / NAMRIA / PSA / OCHA Philippines; represented 2020; built 2023-07-05','CC BY 3.0 IGO',$3)`,
        [geoVersion, sourceUrl, geoSha256],
      );
    let imported = 0;
    for (const feature of data.features) {
      const {
        shapeID: id,
        shapeName: label,
        shapeGroup: group,
      } = feature.properties;
      if (group !== 'PHL' || !id || !label)
        throw new Error('Invalid geographic source feature');
      const publicLabel = label.startsWith('NCR,')
        ? 'Metro Manila'
        : label === 'City of Isabela'
          ? 'Basilan'
          : label === 'Cotabato City'
            ? 'Maguindanao'
            : label;
      const tier = label.startsWith('NCR,') ? 7 : sparse.has(label) ? 5 : 6;
      const geometry = JSON.stringify(feature.geometry);
      if (current) {
        const check = (
          await client.query(
            `SELECT source_label=$3 AND public_label=$4 AND privacy_tier=$5 AND
          ST_Equals(geom,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6),4326))) AS matches
          FROM geo_admin_areas WHERE dataset_version=$1 AND source_feature_id=$2`,
            [geoVersion, id, label, publicLabel, tier, geometry],
          )
        ).rows[0];
        if (!check?.matches)
          throw new Error(
            'Geographic seed drift; review explicitly instead of overwriting',
          );
      } else {
        await client.query(
          `INSERT INTO geo_admin_areas(dataset_version,source_feature_id,source_label,public_label,privacy_tier,geom)
          VALUES($1,$2,$3,$4,$5,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6),4326)))`,
          [geoVersion, id, label, publicLabel, tier, geometry],
        );
        imported++;
      }
    }
    const count = (
      await client.query(
        'SELECT count(*)::int AS n FROM geo_admin_areas WHERE dataset_version=$1',
        [geoVersion],
      )
    ).rows[0].n;
    if (count !== 87) throw new Error('Geographic seed count drift');
    await client.query('COMMIT');
    return imported;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
