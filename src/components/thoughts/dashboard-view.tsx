'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '@/components/ui/public-content-gate';
import { usePreferences } from '@/components/ui/preferences';
import {
  bookmarksResponseSchema,
  ownThoughtsResponseSchema,
  type BookmarksResponse,
  type OwnThoughtsResponse,
  reactionTypes,
} from '@/lib/thought-contract';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
import { ThoughtDetail } from './thought-detail';

export const reactionLabels = {
  love: 'Reaction love',
  sad: 'Sad',
  care: 'Care',
  happy: 'Happy',
} as const;
function DashboardContent({
  kind,
  signal,
}: {
  kind: 'thoughts' | 'bookmarks';
  signal: AbortSignal;
}) {
  const { t, store } = usePreferences();
  const [result, setResult] = useState<
    OwnThoughtsResponse | BookmarksResponse | null
  >(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const first = useRef<HTMLHeadingElement>(null);
  const privateEpoch = useRef(0);
  useEffect(() => {
    if (!result?.items.length) return;
    const expiry = Math.min(
      ...result.items.map((item) =>
        Date.parse('thought' in item ? item.thought.expiresAt : item.expiresAt),
      ),
    );
    const timer = window.setTimeout(
      () => {
        setResult(null);
        setAttempt((n) => n + 1);
      },
      Math.max(0, Math.min(2147483647, expiry - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [result]);
  useEffect(() => {
    function clear() {
      privateEpoch.current++;
      setResult(null);
      setError(null);
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
      setResult(null);
      setError(null);
      try {
        const response = await fetch(
          `/api/me/${kind}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
          { cache: 'no-store', signal: combined },
        );
        if (!response.ok) {
          const failure = await response.json();
          if (active()) setError(errorKey(failure.code));
          return;
        }
        const data = await response.json();
        const parsed =
          kind === 'thoughts'
            ? ownThoughtsResponseSchema.parse(data)
            : bookmarksResponseSchema.parse(data);
        if (active()) {
          setResult(parsed);
          if (cursor) first.current?.focus();
        }
      } catch {
        if (active()) setError('Something went wrong. Please try again.');
      }
    }
    void load();
    return () => controller.abort();
  }, [kind, signal, store, cursor, attempt]);
  return (
    <section className="dashboard-content">
      <h1 ref={first} tabIndex={-1}>
        {t(kind === 'thoughts' ? 'Your active thoughts' : 'Saved thoughts')}
      </h1>
      <p>
        {t(
          'Only current, public thoughts appear here. Expired or removed thoughts are unavailable.',
        )}
      </p>
      {error ? (
        <div role="alert">
          <p>{t(error)}</p>
          <Link href="/log-in" prefetch={false}>
            {t('Sign in')}
          </Link>{' '}
          ·{' '}
          <Link href="/verify-email" prefetch={false}>
            {t('Verify your email')}
          </Link>
          <p>
            <button onClick={() => setAttempt((n) => n + 1)}>
              {t('Try again')}
            </button>
          </p>
        </div>
      ) : !result ? (
        <p role="status">{t('Loading thoughts…')}</p>
      ) : result.items.length === 0 ? (
        <p role="status">{t('No thoughts here yet.')}</p>
      ) : (
        <div className="settings-stack">
          {result.items.map((item) => {
            const own = 'thought' in item ? item : null;
            const thought = own
              ? own.thought
              : (item as BookmarksResponse['items'][number]);
            return (
              <section className="account-card" key={thought.publicId}>
                {own ? (
                  <div data-private-totals>
                    <h2>{t('Private reaction totals')}</h2>
                    <p>
                      {reactionTypes
                        .map(
                          (type) =>
                            `${t(reactionLabels[type])}: ${own.totals[type]}`,
                        )
                        .join(' · ')}
                    </p>
                  </div>
                ) : null}
                <ThoughtDetail
                  initialThought={thought}
                  publicId={thought.publicId}
                  signal={signal}
                  onChanged={(action) => {
                    if (action !== 'PATCH') {
                      first.current?.focus();
                      setAttempt((n) => n + 1);
                    }
                  }}
                />
              </section>
            );
          })}
        </div>
      )}
      <div className="account-links">
        {cursor ? (
          <button
            onClick={() => {
              setCursor(undefined);
              setAttempt((n) => n + 1);
            }}
          >
            {t('First page')}
          </button>
        ) : null}
        {result?.nextCursor ? (
          <button onClick={() => setCursor(result.nextCursor!)}>
            {t('Next')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
export function DashboardView({ kind }: { kind: 'thoughts' | 'bookmarks' }) {
  const { t } = usePreferences();
  const load = useCallback<PublicContentLoader>(
    async (signal) =>
      function AuthorizedDashboard() {
        return <DashboardContent kind={kind} signal={signal} />;
      },
    [kind],
  );
  return (
    <AuthShell>
      <nav className="account-links" aria-label={t('Your account')}>
        <Link prefetch={false} href="/dashboard/thoughts">
          {t('Your active thoughts')}
        </Link>
        <Link prefetch={false} href="/dashboard/bookmarks">
          {t('Saved thoughts')}
        </Link>
        <Link prefetch={false} href="/settings">
          {t('Settings')}
        </Link>
      </nav>
      <PublicContentGate load={load} />
    </AuthShell>
  );
}
