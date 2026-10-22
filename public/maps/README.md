# Local development basemap fixture

`development-world.geojson` is Natural Earth's 1:110m country geometry, fetched 2026-10-20 from <https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson>.

SHA256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`; original bytes retained. Natural Earth terms: <https://www.naturalearthdata.com/about/terms-of-use/> (public domain). Attribution is shown in the style even though the license does not require it. This is an explicitly labeled local fixture, not a street basemap or Philippine land-validation source. The MapLibre style uses local font rasterization and makes no external tile/font request.

For production configure a separately authorized `MAP_STYLE_URL` and verify all provider/OSM source attribution and usage limits. The local fixture is not an unlimited public OSM tile-service assumption. Philippine posting validation uses the separate versioned Phase 1 geoBoundaries/NAMRIA/PSA/OCHA dataset under `assets/geo`.

Build/dev copy MapLibre GL JS 6.15.0's ESM worker from the exact installed BSD-3-Clause package into ignored generated/. Its license header is retained; do not edit or commit this generated vendor asset. The packaged worker is served from the same origin.
