'use client';
import Link from 'next/link';
import { usePreferences } from '@/components/ui/preferences';
import { errorKey } from '@/lib/i18n/catalog';
import { SettingsPanel } from './settings-panel';
export function SettingsView({
  account,
  failure,
}: {
  account?: { email: string; pseudonym: string };
  failure?: string;
}) {
  const { t } = usePreferences();
  if (!account)
    return (
      <section className="account-card">
        <h1>{t('Your account')}</h1>
        <p role="alert">
          {failure
            ? t(errorKey(failure))
            : t('Account settings are unavailable. Please try again.')}
        </p>
        <Link href="/log-in">{t('Sign in')}</Link>
        <p>
          <Link href="/verify-email">{t('Verify your email')}</Link>
        </p>
      </section>
    );
  return (
    <div className="account-grid">
      <section className="account-intro">
        <p className="eyebrow">{t('Just for you.')}</p>
        <h1>{t('Your account.')}</h1>
        <p className="introduction">
          {t('A private place to manage your email, password and account.')}
        </p>
      </section>
      <SettingsPanel email={account.email} pseudonym={account.pseudonym} />
    </div>
  );
}
