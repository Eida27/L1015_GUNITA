'use client';
import Link from 'next/link';
import {
  usePreferences,
  PreferenceControls,
} from '@/components/ui/preferences';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = usePreferences();
  return (
    <div className="site-shell auth-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label={t('Gunita home')}>
          <span aria-hidden="true" className="brand-mark">
            g.
          </span>
          gunita
        </Link>
        <PreferenceControls />
        <Link className="quiet-link" href="/">
          {t('Back to Gunita ↗')}
        </Link>
      </header>
      <main tabIndex={-1} id="main" className="account-main">
        {children}
      </main>
      <footer className="site-footer">
        <span>{t('A place for feelings left unsaid.')}</span>
        <nav aria-label={t('Policies')}>
          <Link href="/guidelines">{t('Guidelines')}</Link>
          <Link href="/privacy">{t('Privacy')}</Link>
          <Link href="/terms">{t('Terms')}</Link>
          <Link href="/help">{t('Help')}</Link>
        </nav>
      </footer>
    </div>
  );
}
