import { headers } from 'next/headers';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { SettingsPanel } from '@/components/auth/settings-panel';
import { getAuthService } from '@/server/auth/runtime';
import { requireVerifiedMember } from '@/server/auth/guards';
import { ApiError } from '@/lib/api/errors';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const requestHeaders = await headers();
  let account;
  try {
    account = await getAuthService().withAuthTransaction((context) =>
      requireVerifiedMember(context, new Headers(requestHeaders)),
    );
  } catch (error) {
    return (
      <AuthShell>
        <section className="account-card">
          <h1>Your account</h1>
          <p>
            {error instanceof ApiError
              ? error.message
              : 'Account settings are unavailable. Please try again.'}
          </p>
          <Link href="/log-in">Sign in</Link>
          <p>
            <Link href="/verify-email">Verify your email</Link>
          </p>
        </section>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <div className="account-grid">
        <section className="account-intro">
          <p className="eyebrow">Just for you.</p>
          <h1>Your account.</h1>
          <p className="introduction">
            A private place to manage your email, password and account.
          </p>
        </section>
        <SettingsPanel email={account.email} pseudonym={account.pseudonym} />
      </div>
    </AuthShell>
  );
}
