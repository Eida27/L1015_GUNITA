import { headers } from 'next/headers';
import { AuthShell } from '@/components/auth/auth-shell';
import { SettingsView } from '@/components/auth/settings-view';
import { getAuthService } from '@/server/auth/runtime';
import { requireVerifiedMember, type Actor } from '@/server/auth/guards';
import { ApiError } from '@/lib/api/errors';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const requestHeaders = await headers();
  let account: Actor | undefined;
  let failure: string | undefined;
  try {
    account = await getAuthService().withAuthTransaction((context) =>
      requireVerifiedMember(context, new Headers(requestHeaders)),
    );
  } catch (error) {
    failure = error instanceof ApiError ? error.code : undefined;
  }
  return (
    <AuthShell>
      <SettingsView
        account={
          account
            ? { email: account.email, pseudonym: account.pseudonym }
            : undefined
        }
        failure={failure}
      />
    </AuthShell>
  );
}
