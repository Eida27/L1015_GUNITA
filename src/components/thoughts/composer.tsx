'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { usePreferences } from '@/components/ui/preferences';
import { emotions, type CoarsePreview } from '@/lib/map-contract';
import {
  CURRENT_GUIDELINES_VERSION,
  graphemeCount,
  type PublicThought,
} from '@/lib/thought-contract';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
import { emotionLabels } from './thought-detail';

export function Composer({
  signal,
  point,
  location,
  onClose,
  onPublished,
}: {
  signal: AbortSignal;
  point: CoarsePreview | null;
  location: () => { lat: number; lng: number } | null;
  onClose: () => void;
  onPublished: (thought: PublicThought) => void;
}) {
  const { store, t } = usePreferences();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [body, setBody] = useState('');
  const [emotion, setEmotion] = useState<(typeof emotions)[number]>('hope');
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    if (!store.isAcknowledged() || combined.aborted) return;
    void fetch('/api/me/consent', { signal: combined, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (combined.aborted || !store.isAcknowledged()) return;
        setAuthorized(response.ok);
        if (response.ok) setAccepted(data.accepted);
        else setError(errorKey(data.code));
      })
      .catch(() => {
        if (!combined.aborted)
          setError('Something went wrong. Please try again.');
      });
    return () => controller.abort();
  }, [signal, store]);
  async function publish() {
    if (signal.aborted || !store.isAcknowledged()) return;
    const picked = location();
    if (!picked || !point) return;
    setBusy(true);
    setError(null);
    try {
      if (!accepted) {
        if (!checked) return;
        const consent = await fetch('/api/me/consent', {
          method: 'PUT',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: CURRENT_GUIDELINES_VERSION }),
        });
        if (!consent.ok) {
          setError(errorKey((await consent.json()).code));
          return;
        }
        if (signal.aborted || !store.isAcknowledged()) return;
        setAccepted(true);
      }
      const response = await fetch('/api/thoughts', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, emotion, location: picked }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (signal.aborted || !store.isAcknowledged()) return;
      if (!response.ok) {
        setError(errorKey(data.code));
        return;
      }
      setBody('');
      onPublished(data);
    } catch {
      if (!signal.aborted) setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (authorized === false)
    return (
      <Dialog titleId="composer-auth" onClose={onClose}>
        <h2 id="composer-auth">{t('Leave a thought')}</h2>
        <p role="alert">{t(error ?? 'Sign in to continue.')}</p>
        <Link href="/log-in" prefetch={false}>
          {t('Sign in')}
        </Link>
        <Link href="/verify-email" prefetch={false}>
          {t('Verify email')}
        </Link>
      </Dialog>
    );
  return (
    <section className="composer account-form" aria-labelledby="composer-title">
      <h2 id="composer-title">{t('Leave a thought')}</h2>
      {authorized === null ? (
        <p role="status">{t('Loading…')}</p>
      ) : (
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          <label>
            {t('Your thought')}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              aria-describedby="thought-counter thought-privacy"
            />
          </label>
          <p id="thought-counter" aria-live="polite">
            {graphemeCount(body)} / 280
          </p>
          <label>
            {t('Emotion')}
            <select
              value={emotion}
              onChange={(e) => setEmotion(e.target.value as typeof emotion)}
            >
              {emotions.map((key) => (
                <option key={key} value={key}>
                  {t(emotionLabels[key])}
                </option>
              ))}
            </select>
          </label>
          <p id="thought-privacy">
            {t(
              'Your permanent pseudonym links your thoughts. Avoid names, addresses and contact details. Only an approximate place is published. Thoughts fade after 30 days; backups may retain them briefly.',
            )}
          </p>
          <h3>{t('Preview')}</h3>
          <p className="thought-body">{body}</p>
          <p>
            {t(emotionLabels[emotion])} ·{' '}
            {point?.label ?? t('Choose a place on the map above.')}
          </p>
          {!accepted ? (
            <label className="check-label">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                required
              />
              {t('I accept the current Community Guidelines.')}{' '}
              <Link href="/guidelines" prefetch={false}>
                {t('Guidelines')}
              </Link>
            </label>
          ) : null}
          <button
            disabled={
              !authorized ||
              busy ||
              !point ||
              !body.trim() ||
              graphemeCount(body) > 280 ||
              (!accepted && !checked)
            }
          >
            {t('Publish thought')}
          </button>
        </form>
      )}
      {error ? <p role="alert">{t(error)}</p> : null}
      <button onClick={onClose}>{t('Cancel')}</button>
    </section>
  );
}
