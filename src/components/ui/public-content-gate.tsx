'use client';
import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';

import { Dialog } from './dialog';
import { PreferenceControls, usePreferences } from './preferences';
import { ErrorState, LoadingState } from './states';

// CLIENT-ONLY producer: never pass fetched data, promises, or server children.
// Call the loader only here; it must honor AbortSignal for fetch/import work.
export type PublicContentLoader = (
  signal: AbortSignal,
) => Promise<ComponentType>;
function AuthorizedContent({ load }: { load: PublicContentLoader }) {
  const { store } = usePreferences();
  const [result, setResult] = useState<{
    Content?: ComponentType;
    failed?: boolean;
  }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!store.isAcknowledged()) return;
    load(controller.signal)
      .then((Content) => {
        if (!controller.signal.aborted && store.isAcknowledged())
          setResult({ Content });
      })
      .catch(() => {
        if (!controller.signal.aborted && store.isAcknowledged())
          setResult({ failed: true });
      });
    return () => controller.abort();
  }, [load, store, attempt]);
  // A store notification immediately unmounts this component on revocation.
  if (!store.isAcknowledged()) return null;
  if (result.failed)
    return (
      <ErrorState
        retry={() => {
          setResult({});
          setAttempt((n) => n + 1);
        }}
      />
    );
  const Content = result.Content;
  return Content ? <Content /> : <LoadingState />;
}
function Warning() {
  const { store, t } = usePreferences();
  const [checked, setChecked] = useState(false);

  return (
    <Dialog titleId="warning-title" descriptionId="warning-description">
      <p className="eyebrow">{t('Before you enter')}</p>
      <h2 id="warning-title">{t('A quiet space for adults.')}</h2>
      <div id="warning-description">
        <p>
          {t(
            'Gunita is for people aged 18 and older. You may encounter difficult feelings, grief, and potentially disturbing content.',
          )}
        </p>
        <p>
          {t(
            'This is self-attestation, not age verification. Community rules still apply. Your authored words are never automatically translated.',
          )}
        </p>
      </div>
      <PreferenceControls theme={false} />
      <form
        method="post"
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (checked) store.acknowledge();
        }}
      >
        <label className="check-label">
          <input
            type="checkbox"
            required
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          {t('I confirm that I am at least 18 years old')}
        </label>
        <button disabled={!checked} type="submit">
          {t('Enter Gunita')}
        </button>
      </form>
      {!store.storageAvailable() ? (
        <p role="status">
          {t(
            'Storage is unavailable. Your acknowledgment lasts only for this visit.',
          )}
        </p>
      ) : null}
      <nav className="account-links" aria-label={t('Policies')}>
        <Link href="/guidelines" prefetch={false}>
          {t('Guidelines')}
        </Link>
        <Link href="/help" prefetch={false}>
          {t('Help')}
        </Link>
      </nav>
    </Dialog>
  );
}

export function PublicContentGate({ load }: { load: PublicContentLoader }) {
  const { acknowledged, ready, t } = usePreferences();
  if (acknowledged) return <AuthorizedContent load={load} />;
  return (
    <>
      <noscript>
        {t(
          'Enable JavaScript to acknowledge the warning and load public thoughts.',
        )}
      </noscript>
      {ready ? <Warning /> : <LoadingState />}
    </>
  );
}
