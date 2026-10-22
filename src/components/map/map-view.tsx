'use client';
import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePreferences } from '@/components/ui/preferences';
import { Dialog } from '@/components/ui/dialog';
import { emotions, type CoarsePreview } from '@/lib/map-contract';
import {
  createMapEngine,
  type DisplayMarker,
  type MapCamera,
} from './map-engine';
import type { MessageKey } from '@/lib/i18n/catalog';
import { MapGroup } from './map-group';

const emotionKeys: Record<string, MessageKey> = {
  love: 'Love',
  heartbreak: 'Heartbreak',
  regret: 'Regret',
  loneliness: 'Loneliness',
  gratitude: 'Gratitude',
  hope: 'Hope',
  happiness: 'Happiness',
  confession: 'Confession',
  other: 'Other',
};
export default function MapView({ signal }: { signal: AbortSignal }) {
  const { store, t, locale } = usePreferences();
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<Awaited<ReturnType<typeof createMapEngine>> | null>(
    null,
  );
  const [emotion, setEmotion] = useState('');
  const emotionRef = useRef('');
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [markers, setMarkers] = useState<DisplayMarker[]>([]);
  const [selected, setSelected] = useState<DisplayMarker | null>(null);
  const [groupQuery, setGroupQuery] = useState<string | null>(null);
  const [preview, setPreview] = useState<CoarsePreview | null>(null);
  const [pickStatus, setPickStatus] = useState<
    'idle' | 'loading' | 'invalid' | 'error'
  >('idle');
  const [view, setView] = useState('world');
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const previewRequest = useRef<AbortController | null>(null);
  const camera = useRef<MapCamera | undefined>(undefined);
  const safePreview = useRef<CoarsePreview | null>(null);
  async function pick(lat: number, lng: number) {
    if (signal.aborted || !store.isAcknowledged()) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    const combined = AbortSignal.any([signal, controller.signal]);
    setPickStatus('loading');
    setPreview(null);
    safePreview.current = null;
    try {
      if (!store.isAcknowledged()) return;
      const response = await fetch('/api/map/preview', {
        method: 'POST',
        signal: combined,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
        cache: 'no-store',
      });
      if (combined.aborted || !store.isAcknowledged()) return;
      if (!response.ok) {
        setPickStatus(response.status === 422 ? 'invalid' : 'error');
        return;
      }
      const point: CoarsePreview = await response.json();
      if (combined.aborted || !store.isAcknowledged()) return;
      setPreview(point);
      safePreview.current = point;
      setPickStatus('idle');
      engine.current?.preview(point);
    } catch {
      if (!combined.aborted && store.isAcknowledged()) setPickStatus('error');
    }
  }
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });
  useEffect(() => {
    if (!container.current || !store.isAcknowledged()) return;
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    void createMapEngine({
      container: container.current,
      locale,
      camera: camera.current,
      preview: safePreview.current,
      signal: combined,
      allowed: store.isAcknowledged,
      emotion: () => emotionRef.current,
      picking: () => pickingRef.current,
      onMarkers: setMarkers,
      onStatus: setStatus,
      onSelect: setSelected,
      onGroup: setGroupQuery,
      onPick: (lat, lng) => void pickRef.current(lat, lng),
    })
      .then((value) => {
        if (!combined.aborted) engine.current = value;
      })
      .catch(() => {
        if (!combined.aborted && store.isAcknowledged()) setStatus('error');
      });
    return () => {
      camera.current = engine.current?.camera() ?? camera.current;
      controller.abort();
      previewRequest.current?.abort();
      engine.current = null;
    };
  }, [signal, store, attempt, locale]);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(markers.length / 20) - 1),
  );
  return (
    <section className="map-experience" aria-labelledby="map-title">
      <div className="map-heading">
        <div>
          <p className="eyebrow">{t('A little room to feel.')}</p>
          <h1 id="map-title">{t('A place for feelings left unsaid.')}</h1>
        </div>
        <button
          onClick={() => {
            engine.current?.focusPhilippines();
            setView('philippines');
          }}
        >
          {t('Explore thoughts in the Philippines')}
        </button>
      </div>
      <div className="map-toolbar">
        <label>
          {t('Emotion')}
          <select
            value={emotion}
            onChange={(event) => {
              const value = event.target.value;
              emotionRef.current = value;
              setEmotion(value);
              setMarkers([]);
              setPage(0);
              void engine.current?.refresh();
            }}
          >
            <option value="">{t('All feelings')}</option>
            {emotions.map((key) => (
              <option key={key} value={key}>
                {t(emotionKeys[key])}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-pressed={picking}
          onClick={() => {
            pickingRef.current = !picking;
            setPicking(!picking);
          }}
        >
          {t('Preview a place')}
        </button>
      </div>
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label={t('Map')}
        data-testid="map-view"
        data-view={view}
      />
      <div aria-live="polite" className="map-status">
        {status === 'loading' ? (
          t('Loading the map…')
        ) : status === 'error' ? (
          <>
            <span>
              {t(
                'The map is unavailable. Check your connection and try again.',
              )}
            </span>
            <button
              onClick={() => {
                setStatus('loading');
                setAttempt((n) => n + 1);
              }}
            >
              {t('Try again')}
            </button>
          </>
        ) : markers.length === 0 ? (
          t('No thoughts in this view yet.')
        ) : (
          t('Locations are approximate.')
        )}
      </div>
      {picking ? (
        <section className="map-picker" aria-labelledby="picker-title">
          <h2 id="picker-title">{t('Choose a place, gently.')}</h2>
          <p>
            {t(
              'Tap the map or move it with the arrow keys, then choose its center. The marker will be approximated. No GPS is used.',
            )}
          </p>
          <button
            onClick={() => {
              const center = engine.current?.center();
              if (center) void pick(center.lat, center.lng);
            }}
          >
            {t('Use map center')}
          </button>
          <details>
            <summary>{t('Enter a location with the keyboard')}</summary>
            <form
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                void pick(Number(values.get('lat')), Number(values.get('lng')));
                form.reset();
              }}
              className="coordinate-form"
            >
              <label>
                {t('Latitude')}
                <input
                  name="lat"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  required
                />
              </label>
              <label>
                {t('Longitude')}
                <input
                  name="lng"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  required
                />
              </label>
              <button>{t('Preview approximate location')}</button>
            </form>
          </details>
          <p role="status">
            {pickStatus === 'loading'
              ? t('Finding an approximate place…')
              : pickStatus === 'invalid'
                ? t('Choose a place on Philippine land.')
                : pickStatus === 'error'
                  ? t('The preview is unavailable. Try again.')
                  : preview
                    ? `${t('Approximate location')}: ${preview.label}`
                    : t('Your selection is not saved.')}
          </p>
          {preview ? (
            <p>
              {t(
                'Only the broad place is shown. A chosen place is not proof of where someone lives or has been.',
              )}
            </p>
          ) : null}
        </section>
      ) : null}
      <details className="visible-markers" open>
        <summary>{t('Visible places and feelings')}</summary>
        <p>
          {t('Groups show numbers of thoughts. Select a group to zoom in.')}
        </p>
        <ul>
          {markers
            .slice(currentPage * 20, currentPage * 20 + 20)
            .map((item) => (
              <li key={item.key}>
                <button
                  onClick={() => void engine.current?.select(item)}
                  data-count={item.count}
                >
                  {item.count > 1
                    ? `${item.count} ${t(item.groupQuery ? 'thoughts — choose one' : 'thoughts — zoom in')}`
                    : `${t(emotionKeys[item.emotion ?? 'other'] ?? 'Other')} · ${item.label}`}
                </button>
              </li>
            ))}
        </ul>
        {markers.length > 20 ? (
          <div className="map-toolbar">
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t('Previous')}
            </button>
            <button
              disabled={(currentPage + 1) * 20 >= markers.length}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('Next')}
            </button>
          </div>
        ) : null}
      </details>
      {groupQuery ? (
        <MapGroup
          query={groupQuery}
          signal={signal}
          onClose={() => setGroupQuery(null)}
        />
      ) : null}
      {selected ? (
        <Dialog titleId="selected-place" onClose={() => setSelected(null)}>
          <h2 id="selected-place">
            {t(emotionKeys[selected.emotion ?? 'other'] ?? 'Other')}
          </h2>
          <p>{selected.label}</p>
          <p>{t('Locations are approximate.')}</p>
          <button onClick={() => setSelected(null)}>{t('Close')}</button>
        </Dialog>
      ) : null}
    </section>
  );
}
