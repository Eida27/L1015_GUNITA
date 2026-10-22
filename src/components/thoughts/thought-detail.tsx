'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/components/ui/preferences';
import { emotions } from '@/lib/map-contract';
import {
  graphemeCount,
  relativeThoughtTime,
  type PublicThought,
} from '@/lib/thought-contract';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
export const emotionLabels: Record<(typeof emotions)[number], MessageKey> = {
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

export function ThoughtDetail({
  publicId,
  signal,
}: {
  publicId: string;
  signal: AbortSignal;
}) {
  const { store, t, locale } = usePreferences();
  const [thought, setThought] = useState<PublicThought | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [body, setBody] = useState('');
  const [emotion, setEmotion] = useState<(typeof emotions)[number]>('other');
  const [attempt, setAttempt] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  useEffect(() => {
    if (editing) {
      restoreEditFocus.current = true;
      editor.current?.focus();
    } else if (restoreEditFocus.current && status === 'ready') {
      editButton.current?.focus();
      restoreEditFocus.current = false;
    }
  }, [editing, status]);
  useEffect(() => {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const active = () => !combined.aborted && store.isAcknowledged();
    async function load() {
      if (!active()) return;
      try {
        const response = await fetch(`/api/thoughts/${publicId}`, {
          signal: combined,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Unavailable');
        const data: PublicThought = await response.json();
        if (!active()) return;
        setThought(data);
        setBody(data.body);
        setEmotion(data.emotion);
        setStatus('ready');
        const viewer = await fetch(`/api/thoughts/${publicId}/viewer`, {
          signal: combined,
          cache: 'no-store',
        });
        if (viewer.ok) {
          const state = await viewer.json();
          if (active()) setCanManage(state.canManage === true);
        }
      } catch {
        if (active()) setStatus('unavailable');
      }
    }
    void load();
    return () => controller.abort();
  }, [publicId, signal, store, attempt]);
  async function mutate(method: 'PATCH' | 'DELETE') {
    if (signal.aborted || !store.isAcknowledged()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/thoughts/${publicId}`, {
        method,
        signal,
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...(method === 'PATCH'
          ? { body: JSON.stringify({ body, emotion }) }
          : {}),
      });
      if (signal.aborted || !store.isAcknowledged()) return;
      if (!response.ok) {
        setError(errorKey((await response.json()).code));
        return;
      }
      setEditing(false);
      if (method === 'DELETE') {
        setThought(null);
        setStatus('unavailable');
        setCanManage(false);
      } else {
        setStatus('loading');
        setAttempt((n) => n + 1);
      }
    } catch {
      if (!signal.aborted && store.isAcknowledged())
        setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (status === 'loading')
    return <p role="status">{t('Loading thoughts…')}</p>;
  if (status === 'unavailable' || !thought)
    return <p role="status">{t('This thought is unavailable.')}</p>;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fil' ? 'fil-PH' : 'en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date(value));
  return (
    <article className="thought-detail">
      <h3>{t(emotionLabels[thought.emotion])}</h3>
      <p className="thought-body">{thought.body}</p>
      <p>
        {thought.pseudonym} · {thought.location.label}
      </p>
      <p>{t('Locations are approximate.')}</p>
      <p>
        {t('Published')}:{' '}
        <time dateTime={thought.createdAt}>{date(thought.createdAt)}</time> (
        {relativeThoughtTime(thought.createdAt, locale)})
      </p>
      <p>
        {t('Fades on')}:{' '}
        <time dateTime={thought.expiresAt}>{date(thought.expiresAt)}</time> (
        {relativeThoughtTime(thought.expiresAt, locale)})
      </p>
      <Link href={`/thought/${thought.publicId}`} prefetch={false}>
        {t('Share this thought')}
      </Link>
      {canManage ? (
        <div className="account-form">
          {editing ? (
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate('PATCH');
              }}
            >
              <label>
                {t('Your thought')}
                <textarea
                  ref={editor}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                />
              </label>
              <p aria-live="polite">{graphemeCount(body)} / 280</p>
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
              <p>{t('Location and expiration stay unchanged.')}</p>
              <button
                disabled={busy || graphemeCount(body) > 280 || !body.trim()}
              >
                {t('Save changes')}
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </button>
            </form>
          ) : (
            <button ref={editButton} onClick={() => setEditing(true)}>
              {t('Edit thought')}
            </button>
          )}
          <button disabled={busy} onClick={() => void mutate('DELETE')}>
            {t('Delete thought')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
    </article>
  );
}
