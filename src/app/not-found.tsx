import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { Text } from '@/components/ui/preferences';
export default function NotFound() {
  return (
    <AuthShell>
      <section className="account-card">
        <h1>
          <Text id="Nothing here yet." />
        </h1>
        <p>
          <Link href="/">
            <Text id="Return to Gunita" />
          </Link>
        </p>
      </section>
    </AuthShell>
  );
}
