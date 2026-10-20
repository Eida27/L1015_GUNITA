import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { PolicyCopy, type Policy } from '@/components/ui/policy-copy';
export default async function Page({
  params,
}: {
  params: Promise<{ policy: string }>;
}) {
  const { policy } = await params;
  if (!['privacy', 'terms', 'guidelines', 'help'].includes(policy)) notFound();
  return (
    <AuthShell>
      <PolicyCopy policy={policy as Policy} />
    </AuthShell>
  );
}
