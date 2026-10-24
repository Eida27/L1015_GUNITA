'use client';
import Link from 'next/link';
import { ReportForm } from '@/components/moderation/report-form';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/components/ui/preferences';
import { emotions } from '@/lib/map-contract';
import {
  graphemeCount,
  relativeThoughtTime,
  publicThoughtSchema,
  viewerResponseSchema,
  reactionTypes,
  type ViewerResponse,
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
  initialThought,
  onChanged,
}: {
  publicId: string;
  signal: AbortSignal;
  initialThought?: PublicThought;
  onChanged?: (action: 'PATCH' | 'DELETE' | 'bookmark') => void;
}) {
  const { store, t, locale } = usePreferences();
  const [thought, setThought] = useState<PublicThought | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [canManage, setCanManage] = useState(false);
  const [viewer, setViewer] = useState<ViewerResponse | null>(null);
  const [checkingViewer, setCheckingViewer] = useState(true);
  const [prompt, setPrompt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [body, setBody] = useState('');
  const [emotion, setEmotion] = useState<(typeof emotions)[number]>('other');
  const [attempt, setAttempt] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  const privateEpoch = useRef(0);
  useEffect(() => {
    if (!thought) return;
    const timer = window.setTimeout(
      () => {
        if (Date.parse(thought.expiresAt) > Date.now()) {
          setAttempt((n) => n + 1);
          return;
        }
        setThought(null);
        setStatus('unavailable');
        setCanManage(false);
        setViewer(null);
      },
      Math.max(
        0,
        Math.min(2147483647, Date.parse(thought.expiresAt) - Date.now()),
      ),
    );
    return () => window.clearTimeout(timer);
  }, [thought]);
  useEffect(() => {
    function clear() {
      privateEpoch.current++;
      setCanManage(false);
      setViewer(null);
      setCheckingViewer(true);
      setEditing(false);
    }
    function refresh() {
      clear();
      setAttempt((n) => n + 1);
    }
    function visibility() {
      if (document.hidden) clear();
      else refresh();
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (editing) {
      restoreEditFocus.current = true;
      editor.current?.focus();
    } else if (restoreEditFocus.current && status === 'ready' && canManage) {
      editButton.current?.focus();
      restoreEditFocus.current = false;
    }
  }, [editing, status, canManage]);
  useEffect(() => {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const epoch = privateEpoch.current;
    const active = () =>
      !combined.aborted &&
      store.isAcknowledged() &&
      !document.hidden &&
      epoch === privateEpoch.current;
    async function load() {
      if (!active()) return;
      setCanManage(false);
      setViewer(null);
      setCheckingViewer(true);
      setPrompt(false);
      try {
        const response =
          initialThought && attempt === 0
            ? null
            : await fetch(`/api/thoughts/${publicId}`, {
                signal: combined,
                cache: 'no-store',
              });
        if (response && !response.ok) throw new Error('Unavailable');
        const data = publicThoughtSchema.parse(
          response ? await response.json() : initialThought,
        );
        if (!active()) return;
        setThought(data);
        setBody(data.body);
        setEmotion(data.emotion);
        setStatus('ready');
        try {
          const viewer = await fetch(`/api/thoughts/${publicId}/viewer`, {
            signal: combined,
            cache: 'no-store',
          });
          if (viewer.ok) {
            const state = viewerResponseSchema.parse(await viewer.json());
            if (active()) {
              setCanManage(state.canManage);
              setViewer(state);
            }
          }
        } catch {
          // Ownership is optional for public reading. A failed lookup never
          // grants management or replaces already loaded public content.
          if (active()) setCanManage(false);
        } finally {
          if (active()) setCheckingViewer(false);
        }
      } catch {
        if (active()) {
          setStatus('unavailable');
          setCheckingViewer(false);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [publicId, signal, store, attempt, initialThought]);
  async function interact(
    kind: 'reaction' | 'bookmark',
    type?: (typeof reactionTypes)[number],
  ) {
    if (signal.aborted || !store.isAcknowledged()) return;
    if (!viewer) {
      setPrompt(true);
      return;
    }
    const epoch = privateEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/thoughts/${publicId}/${kind}`, {
        method: kind === 'bookmark' && viewer.bookmarked ? 'DELETE' : 'PUT',
        cache: 'no-store',
        signal,
        headers: { 'content-type': 'application/json' },
        ...(type ? { body: JSON.stringify({ type }) } : {}),
      });
      if (
        signal.aborted ||
        !store.isAcknowledged() ||
        epoch !== privateEpoch.current
      )
        return;
      if (!response.ok) {
        setError(errorKey((await response.json()).code));
        setViewer(null);
        setCanManage(false);
        return;
      }
      const refreshed = await fetch(`/api/thoughts/${publicId}/viewer`, {
        cache: 'no-store',
        signal,
      });
      if (!refreshed.ok) throw new Error('Unavailable');
      const state = viewerResponseSchema.parse(await refreshed.json());
      if (
        !signal.aborted &&
        store.isAcknowledged() &&
        !document.hidden &&
        epoch === privateEpoch.current
      ) {
        setViewer(state);
        setCanManage(state.canManage);
        if (kind === 'bookmark') onChanged?.('bookmark');
      }
    } catch {
      if (!signal.aborted && store.isAcknowledged()) {
        setViewer(null);
        setCanManage(false);
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }
  function resetDraft() {
    if (!thought) return;
    setBody(thought.body);
    setEmotion(thought.emotion);
    setError(null);
  }
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
        setViewer(null);
      } else {
        setStatus('loading');
        setAttempt((n) => n + 1);
      }
      onChanged?.(method);
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
      <div
        className="interaction-controls"
        role="group"
        aria-label={t('Reactions')}
        aria-busy={checkingViewer || busy}
      >
        {reactionTypes.map((type) => (
          <button
            key={type}
            disabled={busy || canManage || checkingViewer}
            aria-pressed={viewer?.myReaction === type}
            onClick={() => void interact('reaction', type)}
          >
            {t(
              (
                {
                  love: 'Reaction love',
                  sad: 'Sad',
                  care: 'Care',
                  happy: 'Happy',
                } as const
              )[type],
            )}
          </button>
        ))}
        <button
          disabled={busy || canManage || checkingViewer}
          aria-pressed={viewer?.bookmarked ?? false}
          onClick={() => void interact('bookmark')}
        >
          {t(viewer?.bookmarked ? 'Remove bookmark' : 'Save thought')}
        </button>
      </div>
      {prompt ? (
        <p role="status">
          {t('Sign in to react or save thoughts.')}{' '}
          <Link href="/log-in" prefetch={false}>
            {t('Sign in')}
          </Link>{' '}
          ·{' '}
          <Link href="/sign-up" prefetch={false}>
            {t('Create account')}
          </Link>
        </p>
      ) : null}
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
              <button
                type="button"
                onClick={() => {
                  resetDraft();
                  setEditing(false);
                }}
              >
                {t('Cancel')}
              </button>
            </form>
          ) : (
            <button
              ref={editButton}
              onClick={() => {
                resetDraft();
                setEditing(true);
              }}
            >
              {t('Edit thought')}
            </button>
          )}
          <button disabled={busy} onClick={() => void mutate('DELETE')}>
            {t('Delete thought')}
          </button>
        </div>
      ) : null}
      <ReportForm key={thought.publicId} publicId={thought.publicId} />
      {error ? <p role="alert">{t(error)}</p> : null}
    </article>
  );
}
