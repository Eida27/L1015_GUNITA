'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '@/components/ui/public-content-gate';
import {
  PreferenceControls,
  usePreferences,
} from '@/components/ui/preferences';
export function ShareView({ publicId }: { publicId: string }) {
  const { t } = usePreferences();
  const load = useCallback<PublicContentLoader>(
    async (signal) => {
      const { ThoughtDetail } = await import('./thought-detail');
      return function AuthorizedThought() {
        return <ThoughtDetail publicId={publicId} signal={signal} />;
      };
    },
    [publicId],
  );
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="wordmark">
          gunita
        </Link>
        <PreferenceControls />
        <Link href="/dashboard/thoughts" prefetch={false}>
          {t('Your active thoughts')}
        </Link>
      </header>
      <main tabIndex={-1} id="main">
        <h1>{t('A thought left unsaid')}</h1>
        <PublicContentGate load={load} />
      </main>
    </div>
  );
}
