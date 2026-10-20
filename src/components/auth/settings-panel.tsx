'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePreferences } from '@/components/ui/preferences';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
import { useHydrated } from './use-hydrated';
export function SettingsPanel({
  email,
  pseudonym,
}: {
  email: string;
  pseudonym: string;
}) {
  const { t } = usePreferences();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | ''>(''),
    [deleted, setDeleted] = useState(false);
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const password = String(
      new FormData(event.currentTarget).get('password') || '',
    );
    try {
      const response = await fetch('/api/me/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code || 'INTERNAL_ERROR');
      setDeleted(true);
    } catch (error) {
      setError(errorKey(error instanceof Error ? error.message : undefined));
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <section className="account-card">
        <h2>{t('Account deleted.')}</h2>
        <p role="status">
          {t(
            'Your live account and related content have been removed. All sessions are signed out.',
          )}
        </p>
        <Link href="/">{t('Return to Gunita')}</Link>
      </section>
    );
  return (
    <div className="settings-stack">
      <section className="account-card">
        <h2>{t('Your account')}</h2>
        <dl className="account-details">
          <dt>{t('Permanent pseudonym')}</dt>
          <dd>{pseudonym}</dd>
          <dt>{t('Email address')}</dt>
          <dd>{email}</dd>
          <dt>{t('Email status')}</dt>
          <dd>{t('Verified')}</dd>
        </dl>
        <p className="field-help">
          {t(
            'Your email is private. Your pseudonym cannot be changed. Email changes are unavailable in this version.',
          )}
        </p>
        <nav className="account-links" aria-label={t('Security')}>
          <Link href="/forgot-password">{t('Reset password')}</Link>
          <Link href="/log-out">{t('Sign out')}</Link>
        </nav>
      </section>
      <section className="account-card delete-card">
        <h2>{t('Delete account')}</h2>
        <p className="field-help">
          {t(
            'Permanently remove your account, active thoughts and associated interactions from the live database. All sessions will end. Encrypted backups may retain prior copies for up to seven days; deletion cannot erase copies saved by other people.',
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <form
          method="post"
          className="account-form"
          onSubmit={remove}
          aria-busy={busy}
        >
          <label>
            {t('Current password')}
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label className="check-label">
            <input type="checkbox" required />
            {t('I understand this permanently deletes my account.')}
          </label>
          <button
            type="submit"
            className="danger-button"
            disabled={!hydrated || busy}
          >
            {busy ? t('Deleting…') : t('Delete my account')}
          </button>
        </form>
      </section>
    </div>
  );
}
