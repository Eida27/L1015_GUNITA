'use client';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { usePreferences } from '@/components/ui/preferences';
import type { MapMember, MapMembers } from '@/lib/map-contract';
import type { MessageKey } from '@/lib/i18n/catalog';

const emotionKeys: Record<MapMember['emotion'], MessageKey> = {
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

// This is map-scoped discovery. Full thought reading remains the Phase 5 boundary.
export function MapGroup({
  query,
  signal,
  onClose,
}: {
  query: string;
  signal: AbortSignal;
  onClose: () => void;
}) {
  const { store, t } = usePreferences();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<MapMembers | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<MapMember | null>(null);
  const lastSelected = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const selectedTitle = useRef<HTMLHeadingElement>(null);
  const after = cursors[page];
  useEffect(() => {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const active = () => !combined.aborted && store.isAcknowledged();
    async function load() {
      if (!active()) return;
      try {
        const params = new URLSearchParams(query);
        if (after) params.set('after', after);
        const response = await fetch(`/api/map/members?${params}`, {
          signal: combined,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Map unavailable');
        const data: MapMembers = await response.json();
        if (!active()) return;
        setResult(data);
        setStatus('ready');
      } catch {
        if (active()) setStatus('error');
      }
    }
    void load();
    return () => controller.abort();
  }, [query, after, signal, store, attempt]);
  useEffect(() => {
    if (selected) selectedTitle.current?.focus();
    else if (lastSelected.current) {
      const target = [
        ...(list.current?.querySelectorAll<HTMLButtonElement>(
          'button[data-public-id]',
        ) ?? []),
      ].find((button) => button.dataset.publicId === lastSelected.current);
      target?.focus();
    }
  }, [selected]);
  function move(next: number) {
    if (signal.aborted || !store.isAcknowledged()) return;
    setResult(null);
    setStatus('loading');
    setPage(next);
  }
  return (
    <Dialog titleId="map-group-title" onClose={onClose}>
      <h2 id="map-group-title">{t('Thoughts at this place')}</h2>
      {selected ? (
        <section data-selected-public-id={selected.publicId}>
          <h3 ref={selectedTitle} tabIndex={-1}>
            {t(emotionKeys[selected.emotion])}
          </h3>
          <p>{selected.label}</p>
          <p>{t('Locations are approximate.')}</p>
          <button onClick={() => setSelected(null)}>
            {t('Back to this group')}
          </button>
        </section>
      ) : (
        <>
          <p role="status">
            {status === 'loading'
              ? t('Loading thoughts…')
              : status === 'error'
                ? t(
                    'The map is unavailable. Check your connection and try again.',
                  )
                : result?.total === 0
                  ? t('No thoughts in this view yet.')
                  : `${result?.total} ${t('thoughts at this place')}`}
          </p>
          {status === 'error' ? (
            <button
              onClick={() => {
                setStatus('loading');
                setAttempt((n) => n + 1);
              }}
            >
              {t('Try again')}
            </button>
          ) : null}
          {result ? (
            <>
              <ul ref={list} className="map-group-members">
                {result.members.map((member, index) => (
                  <li key={member.publicId}>
                    <button
                      data-public-id={member.publicId}
                      onClick={() => {
                        if (signal.aborted || !store.isAcknowledged()) return;
                        lastSelected.current = member.publicId;
                        setSelected(member);
                      }}
                    >
                      {page * 20 + index + 1}. {t(emotionKeys[member.emotion])}{' '}
                      · {member.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="map-toolbar">
                <button disabled={page === 0} onClick={() => move(page - 1)}>
                  {t('Previous')}
                </button>
                <button
                  disabled={!result.nextCursor}
                  onClick={() => {
                    if (!result.nextCursor) return;
                    setCursors([
                      ...cursors.slice(0, page + 1),
                      result.nextCursor,
                    ]);
                    move(page + 1);
                  }}
                >
                  {t('Next')}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
