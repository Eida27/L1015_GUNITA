'use client';
import { AuthShell } from '@/components/auth/auth-shell';
import { ErrorState } from '@/components/ui/states';
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <AuthShell>
      <ErrorState retry={retry} />
    </AuthShell>
  );
}
