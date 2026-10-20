import { AuthShell } from '@/components/auth/auth-shell';
import { AuthForm } from '@/components/auth/auth-form';
export default function Page() {
  return (
    <AuthShell>
      <AuthForm mode="forgot-password" />
    </AuthShell>
  );
}
