import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function prepareMapAssets() {
  await mkdir('public/maps/generated', { recursive: true });
  await copyFile(
    fileURLToPath(
      import.meta.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'),
    ),
    'public/maps/generated/maplibre-gl-worker.mjs',
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await prepareMapAssets();
