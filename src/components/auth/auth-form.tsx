'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useHydrated } from './use-hydrated';

type Mode =
  | 'sign-up'
  | 'log-in'
  | 'verify-email'
  | 'forgot-password'
  | 'reset-password'
  | 'log-out';
const copy = {
  'sign-up': {
    title: 'A quiet space of your own.',
    intro:
      'Keep your email private. A permanent, random pseudonym will accompany every thought you share.',
    button: 'Create account',
  },
  'log-in': {
    title: 'Welcome back.',
    intro: 'A little room to return to.',
    button: 'Sign in',
  },
  'verify-email': {
    title: 'One small step.',
    intro:
      'Verify your email to use your account. Your email is never shown on your thoughts.',
    button: 'Verify email',
  },
  'forgot-password': {
    title: 'Find your way back.',
    intro: 'We’ll send a link to help you choose a new password.',
    button: 'Send reset link',
  },
  'reset-password': {
    title: 'A fresh start.',
    intro: 'Choose a new password. Every existing session will be signed out.',
    button: 'Reset password',
  },
  'log-out': {
    title: 'Until next time.',
    intro:
      'Sign out of this browser. Your thoughts keep their original expiration date.',
    button: 'Sign out',
  },
};
const actions = {
  'sign-up': 'sign-up/email',
  'log-in': 'sign-in/email',
  'verify-email': 'verify-email',
  'forgot-password': 'request-password-reset',
  'reset-password': 'reset-password',
  'log-out': 'sign-out',
};
async function submitJson(action: string, body: Record<string, string>) {
  const response = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || 'Something went wrong. Please try again.');
}
export function AuthForm({ mode }: { mode: Mode }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const token = useRef('');
  useEffect(() => {
    if (!token.current)
      token.current =
        new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    if (window.location.hash)
      window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const needsEmail = ['sign-up', 'log-in', 'forgot-password'].includes(mode);
  const needsPassword = ['sign-up', 'log-in', 'reset-password'].includes(mode);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const form = event.currentTarget,
      formData = new FormData(form),
      body: Record<string, string> = {};
    if (needsEmail) body.email = String(formData.get('email') || '');
    if (needsPassword)
      body[mode === 'reset-password' ? 'newPassword' : 'password'] = String(
        formData.get('password') || '',
      );
    if (['verify-email', 'reset-password'].includes(mode))
      body.token = token.current;
    try {
      await submitJson(actions[mode], body);
      form.reset();
      // A document navigation clears prior private router state after a cookie
      // boundary changes. Resolve an explicit same-origin destination.
      if (mode === 'log-in')
        window.location.assign(
          new URL('/settings', window.location.origin).href,
        );
      else if (mode === 'log-out')
        window.location.assign(new URL('/log-in', window.location.origin).href);
      else if (mode === 'verify-email') {
        token.current = '';
        setMessage('Email verified. You can now sign in.');
      } else if (mode === 'reset-password') {
        token.current = '';
        setMessage(
          'Password reset. All previous sessions have been signed out. You can now sign in.',
        );
      } else
        setMessage(
          'If this address is eligible, check your email for a link. Delivery may be delayed. If it does not arrive, request another link.',
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const email = String(new FormData(event.currentTarget).get('email') || '');
    try {
      await submitJson('send-verification-email', { email });
      setMessage(
        'If this address needs verification, check your email. Delivery may be delayed; you can try again later.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-grid">
      <section className="account-intro">
        <p className="eyebrow">A little room to feel.</p>
        <h1>{copy[mode].title}</h1>
        <p className="introduction">{copy[mode].intro}</p>
        <p className="account-aside">
          Your pseudonym is permanent. It connects your thoughts to one another,
          while your email stays private.
        </p>
      </section>
      <section className="account-card" aria-label="Account form">
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="form-message">
            {message}
          </p>
        )}
        <noscript>
          <p className="form-error">
            Enable JavaScript to use secure account forms.
          </p>
        </noscript>
        <form
          method="post"
          onSubmit={submit}
          className="account-form"
          aria-busy={busy}
        >
          {needsEmail && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          )}
          {needsPassword && (
            <label>
              {mode === 'reset-password' ? 'New password' : 'Password'}
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === 'log-in' ? 'current-password' : 'new-password'
                }
                required
                minLength={mode === 'log-in' ? 1 : 12}
                maxLength={128}
              />
            </label>
          )}
          {['sign-up', 'reset-password'].includes(mode) && (
            <p className="field-help">
              Use 12–128 characters. A long, unique passphrase works well.
            </p>
          )}
          {mode === 'sign-up' && (
            <p className="field-help">
              By creating an account you agree to the{' '}
              <Link href="/terms">Terms</Link> and{' '}
              <Link href="/guidelines">Community Guidelines</Link>. Read how we
              handle your information in our{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          )}
          {mode === 'reset-password' && (
            <p className="field-help">Open the reset link from your email.</p>
          )}
          {mode === 'verify-email' && (
            <p className="field-help">
              Open your email link, then confirm below. Links expire after one
              hour and can only be used once.
            </p>
          )}
          <button type="submit" disabled={!hydrated || busy}>
            {busy ? 'Please wait…' : copy[mode].button}
          </button>
        </form>
        {mode === 'verify-email' && (
          <form
            method="post"
            onSubmit={resend}
            className="account-form resend-form"
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <button
              type="submit"
              className="secondary-button"
              disabled={!hydrated || busy}
            >
              Send a new verification link
            </button>
          </form>
        )}
        <nav className="account-links" aria-label="Account options">
          {mode !== 'log-in' && <Link href="/log-in">Sign in</Link>}
          {mode === 'log-in' && (
            <>
              <Link href="/forgot-password">Forgot password?</Link>
              <Link href="/verify-email">Resend verification</Link>
              <Link href="/sign-up">Create an account</Link>
            </>
          )}
          {mode === 'sign-up' && (
            <Link href="/verify-email">Resend verification</Link>
          )}
          {mode === 'reset-password' && (
            <Link href="/forgot-password">Request another reset link</Link>
          )}
        </nav>
      </section>
    </div>
  );
}
