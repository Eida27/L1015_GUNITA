'use client';
import Link from 'next/link';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '@/components/ui/public-content-gate';
import {
  usePreferences,
  PreferenceControls,
} from '@/components/ui/preferences';
const loadPublicContent: PublicContentLoader = async (signal) => {
  const { default: MapView } = await import('@/components/map/map-view');
  return function AuthorizedMap() {
    return <MapView signal={signal} />;
  };
};
export default function Home() {
  const { t } = usePreferences();
  return (
    <div className="site-shell map-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label={t('Gunita home')}>
          <span aria-hidden="true" className="brand-mark">
            g.
          </span>
          gunita
        </Link>
        <PreferenceControls />
        <nav className="account-links" aria-label={t('Your account')}>
          <Link href="/dashboard/thoughts" prefetch={false}>
            {t('Your active thoughts')}
          </Link>
          <Link href="/log-in" prefetch={false}>
            {t('Sign in')}
          </Link>
          <Link href="/settings" prefetch={false}>
            {t('Settings')}
          </Link>
        </nav>
      </header>
      <main tabIndex={-1} id="main">
        <PublicContentGate load={loadPublicContent} />
      </main>
      <footer className="site-footer">
        <span>Gunita · {t('A place for feelings left unsaid.')}</span>
        <nav className="account-links" aria-label={t('Policies')}>
          <Link href="/guidelines" prefetch={false}>
            {t('Guidelines')}
          </Link>
          <Link href="/privacy" prefetch={false}>
            {t('Privacy')}
          </Link>
          <Link href="/help" prefetch={false}>
            {t('Help')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
