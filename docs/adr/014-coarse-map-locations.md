# ADR 014: deterministic land representatives and bounded map discovery

Phase 4, local implementation baseline. Geography/privacy review remains a launch gate; these rules are not an anonymity guarantee.

## Location algorithm v1

Input latitude/longitude exists only in request memory and parameterized PostGIS queries. Dataset version 1 (`geo_admin_areas`, checksum-bound by the Phase 1 importer) is the land authority. `ST_Covers` accepts land boundaries. On overlapping administrative boundaries choose the lowest H3 resolution (most conservative tier). Urban/intermediate/sparse-island start at H3 7/6/5 respectively.

Intersect the H3 cell with **all** dataset-1 land, in deterministic source-feature order. Union administrative seams, extract polygon components and choose the largest geodesic-area component (EWKB tie-break). `ST_PointOnSurface` yields its inland representative. The label is the broad province/Metro Manila label with the greatest cell intersection area, then lexical label/source-ID tie-break. Neither representative nor label depends on which original administrative polygon contained the selected point.

If that largest connected land component is smaller than **1,000,000 m² (1 km²)**, escalate using the H3 parent from 7 to 6 to 5 and repeat. At resolution 5, a still-small component uses the largest land component of the selected **whole broad province**. This deliberately trades location fidelity for privacy on tiny islands. Store its interior point, broad label, effective H3 cell computed from that safe province point at resolution 5, tier 5 and algorithm version 1. **Discard the tiny origin cell**, earlier cells, selected coordinate and the reason/path of fallback. No exact-point queue, storage column, URL, browser persistence or logging is introduced. The version is part of the storage handoff; changing the dataset or thresholds requires a new reviewed algorithm version, not silent movement of old posts.

## Discovery

Only active published thoughts are visible. Strict finite viewport and zoom validation, antimeridian splitting, one optional emotion and the existing publication predicate precede aggregation. Each viewport is divided into a zoom-dependent grid whose step is at least width/30 and height/30: at most 31 × 31 occupied bins including edge points, below the 1,000-feature limit. Every thought belongs to one bin; no LIMIT truncation hides counts. A bin uses an existing stored coarse point as its representative. Single bins expose only public ID, emotion, broad label, count 1 and coarse point; groups expose count and coarse point. No body, identity or reaction data is selected into the bulk DTO. Responses are no-store to preserve immediate exclusion without a cache invalidation dependency.

MapLibre clusters sum each input feature's thought count through `clusterProperties`; `point_count` is only a cluster flag, never the displayed thought total. Groups zoom toward their representatives. The accessible map list follows rendered markers with 20 items per page, the same emotion filter and the same zoom action. Detailed thought reading belongs to Phase 5.

## Basemap and privacy boundary

Local evaluation uses the explicitly labeled public-domain Natural Earth world fixture, served locally without provider credentials or external tile requests. It is not the posting geometry. Production requires an authorized HTTPS style provider through `MAP_STYLE_URL`; provider source attribution (including OSM when applicable) is rendered by MapLibre. Public launch still requires licensing/usage-cap/CSP review for that actual provider.

The stable client loader is behind `PublicContentGate`. There is no SSR/RSC UGC data. Every map/preview event checks current acknowledgment and uses abortable requests; raw picks use bounded same-origin POST JSON. Next development request/browser logging is disabled to prevent rejected coordinate-bearing query strings or bodies entering framework logs. Production Next has no request access logger; any future proxy/logger must preserve this suppression/redaction contract.

Anonymous map budgets use the existing shared atomic counter table, with no IP address: 120 previews/minute and 600 pin requests/minute across the service. These are initial protective caps; per-client attribution and deployment-specific tuning remain operational review work.
