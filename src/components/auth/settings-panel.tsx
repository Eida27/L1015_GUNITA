'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useHydrated } from './use-hydrated';
export function SettingsPanel({
  email,
  pseudonym,
}: {
  email: string;
  pseudonym: string;
}) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
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
      if (!response.ok)
        throw new Error(
          data.message || 'Could not delete this account. Please try again.',
        );
      setDeleted(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <section className="account-card">
        <h2>Account deleted.</h2>
        <p role="status">
          Your live account and related content have been removed. All sessions
          are signed out.
        </p>
        <Link href="/">Return to Gunita</Link>
      </section>
    );
  return (
    <div className="settings-stack">
      <section className="account-card">
        <h2>Your account</h2>
        <dl className="account-details">
          <dt>Permanent pseudonym</dt>
          <dd>{pseudonym}</dd>
          <dt>Email address</dt>
          <dd>{email}</dd>
          <dt>Email status</dt>
          <dd>Verified</dd>
        </dl>
        <p className="field-help">
          Your email is private. Your pseudonym cannot be changed. Email changes
          are unavailable in this version.
        </p>
        <nav className="account-links" aria-label="Security">
          <Link href="/forgot-password">Reset password</Link>
          <Link href="/log-out">Sign out</Link>
        </nav>
      </section>
      <section className="account-card delete-card">
        <h2>Delete account</h2>
        <p className="field-help">
          Permanently remove your account, active thoughts and associated
          interactions from the live database. All sessions will end. Encrypted
          backups may retain prior copies for up to seven days; deletion cannot
          erase copies saved by other people.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form
          method="post"
          className="account-form"
          onSubmit={remove}
          aria-busy={busy}
        >
          <label>
            Current password
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
            <input type="checkbox" required />I understand this permanently
            deletes my account.
          </label>
          <button
            type="submit"
            className="danger-button"
            disabled={!hydrated || busy}
          >
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </form>
      </section>
    </div>
  );
}
