'use client';
import {
  Map,
  NavigationControl,
  setWorkerUrl,
  setWorkerCount,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import type { MapPins, CoarsePreview } from '@/lib/map-contract';
import { catalogs, type Locale } from '@/lib/i18n/catalog';

export type MapCamera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

export type DisplayMarker = {
  key: string;
  lng: number;
  lat: number;
  count: number;
  clusterId?: number;
  publicId?: string;
  emotion?: string;
  label?: string;
  groupQuery?: string;
};
export async function createMapEngine(options: {
  container: HTMLElement;
  locale: Locale;
  camera?: MapCamera;
  preview?: CoarsePreview | null;
  signal: AbortSignal;
  allowed: () => boolean;
  emotion: () => string;
  picking: () => boolean;
  onMarkers: (markers: DisplayMarker[]) => void;
  onStatus: (status: 'loading' | 'ready' | 'error') => void;
  onSelect: (marker: DisplayMarker) => void;
  onGroup: (query: string) => void;
  onPick: (lat: number, lng: number) => void;
}) {
  const { signal, allowed } = options;
  const active = () => !signal.aborted && allowed();
  if (!active()) throw new DOMException('Aborted', 'AbortError');
  const config = await fetch('/api/map/style', { signal, cache: 'no-store' });
  if (!config.ok) throw new Error('Map unavailable');
  const { url } = await config.json();
  if (!active()) throw new DOMException('Aborted', 'AbortError');
  options.onMarkers([]);
  options.onStatus('loading');
  setWorkerUrl('/maps/generated/maplibre-gl-worker.mjs?v=6.15.0');
  setWorkerCount(1);
  const copy = catalogs[options.locale];
  const map = new Map({
    container: options.container,
    style: url,
    center: [20, 18],
    zoom: 1,
    ...options.camera,
    locale: {
      'Map.Title': copy.Map,
      'NavigationControl.ZoomIn': copy['Zoom in'],
      'NavigationControl.ZoomOut': copy['Zoom out'],
      'AttributionControl.ToggleAttribution': copy['Toggle attribution'],
      'AttributionControl.MapFeedback': copy['Map feedback'],
    },
    maxZoom: 18,
    renderWorldCopies: false,
    attributionControl: { compact: false },
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  let timer: ReturnType<typeof setTimeout>;
  let request: AbortController | undefined;
  let loaded = false;
  // Keep safe preview updates that arrive before the style/source is ready.
  let currentPreview = options.preview ?? null;
  function marker(feature: MapGeoJSONFeature): DisplayMarker | null {
    if (feature.geometry.type !== 'Point') return null;
    const p = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    return {
      key: String(p.cluster_id ?? p.publicId ?? `${lng},${lat}`),
      lng,
      lat,
      count: Number(p.thoughtCount ?? p.count),
      clusterId: p.cluster_id,
      publicId: p.publicId,
      emotion: p.emotion,
      label: p.label,
      groupQuery: p.groupQuery,
    };
  }
  async function select(item: DisplayMarker) {
    if (!active()) return;
    if (item.clusterId !== undefined) {
      const zoom = await (
        map.getSource('thoughts') as GeoJSONSource
      ).getClusterExpansionZoom(item.clusterId);
      if (active())
        map.easeTo({ center: [item.lng, item.lat], zoom: Math.min(18, zoom) });
    } else if (item.groupQuery) {
      options.onGroup(item.groupQuery);
    } else if (item.count > 1) {
      map.easeTo({
        center: [item.lng, item.lat],
        zoom: Math.min(18, map.getZoom() + 2),
      });
    } else options.onSelect(item);
  }
  function displayMarkers() {
    if (!active() || !loaded || !map.getLayer('thought-circles')) return;
    const unique = new globalThis.Map<string, DisplayMarker>();
    for (const feature of map.queryRenderedFeatures({
      layers: ['thought-circles'],
    })) {
      const item = marker(feature);
      if (item) unique.set(item.key, item);
    }
    options.onMarkers(
      [...unique.values()].sort((a, b) => a.key.localeCompare(b.key)),
    );
  }
  async function refresh() {
    if (!active() || !loaded) return;
    request?.abort();
    request = new AbortController();
    const requestSignal = AbortSignal.any([signal, request.signal]);
    const b = map.getBounds();
    const bbox = [
      Math.max(-180, b.getWest()),
      Math.max(-85, b.getSouth()),
      Math.min(180, b.getEast()),
      Math.min(85, b.getNorth()),
    ];
    const params = new URLSearchParams({
      bbox: bbox.join(','),
      zoom: String(map.getZoom()),
    });
    if (options.emotion()) params.set('emotion', options.emotion());
    options.onStatus('loading');
    try {
      // Revalidate storage immediately before every event-driven request.
      if (!active()) return;
      const response = await fetch(`/api/map/pins?${params}`, {
        signal: requestSignal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Map unavailable');
      const data: MapPins = await response.json();
      if (!active() || requestSignal.aborted) return;
      // Bind the terminal key to the exact query that produced this feature,
      // even while a newer viewport request is in flight.
      (map.getSource('thoughts') as GeoJSONSource).setData({
        ...data,
        features: data.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            ...(feature.properties.group
              ? {
                  groupQuery: `${params}&group=${encodeURIComponent(feature.properties.group)}`,
                }
              : {}),
          },
        })),
      });
      options.onStatus('ready');
    } catch {
      if (active() && !requestSignal.aborted) options.onStatus('error');
    }
  }
  map.on('load', () => {
    if (!active()) return;
    loaded = true;
    map.addSource('thoughts', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: 17,
      clusterProperties: { thoughtCount: ['+', ['get', 'count']] },
    });
    map.addLayer({
      id: 'thought-circles',
      type: 'circle',
      source: 'thoughts',
      paint: {
        'circle-radius': [
          'case',
          ['has', 'point_count'],
          20,
          ['>', ['get', 'count'], 1],
          18,
          9,
        ],
        'circle-color': [
          'match',
          ['get', 'emotion'],
          'love',
          '#a95365',
          'heartbreak',
          '#846585',
          'regret',
          '#a17b41',
          'loneliness',
          '#58768b',
          'gratitude',
          '#64835a',
          'hope',
          '#39877e',
          'happiness',
          '#b58e2d',
          'confession',
          '#805475',
          '#576353',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f7f5ee',
      },
    });
    map.addLayer({
      id: 'thought-count',
      type: 'symbol',
      source: 'thoughts',
      filter: ['any', ['has', 'point_count'], ['>', ['get', 'count'], 1]],
      layout: {
        'text-field': [
          'to-string',
          ['coalesce', ['get', 'thoughtCount'], ['get', 'count']],
        ],
        'text-font': ['Arial'],
        'text-size': 12,
      },
      paint: { 'text-color': '#ffffff' },
    });
    map.addSource('preview', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: currentPreview
          ? [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [currentPreview.lng, currentPreview.lat],
                },
                properties: {},
              },
            ]
          : [],
      },
    });
    map.addLayer({
      id: 'preview',
      type: 'circle',
      source: 'preview',
      paint: {
        'circle-radius': 16,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#53694e',
        'circle-stroke-width': 5,
        'circle-opacity': 0.7,
      },
    });
    void refresh();
  });
  map.on('idle', displayMarkers);
  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 250);
  });
  map.on('click', (event) => {
    if (!active()) return;
    if (options.picking()) {
      options.onPick(event.lngLat.lat, event.lngLat.lng);
      return;
    }
    if (!loaded) return;
    const feature = map.queryRenderedFeatures(event.point, {
      layers: ['thought-circles'],
    })[0];
    if (feature) {
      const item = marker(feature);
      if (item) void select(item);
    }
  });
  map.on('error', () => {
    if (active()) options.onStatus('error');
  });
  const offline = () => {
    if (active()) options.onStatus('error');
  };
  const online = () => void refresh();
  const refreshTimer = setInterval(() => void refresh(), 30000);
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  const dispose = () => {
    clearTimeout(timer);
    clearInterval(refreshTimer);
    request?.abort();
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
    map.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  return {
    refresh,
    select,
    camera(): MapCamera {
      const center = map.getCenter();
      return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    },
    focusPhilippines() {
      map.fitBounds(
        [
          [116, 4.5],
          [127, 21.5],
        ],
        { padding: 25, duration: 500 },
      );
    },
    center() {
      return map.getCenter();
    },
    clearPreview() {
      currentPreview = null;
      (map.getSource('preview') as GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
    },
    preview(point: CoarsePreview) {
      currentPreview = point;
      (map.getSource('preview') as GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
            properties: {},
          },
        ],
      });
      map.easeTo({
        center: [point.lng, point.lat],
        zoom: Math.max(7, map.getZoom()),
      });
    },
  };
}
